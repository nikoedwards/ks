/**
 * Currency / USD-amount normalization shared by every Kickstarter ingest path
 * (live discover feed, project-JSON scraper, webrobots import).
 *
 * History / why this exists:
 * The original logic derived the goal's USD value by applying an FX rate that was
 * *inferred* from the pledged side: `rate = pledgedUsd / pledgedLocal`, then
 * `goalUsd = goalLocal * rate`. When a source payload reported its pledged-local
 * and pledged-USD figures on mismatched scales (a recurring quirk where the two
 * fields are ~100x apart), that inferred rate ballooned to ~100 and silently
 * inflated the goal 100x — e.g. a real $100,000 goal was stored as ~$10,000,000.
 * Pledged stayed correct, so the funded% still looked plausible and the bug hid.
 *
 * Fix: never trust an out-of-range conversion rate. Real fiat→USD rates for every
 * Kickstarter-supported currency sit comfortably inside [MIN_FX_RATE, MAX_FX_RATE];
 * anything outside that window is a units/scale artifact and is discarded in favor
 * of an authoritative rate (or 1 for USD).
 */

// Widest plausible window for a real currency→USD static rate. The strongest
// Kickstarter currency (KWD/BHD/OMR) is ~3.3 and the weakest (IDR/VND/KRW) is a
// few thousandths; this window keeps all of them while rejecting bogus ~100 rates.
export const MIN_FX_RATE = 0.0005;
export const MAX_FX_RATE = 10;

export function sanitizeFxRate(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  if (rate < MIN_FX_RATE || rate > MAX_FX_RATE) return null;
  return rate;
}

export interface UsdAmountInput {
  pledgedLocal: number;
  goalLocal: number;
  convertedPledged?: number;
  convertedGoal?: number;
  explicitUsdPledged?: number;
  fxRate?: number;
  staticUsdRate?: number;
  currency?: string | null;
}

export interface UsdAmounts {
  pledgedUsd: number;
  goalUsd: number;
  rate: number;
}

function pos(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function resolveUsdAmounts(input: UsdAmountInput): UsdAmounts {
  const pledgedLocal = pos(input.pledgedLocal);
  const goalLocal = pos(input.goalLocal);
  const convertedPledged = pos(input.convertedPledged);
  const convertedGoal = pos(input.convertedGoal);
  const explicitUsd = pos(input.explicitUsdPledged);
  const isUsd = (input.currency ?? '').trim().toUpperCase() === 'USD';

  const pledgedUsd = convertedPledged > 0
    ? convertedPledged
    : explicitUsd > 0
      ? explicitUsd
      : pledgedLocal;

  // Choose a trustworthy currency→USD rate for the GOAL.
  let rate: number;
  if (isUsd) {
    rate = 1;
  } else {
    const authoritative = sanitizeFxRate(input.fxRate) ?? sanitizeFxRate(input.staticUsdRate);
    const inferred = pledgedLocal > 0 && pledgedUsd > 0
      ? sanitizeFxRate(pledgedUsd / pledgedLocal)
      : null;
    rate = authoritative ?? inferred ?? 1;
  }

  let goalUsd = goalLocal * rate;

  // converted_goal_amount is occasionally present. Trust it only when it agrees
  // with goalLocal*rate (guards against minor-unit/cents payloads that are ~100x off).
  if (convertedGoal > 0) {
    if (goalUsd > 0) {
      const ratio = convertedGoal / goalUsd;
      if (ratio >= 0.5 && ratio <= 2) goalUsd = convertedGoal;
    } else {
      goalUsd = convertedGoal;
    }
  }

  return { pledgedUsd, goalUsd, rate };
}
