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

// Hard sanity ceiling for a USD pledged total. Kickstarter's all-time record is
// ~$41.7M, so any computed pledged above this is a units/scale artifact (e.g. a
// "£1.3M" text parsed as 1.3M * a million-multiplier, or minor-unit amounts).
// Treated as invalid so it never gets stored and MAX-locked into the row.
export const MAX_PLAUSIBLE_PLEDGED_USD = 60_000_000;

// Per-backer plausibility guard. A real Kickstarter average pledge is tens to a few
// hundred USD; even the priciest hardware/board-game/enterprise campaigns essentially
// never sustain a four-figure average across their whole backer base. A pledged total
// implying a higher average-per-backer is therefore a parse/scale artifact (a local
// `pledged` given in minor units/×100, a since-fixed million-multiplier mis-read, a
// raw-local-as-USD value, …) that the monotonic MAX-lock would otherwise freeze
// forever. The absolute MAX_PLAUSIBLE_PLEDGED_USD ceiling only catches > $60M; the
// damaging artifacts (e.g. a £18k campaign mis-scaled to ~$2.3M against 354 backers,
// or a GBP campaign at ~$44M) sit well under it and are caught only by this ratio.
//
// Two tiers, both requiring a known backer count and a non-trivial total:
//  - HARD: any average above MAX_USD_PER_BACKER is impossible.
//  - HIGH-TOTAL: a > $1M total with a > $5k average is, in practice, always an
//    artifact (a real $1M+ raise has hundreds–thousands of backers, never < 200).
export const MAX_USD_PER_BACKER = 25_000;
export const HIGH_TOTAL_FLOOR_USD = 1_000_000;
export const HIGH_TOTAL_MAX_USD_PER_BACKER = 5_000;
// Totals below this are too small for a ratio to be meaningful; never flagged.
export const PLEDGED_SCRUTINY_FLOOR_USD = 100_000;

/**
 * True when `pledgedUsd` is implausible for the given backer count. Backer count of
 * 0/unknown is intentionally NOT flagged (we can't compute a ratio and don't want to
 * zero a legitimate big campaign whose backer count is merely missing — left to a
 * re-fetch). Small totals are likewise never flagged.
 */
export function isImplausiblePledgedUsd(pledgedUsd: number, backers: number): boolean {
  if (!Number.isFinite(pledgedUsd) || pledgedUsd <= 0) return false;
  if (pledgedUsd > MAX_PLAUSIBLE_PLEDGED_USD) return true;
  const b = Number.isFinite(backers) && backers > 0 ? backers : 0;
  if (b <= 0 || pledgedUsd < PLEDGED_SCRUTINY_FLOOR_USD) return false;
  const perBacker = pledgedUsd / b;
  if (perBacker > MAX_USD_PER_BACKER) return true;
  if (pledgedUsd >= HIGH_TOTAL_FLOOR_USD && perBacker > HIGH_TOTAL_MAX_USD_PER_BACKER) return true;
  return false;
}

/** Returns `pledgedUsd` when plausible for `backers`, otherwise 0 (so a bad value is
 *  never stored / MAX-locked into a project row or snapshot). */
export function plausiblePledgedUsdOrZero(pledgedUsd: number, backers: number): number {
  return isImplausiblePledgedUsd(pledgedUsd, backers) ? 0 : pledgedUsd;
}

// Static currency→USD fallback rates for every currency Kickstarter supports. Used
// when a payload carries neither an FX rate nor a trustworthy converted-USD figure,
// so we always apply a real conversion instead of storing the local amount as USD
// (the bug that made a ¥15.6M JPY campaign show as $15.63M instead of ~$105K).
export const STATIC_USD_RATES: Record<string, number> = {
  USD: 1, GBP: 1.25, EUR: 1.08, CAD: 0.73, AUD: 0.65, JPY: 0.0067,
  HKD: 0.128, SGD: 0.74, SEK: 0.093, NOK: 0.093, DKK: 0.145, CHF: 1.10,
  NZD: 0.60, MXN: 0.059, PLN: 0.25,
};

export function staticUsdRateFor(currency: string | null | undefined): number | null {
  const c = (currency ?? '').trim().toUpperCase();
  return STATIC_USD_RATES[c] ?? null;
}

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
  // Backer count from the same payload. Used as an independent tie-breaker when the
  // authoritative USD figure and localAmount*rate disagree — the candidate implying a
  // sane average pledge wins, which catches a local `pledged` given in minor units.
  backers?: number;
}

export interface UsdAmounts {
  pledgedUsd: number;
  goalUsd: number;
  rate: number;
}

function pos(value: number | undefined | null): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Trust a provided USD figure only when it lands in the right ballpark of
 *  localAmount*rate; otherwise it is a raw-local artifact and we recompute it. */
function reconcileUsdFigure(candidate: number, localAmount: number, rate: number): number {
  const expected = localAmount * rate;
  if (expected <= 0) return candidate > 0 ? candidate : 0;
  if (candidate <= 0) return expected;
  const ratio = candidate / expected;
  return ratio >= 0.5 && ratio <= 2 ? candidate : expected;
}

/**
 * Choose the pledged-USD figure between Kickstarter's authoritative converted/usd field
 * (`supplied`) and `reconciled` = reconcileUsdFigure(supplied, local, rate) — which is
 * `supplied` when the two agree, else `local*rate`. When they diverge exactly one side
 * is a scale artifact:
 *   (a) the usd/converted field actually holds a RAW-LOCAL (un-converted) amount, or
 *   (b) the local `pledged` field is in MINOR UNITS (×100) while usd/converted is right.
 * With a known backer count we break the tie by sanity: prefer Kickstarter's
 * authoritative figure when it implies a sane average, else the other; if both look
 * insane take the smaller (minor-unit inflation only ever makes a value too big). With
 * no backer signal we keep the legacy `reconciled` choice (prefers local*rate on
 * divergence, which guards the raw-local-in-usd-field case).
 */
function chooseBestPledgedUsd(supplied: number, reconciled: number, backers: number): number {
  if (backers <= 0) return reconciled;
  const candidates = [supplied, reconciled].filter(v => v > 0);
  if (candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0];
  if (!isImplausiblePledgedUsd(supplied, backers)) return supplied;
  if (!isImplausiblePledgedUsd(reconciled, backers)) return reconciled;
  return Math.min(supplied, reconciled);
}

export function resolveUsdAmounts(input: UsdAmountInput): UsdAmounts {
  const pledgedLocal = pos(input.pledgedLocal);
  const goalLocal = pos(input.goalLocal);
  const convertedPledged = pos(input.convertedPledged);
  const convertedGoal = pos(input.convertedGoal);
  const explicitUsd = pos(input.explicitUsdPledged);
  const currency = (input.currency ?? '').trim().toUpperCase();
  const isUsd = currency === 'USD';

  // 1) Choose a trustworthy currency→USD rate, preferring authoritative values and
  //    falling back to a static per-currency rate so a conversion is ALWAYS applied.
  let rate: number;
  if (isUsd) {
    rate = 1;
  } else {
    const authoritative = sanitizeFxRate(input.fxRate) ?? sanitizeFxRate(input.staticUsdRate);
    const candidate = convertedPledged > 0 ? convertedPledged : explicitUsd;
    const inferred = pledgedLocal > 0 && candidate > 0
      ? sanitizeFxRate(candidate / pledgedLocal)
      : null;
    rate = authoritative ?? sanitizeFxRate(staticUsdRateFor(currency)) ?? inferred ?? 1;
  }

  // 2) Pledged in USD: never store the raw local amount. Pick between Kickstarter's
  //    authoritative converted/usd figure and our own local*rate recompute, using the
  //    backer count to reject whichever side is a scale artifact (raw-local in the usd
  //    field, or a minor-unit/×100 local `pledged`).
  const suppliedUsd = convertedPledged > 0 ? convertedPledged : explicitUsd;
  const backers = pos(input.backers);
  let pledgedUsd = isUsd
    ? (suppliedUsd > 0 ? suppliedUsd : pledgedLocal)
    : chooseBestPledgedUsd(suppliedUsd, reconcileUsdFigure(suppliedUsd, pledgedLocal, rate), backers);
  // Reject impossibly-large pledged totals (scale/units artifacts). Returning 0
  // lets the ingest fall back to the project's existing value instead of writing
  // (and MAX-locking) a bogus billion-dollar figure.
  if (pledgedUsd > MAX_PLAUSIBLE_PLEDGED_USD) pledgedUsd = 0;

  // 3) Goal in USD. converted_goal_amount is occasionally present; trust it only when
  //    it agrees with goalLocal*rate (guards minor-unit/cents payloads that are ~100x off).
  let goalUsd = goalLocal * rate;
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
