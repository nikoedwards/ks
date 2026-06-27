import { toUnifiedCategory, type PlatformKey } from './categoryMap';
import type {
  AnalysisCategoryRow,
  AnalysisCountryRow,
  AnalysisTrendRow,
  AnalysisStatsBundle,
} from './platformProjects';

// Helpers to merge Kickstarter + Indiegogo analysis aggregations into the
// "Global" view. Kickstarter aggregations come from src/lib/db.ts and share the
// same row shapes; we re-derive rates/averages from raw sums after merging.

const round2 = (n: number) => Math.round(n * 100) / 100;
const rate = (s: number, f: number) => (s + f > 0 ? Math.round((s / (s + f)) * 1000) / 10 : 0);

export function mergeCategoriesUnified(ks: AnalysisCategoryRow[], igg: AnalysisCategoryRow[]): AnalysisCategoryRow[] {
  const map = new Map<string, { total: number; successful: number; failed: number; pledged_m: number; backers: number }>();
  const add = (rows: AnalysisCategoryRow[], platform: PlatformKey) => {
    for (const r of rows) {
      const key = toUnifiedCategory(platform, r.category);
      const e = map.get(key) ?? { total: 0, successful: 0, failed: 0, pledged_m: 0, backers: 0 };
      e.total += Number(r.total ?? 0);
      e.successful += Number(r.successful ?? 0);
      e.failed += Number(r.failed ?? 0);
      e.pledged_m += Number(r.total_pledged_m ?? 0);
      e.backers += Number(r.total_backers ?? 0);
      map.set(key, e);
    }
  };
  add(ks, 'kickstarter');
  add(igg, 'indiegogo');
  return [...map.entries()].map(([category, e]) => ({
    category,
    total: e.total,
    successful: e.successful,
    failed: e.failed,
    success_rate: rate(e.successful, e.failed),
    total_pledged_m: round2(e.pledged_m),
    avg_pledged: e.total > 0 ? Math.round((e.pledged_m * 1_000_000) / e.total) : 0,
    total_backers: e.backers,
  })).sort((a, b) => b.total - a.total).slice(0, 25);
}

export function mergeCountries(ks: AnalysisCountryRow[], igg: AnalysisCountryRow[]): AnalysisCountryRow[] {
  const map = new Map<string, { country_name: string; total: number; successful: number; failed: number; pledged_m: number; backers: number }>();
  const add = (rows: AnalysisCountryRow[]) => {
    for (const r of rows) {
      const key = (r.country || '').toUpperCase();
      if (!key) continue;
      const e = map.get(key) ?? { country_name: r.country_name || r.country, total: 0, successful: 0, failed: 0, pledged_m: 0, backers: 0 };
      e.total += Number(r.total ?? 0);
      e.successful += Number(r.successful ?? 0);
      // KS country rows don't expose `failed`; derive it from total - successful.
      e.failed += Math.max(0, Number(r.total ?? 0) - Number(r.successful ?? 0));
      e.pledged_m += Number(r.total_pledged_m ?? 0);
      e.backers += Number(r.total_backers ?? 0);
      map.set(key, e);
    }
  };
  add(ks);
  add(igg);
  return [...map.entries()].map(([country, e]) => ({
    country,
    country_name: e.country_name,
    total: e.total,
    successful: e.successful,
    success_rate: rate(e.successful, e.failed),
    total_pledged_m: round2(e.pledged_m),
    total_backers: e.backers,
  })).sort((a, b) => b.total - a.total).slice(0, 20);
}

export function mergeTrends(ks: AnalysisTrendRow[], igg: AnalysisTrendRow[]): AnalysisTrendRow[] {
  const map = new Map<string, { total: number; successful: number; failed: number; pledged_m: number }>();
  const add = (rows: AnalysisTrendRow[]) => {
    for (const r of rows) {
      const e = map.get(r.month) ?? { total: 0, successful: 0, failed: 0, pledged_m: 0 };
      e.total += Number(r.total ?? 0);
      e.successful += Number(r.successful ?? 0);
      e.failed += Math.max(0, Number(r.total ?? 0) - Number(r.successful ?? 0));
      e.pledged_m += Number(r.total_pledged_m ?? 0);
      map.set(r.month, e);
    }
  };
  add(ks);
  add(igg);
  return [...map.entries()].map(([month, e]) => ({
    month,
    total: e.total,
    successful: e.successful,
    success_rate: rate(e.successful, e.failed),
    total_pledged_m: round2(e.pledged_m),
  })).sort((a, b) => a.month.localeCompare(b.month));
}

export function mergeStats(ks: Partial<AnalysisStatsBundle['stats']>, igg: AnalysisStatsBundle['stats']): AnalysisStatsBundle['stats'] {
  const n = (v: number | undefined | null) => Number(v ?? 0);
  const ksTotal = n(ks.total);
  const total = ksTotal + igg.total;
  const successful = n(ks.successful) + igg.successful;
  const failed = n(ks.failed) + igg.failed;
  return {
    total,
    successful,
    failed,
    live: n(ks.live) + igg.live,
    canceled: n(ks.canceled) + igg.canceled,
    success_rate: rate(successful, failed),
    total_pledged_usd: round2(n(ks.total_pledged_usd) + igg.total_pledged_usd),
    avg_backers: total > 0 ? Math.round(((n(ks.avg_backers) * ksTotal + igg.avg_backers * igg.total) / total) * 10) / 10 : 0,
    avg_goal: total > 0 ? Math.round((n(ks.avg_goal) * ksTotal + igg.avg_goal * igg.total) / total) : 0,
    category_count: n(ks.category_count) + igg.category_count,
  };
}

export function mergeStateDistribution(
  ks: Array<{ state: string; count: number }>,
  igg: Array<{ state: string; count: number }>,
): Array<{ state: string; count: number }> {
  const map = new Map<string, number>();
  for (const r of [...ks, ...igg]) map.set(r.state, (map.get(r.state) ?? 0) + Number(r.count ?? 0));
  return [...map.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count);
}
