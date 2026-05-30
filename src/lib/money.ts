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

  // 2) Pledged in USD: never store the raw local amount. Prefer a supplied USD figure
  //    only when it is plausible for pledgedLocal*rate; otherwise convert ourselves.
  const suppliedUsd = convertedPledged > 0 ? convertedPledged : explicitUsd;
  const pledgedUsd = isUsd
    ? (suppliedUsd > 0 ? suppliedUsd : pledgedLocal)
    : reconcileUsdFigure(suppliedUsd, pledgedLocal, rate);

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
