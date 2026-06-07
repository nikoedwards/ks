// Final-funding prediction engine ("pacing curve" / S-curve model).
//
// Kickstarter cumulative-funding curves are not linear: most campaigns raise a
// big chunk in the launch surge, plateau through the middle, then spike again
// near the deadline. A naive linear extrapolation (pledged / progress) badly
// overestimates mid-campaign and underestimates the end run.
//
// Instead we learn the *typical* pacing curve p(τ) = "median fraction of the
// final total that a campaign has raised by progress τ" from every COMPLETED
// project in the DB (overall, and bucketed by parent category). For a live
// project at progress τ with current pledged P, the predicted final is
// roughly  P / p(τ).  As the DB accumulates more finished campaigns the curve
// (and its category buckets) sharpen, so predictions get more accurate over
// time — exactly the intended evolution.
//
// Everything here is derived deterministically from snapshots, so the
// prediction + deviation series recompute automatically whenever new data is
// scraped (no write-path changes, no coupling to the live KS crawler).

import { getPacingSamples, type PacingSample, type Snapshot } from './db';

const BINS = 24; // resolution of the pacing curve over τ ∈ [0, 1]
const OVERALL_KEY = '__all__';
const MIN_BUCKET_SAMPLES = 400; // below this a category falls back to overall
const CURVE_TTL_MS = 6 * 60 * 60 * 1000; // rebuild the (expensive) curve every 6h
// Per-bin pseudo-observations of the canonical prior. Each empirical bin is
// shrunk toward the prior with this weight, so data-poor or skewed buckets can
// never collapse to p(τ)≈1 (which would make the forecast just echo current
// pledged — the "every project predicts == current" bug). Data dominates once a
// bin has many real samples.
const PRIOR_PSEUDOCOUNT = 60;

// Canonical Kickstarter pacing prior: the "smile" curve — a front-loaded launch
// surge (the √τ term) plus a back-loaded deadline spike (the τ² term), both
// pinned to 0 at τ=0 and 1 at τ=1. e.g. p(0.5)≈0.39, p(0.9)≈0.85, so a live
// campaign is always projected meaningfully above its current pledged.
function priorPacingAt(tau: number): number {
  const t = Math.min(1, Math.max(0, tau));
  return 0.3 * Math.sqrt(t) + 0.7 * t * t;
}

export interface ProjectForPrediction {
  state?: string | null;
  launched_at?: number | null;
  deadline?: number | null;
  usd_pledged?: number | null;
  category_parent?: string | null;
}

export interface FundingPrediction {
  predictedFinalUsd: number;
  currentPledgedUsd: number;
  progress: number;          // τ ∈ [0,1]
  pacingFraction: number;    // p(τ) used
  confidence: number;        // 0..1
  confidenceLabel: 'low' | 'medium' | 'high';
  method: 'pacing' | 'pacing+linear' | 'final';
  sampleSize: number;        // samples behind the curve bucket used
}

export interface DeviationPoint {
  ts: number;                // captured_at
  actualUsd: number;         // actual cumulative pledged
  expectedUsd: number;       // model's one-step-ahead expectation for this point
  deviationUsd: number;      // actual − expected
  deviationPct: number;      // deviation relative to expected (%)
}

interface PacingCurve {
  // For each bucket key: a monotonic non-decreasing array of length BINS+1
  // giving p at τ = 0, 1/BINS, …, 1 (last value pinned to 1).
  buckets: Map<string, number[]>;
  sampleCounts: Map<string, number>;
  builtAt: number;
}

let cachedCurve: PacingCurve | null = null;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function buildCurveFromSamples(samples: PacingSample[]): PacingCurve {
  // Collect fractions per (bucket, bin).
  const byBucket = new Map<string, number[][]>();
  const ensure = (key: string) => {
    let arr = byBucket.get(key);
    if (!arr) { arr = Array.from({ length: BINS + 1 }, () => [] as number[]); byBucket.set(key, arr); }
    return arr;
  };

  for (const s of samples) {
    if (!Number.isFinite(s.tau) || !Number.isFinite(s.frac)) continue;
    const tau = Math.min(1, Math.max(0, s.tau));
    const frac = Math.min(1, Math.max(0, s.frac)); // cumulative can't exceed final
    const bin = Math.round(tau * BINS);
    ensure(OVERALL_KEY)[bin].push(frac);
    if (s.cat) ensure(s.cat)[bin].push(frac);
  }

  const buckets = new Map<string, number[]>();
  const sampleCounts = new Map<string, number>();
  for (const [key, bins] of byBucket) {
    const total = bins.reduce((n, b) => n + b.length, 0);
    sampleCounts.set(key, total);
    // Shrink each bin's empirical median toward the canonical prior (Bayesian
    // smoothing). With few/no samples the bin ≈ prior; with many it ≈ data. This
    // is what keeps the curve from degenerating to p(τ)=1 everywhere.
    const curve = bins.map((b, i) => {
      const prior = priorPacingAt(i / BINS);
      const m = b.length ? median(b) : prior;
      return (b.length * m + PRIOR_PSEUDOCOUNT * prior) / (b.length + PRIOR_PSEUDOCOUNT);
    });
    // Endpoints: by definition nothing raised at τ=0, everything at τ=1.
    curve[0] = 0;
    curve[BINS] = 1;
    let runningMax = 0;
    for (let i = 0; i <= BINS; i++) { runningMax = Math.max(runningMax, curve[i]); curve[i] = runningMax; }
    const peak = curve[BINS] || 1;
    if (peak > 0 && peak !== 1) for (let i = 0; i <= BINS; i++) curve[i] = curve[i] / peak;
    curve[BINS] = 1;
    buckets.set(key, curve);
  }
  // Guarantee an overall curve exists even with no data (prior S-curve fallback).
  if (!buckets.has(OVERALL_KEY)) {
    buckets.set(OVERALL_KEY, Array.from({ length: BINS + 1 }, (_, i) => priorPacingAt(i / BINS)));
    sampleCounts.set(OVERALL_KEY, 0);
  }
  return { buckets, sampleCounts, builtAt: Date.now() };
}

export function getPacingCurve(forceRebuild = false): PacingCurve {
  if (!forceRebuild && cachedCurve && Date.now() - cachedCurve.builtAt < CURVE_TTL_MS) {
    return cachedCurve;
  }
  try {
    cachedCurve = buildCurveFromSamples(getPacingSamples());
  } catch {
    // On any query error, keep the last good curve or a linear fallback.
    if (!cachedCurve) cachedCurve = buildCurveFromSamples([]);
  }
  return cachedCurve;
}

function pickBucket(curve: PacingCurve, categoryParent?: string | null): { key: string; samples: number } {
  if (categoryParent) {
    const n = curve.sampleCounts.get(categoryParent) ?? 0;
    if (n >= MIN_BUCKET_SAMPLES && curve.buckets.has(categoryParent)) {
      return { key: categoryParent, samples: n };
    }
  }
  return { key: OVERALL_KEY, samples: curve.sampleCounts.get(OVERALL_KEY) ?? 0 };
}

// Linear-interpolated pacing fraction p(τ) for a bucket curve.
function pacingAt(curveArr: number[], tau: number): number {
  const t = Math.min(1, Math.max(0, tau));
  const x = t * BINS;
  const lo = Math.floor(x);
  const hi = Math.min(BINS, lo + 1);
  const w = x - lo;
  return curveArr[lo] * (1 - w) + curveArr[hi] * w;
}

function progressOf(project: ProjectForPrediction, atTs: number): number {
  const launched = project.launched_at ?? 0;
  const deadline = project.deadline ?? 0;
  if (!launched || !deadline || deadline <= launched) return 1;
  return Math.min(1, Math.max(0, (atTs - launched) / (deadline - launched)));
}

function confidenceLabel(c: number): 'low' | 'medium' | 'high' {
  if (c >= 0.66) return 'high';
  if (c >= 0.33) return 'medium';
  return 'low';
}

/**
 * Predict the final pledged total for a (typically live) project from its
 * snapshot history. Ended projects return their known final.
 */
export function predictFinalUsd(
  snapshots: Snapshot[],
  project: ProjectForPrediction,
  nowTs: number = Math.floor(Date.now() / 1000),
): FundingPrediction | null {
  const last = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const currentPledged = Math.max(Number(last?.pledged_usd ?? 0) || 0, Number(project.usd_pledged ?? 0) || 0);

  const isLive = (project.state ?? '') === 'live';
  if (!isLive) {
    return {
      predictedFinalUsd: currentPledged,
      currentPledgedUsd: currentPledged,
      progress: 1,
      pacingFraction: 1,
      confidence: 1,
      confidenceLabel: 'high',
      method: 'final',
      sampleSize: 0,
    };
  }

  const curve = getPacingCurve();
  const { key, samples } = pickBucket(curve, project.category_parent);
  const curveArr = curve.buckets.get(key) ?? curve.buckets.get(OVERALL_KEY)!;

  const tau = progressOf(project, nowTs);
  const pFrac = pacingAt(curveArr, tau);

  // Pacing estimate: scale current pledged up by the inverse pacing fraction.
  // Guard the divisor so very-early campaigns (p≈0) don't explode.
  const safeFrac = Math.max(pFrac, 0.02);
  const pacingEstimate = currentPledged / safeFrac;
  // Linear estimate, for blending only.
  const linearEstimate = tau > 0.001 ? currentPledged / tau : pacingEstimate;

  // Blend: trust pacing more as the curve has more samples; lean slightly on the
  // linear estimate when the bucket is data-poor. Pacing dominates by design.
  const dataWeight = Math.min(1, samples / (MIN_BUCKET_SAMPLES * 4));
  const blendPacing = 0.8 + 0.2 * dataWeight;
  let predicted = blendPacing * pacingEstimate + (1 - blendPacing) * linearEstimate;

  // Sanity clamps: never below what's already raised, never absurdly high.
  predicted = Math.max(predicted, currentPledged);
  predicted = Math.min(predicted, currentPledged * 50 + 1000);

  // Confidence grows with progress and with how much data backs the curve, and
  // shrinks when pacing vs linear disagree wildly (uncertain regime).
  const agreement = 1 - Math.min(1, Math.abs(pacingEstimate - linearEstimate) / Math.max(pacingEstimate, 1));
  const confidence = Math.min(1, Math.max(0.05, 0.5 * tau + 0.3 * dataWeight + 0.2 * agreement));

  return {
    predictedFinalUsd: Math.round(predicted),
    currentPledgedUsd: Math.round(currentPledged),
    progress: tau,
    pacingFraction: pFrac,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    method: dataWeight > 0 ? 'pacing+linear' : 'pacing',
    sampleSize: samples,
  };
}

/**
 * Build the "prediction deviation" series for the chart: for each snapshot we
 * make a ONE-STEP-AHEAD prediction using only the data available *before* that
 * point (the running final estimate from the previous snapshot, projected onto
 * the pacing curve at this snapshot's progress), then report how far the actual
 * cumulative landed from that expectation. Positive = outperforming the model.
 *
 * This is non-degenerate (the expectation never trivially equals the actual)
 * and self-corrects: every newly scraped point appends one more deviation
 * value, so the curve tracks how the campaign runs vs. the learned pace.
 */
export function buildDeviationSeries(
  snapshots: Snapshot[],
  project: ProjectForPrediction,
): DeviationPoint[] {
  if (snapshots.length < 2) return [];
  const curve = getPacingCurve();
  const { key } = pickBucket(curve, project.category_parent);
  const curveArr = curve.buckets.get(key) ?? curve.buckets.get(OVERALL_KEY)!;

  const out: DeviationPoint[] = [];
  let prevFinalEstimate: number | null = null;

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const actual = Number(s.pledged_usd ?? 0) || 0;
    const tau = progressOf(project, s.captured_at);
    const pFrac = pacingAt(curveArr, tau);

    if (prevFinalEstimate != null) {
      const expected = prevFinalEstimate * pFrac;
      const deviationUsd = actual - expected;
      const deviationPct = expected > 0 ? (deviationUsd / expected) * 100 : 0;
      out.push({
        ts: s.captured_at,
        actualUsd: Math.round(actual),
        expectedUsd: Math.round(expected),
        deviationUsd: Math.round(deviationUsd),
        deviationPct: Number(deviationPct.toFixed(1)),
      });
    }

    // Update the running final estimate using data through point i.
    const safeFrac = Math.max(pFrac, 0.02);
    prevFinalEstimate = actual > 0 ? actual / safeFrac : prevFinalEstimate;
  }
  return out;
}
