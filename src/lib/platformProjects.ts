import fs from 'fs';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { getPlatformDbPath } from './platformDb';
import {
  toUnifiedCategory,
  rawCategoriesForUnified,
  isUnifiedCategory,
  type UnifiedCategory,
} from './categoryMap';

// Read-only access layer for Indiegogo (`platform_projects`) shaped to match the
// Kickstarter list/detail row so the existing frontend can render both with
// minimal branching. All amounts are already USD-normalized at ingest time.

const IGG_PLATFORM = 'indiegogo' as const;
export const IGG_ID_PREFIX = 'igg-';

export function isIndiegogoId(id: string | number | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(IGG_ID_PREFIX);
}

export function indiegogoSourceId(id: string): string {
  return id.startsWith(IGG_ID_PREFIX) ? id.slice(IGG_ID_PREFIX.length) : id;
}

const nowSec = () => Math.floor(Date.now() / 1000);

// Effective-state expression: a stored `live` campaign whose deadline has
// already passed is reclassified as successful/failed at read time, so the list,
// filters and aggregations agree with the detail page (which derives the
// countdown from the deadline). Ended campaigns stop being re-crawled, so their
// stored state goes stale — deriving it on read keeps every view consistent
// without a destructive backfill, and a future re-crawl self-heals the column.
const EFFECTIVE_STATE_SQL = `(CASE
  WHEN state = 'live' AND deadline IS NOT NULL AND deadline <= @now
    THEN (CASE WHEN COALESCE(goal_amount, 0) > 0 AND COALESCE(pledged_amount, 0) >= goal_amount THEN 'successful' ELSE 'failed' END)
  ELSE state END)`;

function effectiveState(
  state: string | null,
  deadline: number | null,
  goal: number | null,
  pledged: number | null,
  now = nowSec(),
): string | null {
  if (state === 'live' && deadline != null && deadline <= now) {
    return Number(goal ?? 0) > 0 && Number(pledged ?? 0) >= Number(goal ?? 0) ? 'successful' : 'failed';
  }
  return state;
}

// Canonical public project URL. The stored source_url can be a tracking /
// clickthrough link that 302s to the Indiegogo homepage, so prefer building it
// from the slug, which is always the canonical `/projects/<slug>` permalink.
function indiegogoPublicUrl(slug: string | null, fallback: string | null): string | null {
  if (slug) return `https://www.indiegogo.com/projects/${slug}`;
  return fallback ?? null;
}

// Superset row: same field names as the Kickstarter list row plus platform tags.
export interface UnifiedProjectRow {
  id: string;
  name: string;
  blurb: string | null;
  state: string | null;
  country: string | null;
  country_name: string | null;
  currency: string | null;
  category_parent: string | null;
  category_name: string | null;
  unified_category: UnifiedCategory;
  goal: number | null;
  pledged: number | null;
  usd_pledged: number;
  backers_count: number;
  staff_pick: number;
  launched_at: number | null;
  deadline: number | null;
  creator_name: string | null;
  creator_slug: string | null;
  creator_url: string | null;
  source_url: string | null;
  slug: string | null;
  image_url: string | null;
  image_thumb_url: string | null;
  data_source: string;
  platform: 'kickstarter' | 'indiegogo';
  // IGG-specific extras (used by the detail page; null/0 for KS rows)
  percent_raised?: number | null;
  comments_count?: number | null;
  updates_count?: number | null;
  rewards_count?: number | null;
  // Live snapshot fields (always null for IGG; KS rows fill these elsewhere)
  live_pledged_usd?: number | null;
  live_backers_count?: number | null;
  live_captured_at?: number | null;
  live_days_to_go?: number | null;
}

export interface PlatformProjectFilter {
  state?: string;
  unifiedCategory?: string;
  rawCategory?: string;
  search?: string;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  dateFrom?: number;
  dateTo?: number;
}

function openIndiegogoReadonly(): Database | null {
  const dbPath = getPlatformDbPath(IGG_PLATFORM);
  if (!fs.existsSync(dbPath)) return null;
  try {
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_projects'").get();
    if (!tbl) { db.close(); return null; }
    return db;
  } catch {
    return null;
  }
}

const SELECT_COLUMNS = `
  source_project_id, name, blurb, state, country, currency, category,
  goal_amount, pledged_amount, pledged_usd, backers_count,
  launched_at, deadline, source_url, image_url,
  project_url_name, creator_url_name, percent_raised,
  comments_count, updates_count, rewards_count
`;

interface RawIggRow {
  source_project_id: string;
  name: string;
  blurb: string | null;
  state: string | null;
  country: string | null;
  currency: string | null;
  category: string | null;
  goal_amount: number | null;
  pledged_amount: number | null;
  pledged_usd: number | null;
  backers_count: number | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string | null;
  image_url: string | null;
  project_url_name: string | null;
  creator_url_name: string | null;
  percent_raised: number | null;
  comments_count: number | null;
  updates_count: number | null;
  rewards_count: number | null;
}

function mapRow(r: RawIggRow): UnifiedProjectRow {
  return {
    id: `${IGG_ID_PREFIX}${r.source_project_id}`,
    name: r.name,
    blurb: r.blurb,
    state: effectiveState(r.state, r.deadline, r.goal_amount, r.pledged_amount),
    country: r.country,
    country_name: r.country,
    currency: r.currency,
    category_parent: r.category,
    category_name: null,
    unified_category: toUnifiedCategory('indiegogo', r.category),
    goal: r.goal_amount,
    pledged: r.pledged_amount,
    usd_pledged: Number(r.pledged_usd ?? 0),
    backers_count: Number(r.backers_count ?? 0),
    staff_pick: 0,
    launched_at: r.launched_at,
    deadline: r.deadline,
    creator_name: r.creator_url_name,
    creator_slug: r.creator_url_name,
    creator_url: r.creator_url_name ? `https://www.indiegogo.com/individuals/${r.creator_url_name}` : null,
    source_url: indiegogoPublicUrl(r.project_url_name, r.source_url),
    slug: r.project_url_name,
    image_url: r.image_url,
    image_thumb_url: r.image_url,
    data_source: 'indiegogo',
    platform: 'indiegogo',
    percent_raised: r.percent_raised,
    comments_count: r.comments_count,
    updates_count: r.updates_count,
    rewards_count: r.rewards_count,
    live_pledged_usd: null,
    live_backers_count: null,
    live_captured_at: null,
    live_days_to_go: null,
  };
}

function buildWhere(filter: PlatformProjectFilter): { where: string; params: Record<string, unknown> } {
  const conditions: string[] = ['platform_id = @platform'];
  const params: Record<string, unknown> = { platform: IGG_PLATFORM };

  if (filter.state && filter.state !== 'all') {
    params.now = nowSec();
    if (filter.state === 'successful') {
      conditions.push(`(${EFFECTIVE_STATE_SQL} = 'successful' OR state = 'indemand')`);
    } else {
      conditions.push(`${EFFECTIVE_STATE_SQL} = @state`);
      params.state = filter.state;
    }
  }

  if (filter.unifiedCategory && isUnifiedCategory(filter.unifiedCategory)) {
    const raws = rawCategoriesForUnified('indiegogo', filter.unifiedCategory as UnifiedCategory);
    if (raws.length) {
      const placeholders = raws.map((_, i) => `@cat${i}`);
      conditions.push(`LOWER(TRIM(category)) IN (${placeholders.join(', ')})`);
      raws.forEach((value, i) => { params[`cat${i}`] = value; });
    } else {
      conditions.push('1 = 0');
    }
  } else if (filter.rawCategory) {
    conditions.push('LOWER(TRIM(category)) = @rawCategory');
    params.rawCategory = filter.rawCategory.trim().toLowerCase();
  }

  if (filter.search) {
    conditions.push('(name LIKE @search OR blurb LIKE @search)');
    params.search = `%${filter.search}%`;
  }
  if (filter.dateFrom) { conditions.push('launched_at >= @dateFrom'); params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { conditions.push('launched_at <= @dateTo'); params.dateTo = filter.dateTo; }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

function orderClause(sort: string | undefined, sortDir: 'asc' | 'desc' | undefined): string {
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  switch (sort) {
    case 'backers': return `COALESCE(backers_count, 0) ${dir}`;
    case 'goal': return `COALESCE(goal_amount, 0) ${dir}`;
    case 'launched': return `COALESCE(launched_at, 0) ${dir}`;
    case 'funding_rate': return `(CASE WHEN COALESCE(goal_amount,0) > 0 THEN COALESCE(pledged_usd,0)/goal_amount ELSE 0 END) ${dir}`;
    case 'usd_pledged':
    default: return `COALESCE(pledged_usd, 0) ${dir}`;
  }
}

export function listIndiegogoProjects(filter: PlatformProjectFilter = {}): { total: number; rows: UnifiedProjectRow[] } {
  const db = openIndiegogoReadonly();
  if (!db) return { total: 0, rows: [] };
  try {
    const { where, params } = buildWhere(filter);
    const limit = filter.limit ?? 20;
    const page = filter.page ?? 1;
    const offset = (page - 1) * limit;
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM platform_projects ${where}`).get(params) as { c: number })?.c ?? 0;
    const rows = db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM platform_projects ${where} ORDER BY ${orderClause(filter.sort, filter.sortDir)} LIMIT @limit OFFSET @offset`
    ).all({ ...params, limit, offset }) as RawIggRow[];
    return { total, rows: rows.map(mapRow) };
  } finally {
    db.close();
  }
}

export function getIndiegogoProjectById(sourceId: string): UnifiedProjectRow | null {
  const db = openIndiegogoReadonly();
  if (!db) return null;
  try {
    const row = db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM platform_projects WHERE platform_id = ? AND source_project_id = ?`
    ).get(IGG_PLATFORM, sourceId) as RawIggRow | undefined;
    return row ? mapRow(row) : null;
  } finally {
    db.close();
  }
}

export interface IndiegogoSnapshotRow {
  captured_at: number;
  pledged_usd: number | null;
  pledged_amount: number | null;
  backers_count: number | null;
  comments_count: number | null;
  updates_count: number | null;
  state: string | null;
  source: string;
}

export function getIndiegogoSnapshots(sourceId: string): IndiegogoSnapshotRow[] {
  const db = openIndiegogoReadonly();
  if (!db) return [];
  try {
    const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_snapshots'").get();
    if (!tbl) return [];
    return db.prepare(
      `SELECT captured_at, pledged_usd, pledged_amount, backers_count, comments_count, updates_count, state, source
       FROM platform_snapshots WHERE platform_id = ? AND source_project_id = ? ORDER BY captured_at ASC`
    ).all(IGG_PLATFORM, sourceId) as IndiegogoSnapshotRow[];
  } finally {
    db.close();
  }
}

export function getIndiegogoTrending(limit = 5): UnifiedProjectRow[] {
  return listIndiegogoProjects({ state: 'live', sort: 'usd_pledged', sortDir: 'desc', limit, page: 1 }).rows;
}

export interface IndiegogoLeaderboardRow {
  id: string;
  name: string;
  blurb: string | null;
  state: string | null;
  category_parent: string | null;
  category_name: string | null;
  country: string | null;
  launched_at: number | null;
  image_url: string | null;
  image_thumb_url: string | null;
  pledged_usd: number;
  backers_count: number;
  goal: number;
  funded_pct: number;
  platform: 'indiegogo';
}

export interface IndiegogoLeaderboardResult {
  byPledged: IndiegogoLeaderboardRow[];
  byBackers: IndiegogoLeaderboardRow[];
  summary: { total_projects: number; total_pledged_usd: number; total_backers: number; avg_funded_pct: number };
}

function toLeaderboardRow(r: UnifiedProjectRow): IndiegogoLeaderboardRow {
  const goal = Number(r.goal ?? 0);
  const pledged = Number(r.usd_pledged ?? 0);
  return {
    id: r.id,
    name: r.name,
    blurb: r.blurb,
    state: r.state,
    category_parent: r.category_parent,
    category_name: r.category_name,
    country: r.country,
    launched_at: r.launched_at,
    image_url: r.image_url,
    image_thumb_url: r.image_thumb_url,
    pledged_usd: pledged,
    backers_count: Number(r.backers_count ?? 0),
    goal,
    funded_pct: goal > 0 ? Math.round((pledged / goal) * 1000) / 10 : 0,
    platform: 'indiegogo',
  };
}

// Leaderboard-shaped Indiegogo ranking (by pledged + by backers) over an
// optional date window / unified or raw category. Only projects with a launch
// date are ranked, mirroring the Kickstarter leaderboard.
export function getIndiegogoLeaderboard(filter: PlatformProjectFilter & { limit?: number } = {}): IndiegogoLeaderboardResult {
  const db = openIndiegogoReadonly();
  const empty: IndiegogoLeaderboardResult = { byPledged: [], byBackers: [], summary: { total_projects: 0, total_pledged_usd: 0, total_backers: 0, avg_funded_pct: 0 } };
  if (!db) return empty;
  try {
    const { where, params } = buildWhere({ ...filter, state: undefined });
    const limit = Math.max(1, Math.min(filter.limit ?? 25, 100));
    const guarded = `${where} AND launched_at IS NOT NULL`;
    const byPledged = (db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM platform_projects ${guarded} ORDER BY COALESCE(pledged_usd,0) DESC, COALESCE(backers_count,0) DESC LIMIT @limit`
    ).all({ ...params, limit }) as RawIggRow[]).map(mapRow).map(toLeaderboardRow);
    const byBackers = (db.prepare(
      `SELECT ${SELECT_COLUMNS} FROM platform_projects ${guarded} ORDER BY COALESCE(backers_count,0) DESC, COALESCE(pledged_usd,0) DESC LIMIT @limit`
    ).all({ ...params, limit }) as RawIggRow[]).map(mapRow).map(toLeaderboardRow);
    const agg = db.prepare(
      `SELECT COUNT(*) AS total_projects, COALESCE(SUM(pledged_usd),0) AS total_pledged_usd,
              COALESCE(SUM(backers_count),0) AS total_backers,
              COALESCE(AVG(CASE WHEN COALESCE(goal_amount,0) > 0 THEN pledged_usd/goal_amount*100 ELSE NULL END),0) AS avg_funded_pct
       FROM platform_projects ${guarded}`
    ).get(params) as { total_projects: number; total_pledged_usd: number; total_backers: number; avg_funded_pct: number };
    return {
      byPledged,
      byBackers,
      summary: {
        total_projects: Number(agg.total_projects ?? 0),
        total_pledged_usd: Number(agg.total_pledged_usd ?? 0),
        total_backers: Number(agg.total_backers ?? 0),
        avg_funded_pct: Math.round(Number(agg.avg_funded_pct ?? 0) * 10) / 10,
      },
    };
  } finally {
    db.close();
  }
}

export interface LiveIntelProject {
  id: string;
  name: string;
  blurb: string | null;
  goal: number;
  country: string | null;
  currency: string | null;
  category_parent: string | null;
  category_name: string | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string | null;
  image_url: string | null;
  image_thumb_url: string | null;
  pledged_usd: number;
  live_backers_count: number;
  latest_snapshot_at: number | null;
  pledged_delta_24h: number;
  backers_delta_24h: number;
  pledged_delta_6h: number;
  backers_delta_6h: number;
  funded_pct: number;
  projected_usd: number;
  platform: 'indiegogo';
}

export interface LiveIntelResult {
  generatedAt: number;
  summary: { live_projects: number; pledged_delta_24h: number; backers_delta_24h: number; launched_24h: number; ending_24h: number; overfunded_projects: number };
  fastestFunding: LiveIntelProject[];
  fastestBackers: LiveIntelProject[];
  newlyLaunched: LiveIntelProject[];
  endingSoon: LiveIntelProject[];
  overfunded: LiveIntelProject[];
  categories: Array<{ category: string; live_projects: number; pledged_delta_24h: number; backers_delta_24h: number; avg_funded_pct: number; overfunded_projects: number }>;
  allCategories: Array<{ category: string }>;
}

function emptyLiveIntel(): LiveIntelResult {
  return {
    generatedAt: Math.floor(Date.now() / 1000),
    summary: { live_projects: 0, pledged_delta_24h: 0, backers_delta_24h: 0, launched_24h: 0, ending_24h: 0, overfunded_projects: 0 },
    fastestFunding: [], fastestBackers: [], newlyLaunched: [], endingSoon: [], overfunded: [], categories: [], allCategories: [],
  };
}

// Simplified live intel for Indiegogo. IGG snapshots are sparse/irregular, so
// 24h/6h deltas are reported as 0; rankings use current pledged/backers as the
// proxy. Kickstarter keeps its full snapshot-diff intel.
export function getIndiegogoLiveIntel(limit = 12, filter: PlatformProjectFilter = {}): LiveIntelResult {
  const db = openIndiegogoReadonly();
  if (!db) return emptyLiveIntel();
  try {
    const { where, params } = buildWhere({ ...filter, state: 'live' });
    const rows = (db.prepare(`SELECT ${SELECT_COLUMNS} FROM platform_projects ${where} LIMIT 5000`).all(params) as RawIggRow[]).map(mapRow);
    const now = Math.floor(Date.now() / 1000);
    const live: LiveIntelProject[] = rows.map(r => {
      const goal = Number(r.goal ?? 0);
      const pledged = Number(r.usd_pledged ?? 0);
      return {
        id: r.id, name: r.name, blurb: r.blurb, goal,
        country: r.country, currency: r.currency,
        category_parent: r.category_parent, category_name: r.category_name,
        launched_at: r.launched_at, deadline: r.deadline,
        source_url: r.source_url, image_url: r.image_url, image_thumb_url: r.image_thumb_url,
        pledged_usd: pledged, live_backers_count: Number(r.backers_count ?? 0),
        latest_snapshot_at: null,
        pledged_delta_24h: 0, backers_delta_24h: 0, pledged_delta_6h: 0, backers_delta_6h: 0,
        funded_pct: goal > 0 ? Math.round((pledged / goal) * 1000) / 10 : 0,
        projected_usd: pledged,
        platform: 'indiegogo',
      };
    });
    const byPledged = [...live].sort((a, b) => b.pledged_usd - a.pledged_usd);
    const fastestFunding = byPledged.slice(0, limit);
    const fastestBackers = [...live].sort((a, b) => b.live_backers_count - a.live_backers_count).slice(0, limit);
    const newlyLaunched = [...live].filter(p => p.launched_at).sort((a, b) => (b.launched_at ?? 0) - (a.launched_at ?? 0)).slice(0, limit);
    const endingSoon = [...live].filter(p => p.deadline && p.deadline > now).sort((a, b) => (a.deadline ?? 0) - (b.deadline ?? 0)).slice(0, limit);
    const overfunded = [...live].filter(p => p.funded_pct >= 100).sort((a, b) => b.funded_pct - a.funded_pct).slice(0, limit);

    const catMap = new Map<string, { live_projects: number; funded_sum: number; overfunded_projects: number }>();
    for (const p of live) {
      const key = p.category_parent || '(uncategorized)';
      const e = catMap.get(key) ?? { live_projects: 0, funded_sum: 0, overfunded_projects: 0 };
      e.live_projects += 1;
      e.funded_sum += p.funded_pct;
      if (p.funded_pct >= 100) e.overfunded_projects += 1;
      catMap.set(key, e);
    }
    const categories = [...catMap.entries()].map(([category, e]) => ({
      category,
      live_projects: e.live_projects,
      pledged_delta_24h: 0,
      backers_delta_24h: 0,
      avg_funded_pct: e.live_projects > 0 ? Math.round((e.funded_sum / e.live_projects) * 10) / 10 : 0,
      overfunded_projects: e.overfunded_projects,
    })).sort((a, b) => b.live_projects - a.live_projects);

    return {
      generatedAt: now,
      summary: {
        live_projects: live.length,
        pledged_delta_24h: 0,
        backers_delta_24h: 0,
        launched_24h: live.filter(p => p.launched_at && p.launched_at >= now - 86400).length,
        ending_24h: live.filter(p => p.deadline && p.deadline > now && p.deadline <= now + 86400).length,
        overfunded_projects: overfunded.length,
      },
      fastestFunding, fastestBackers, newlyLaunched, endingSoon, overfunded,
      categories,
      allCategories: categories.map(c => ({ category: c.category })),
    };
  } finally {
    db.close();
  }
}

// ── Analysis aggregations (mirror the Kickstarter /api/stats|categories|trends|countries shapes) ──

interface AnalysisDateFilter { dateFrom?: number; dateTo?: number }

function analysisWhere(filter: AnalysisDateFilter, extra: string[] = []): { where: string; params: Record<string, unknown> } {
  const clauses = ['platform_id = @platform', ...extra];
  const params: Record<string, unknown> = { platform: IGG_PLATFORM, now: nowSec() };
  if (filter.dateFrom) { clauses.push('launched_at >= @dateFrom'); params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { clauses.push('launched_at <= @dateTo'); params.dateTo = filter.dateTo; }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

// Closed/decided campaigns for analysis (success-rate, trends, countries).
const EFF_DECIDED = `${EFFECTIVE_STATE_SQL} IN ('successful','failed')`;
const EFF_SUCCESS = `${EFFECTIVE_STATE_SQL} = 'successful'`;

export interface AnalysisStatsBundle {
  stats: { total: number; successful: number; failed: number; live: number; canceled: number; success_rate: number; total_pledged_usd: number; avg_backers: number; avg_goal: number; category_count: number };
  stateDistribution: Array<{ state: string; count: number }>;
}

export function getIndiegogoAnalysisStats(filter: AnalysisDateFilter = {}): AnalysisStatsBundle {
  const db = openIndiegogoReadonly();
  const zero: AnalysisStatsBundle = { stats: { total: 0, successful: 0, failed: 0, live: 0, canceled: 0, success_rate: 0, total_pledged_usd: 0, avg_backers: 0, avg_goal: 0, category_count: 0 }, stateDistribution: [] };
  if (!db) return zero;
  try {
    const { where, params } = analysisWhere(filter);
    const stats = db.prepare(`
      SELECT COUNT(*) AS total,
        SUM(${EFF_SUCCESS}) AS successful,
        SUM(${EFFECTIVE_STATE_SQL}='failed') AS failed,
        SUM(${EFFECTIVE_STATE_SQL}='live') AS live,
        SUM(${EFFECTIVE_STATE_SQL}='canceled') AS canceled,
        ROUND(AVG(CASE WHEN ${EFF_DECIDED} THEN (CASE WHEN ${EFF_SUCCESS} THEN 1.0 ELSE 0.0 END) END)*100, 1) AS success_rate,
        ROUND(SUM(pledged_usd)/1000000.0, 2) AS total_pledged_usd,
        ROUND(AVG(backers_count), 1) AS avg_backers,
        ROUND(AVG(goal_amount), 0) AS avg_goal,
        COUNT(DISTINCT category) AS category_count
      FROM platform_projects ${where}
    `).get(params) as AnalysisStatsBundle['stats'];
    const stateDistribution = db.prepare(
      `SELECT lower(COALESCE(${EFFECTIVE_STATE_SQL}, '')) AS state, COUNT(*) AS count FROM platform_projects ${where} GROUP BY 1 ORDER BY count DESC`
    ).all(params) as Array<{ state: string; count: number }>;
    return {
      stats: {
        total: Number(stats.total ?? 0), successful: Number(stats.successful ?? 0), failed: Number(stats.failed ?? 0),
        live: Number(stats.live ?? 0), canceled: Number(stats.canceled ?? 0), success_rate: Number(stats.success_rate ?? 0),
        total_pledged_usd: Number(stats.total_pledged_usd ?? 0), avg_backers: Number(stats.avg_backers ?? 0),
        avg_goal: Number(stats.avg_goal ?? 0), category_count: Number(stats.category_count ?? 0),
      },
      stateDistribution,
    };
  } finally {
    db.close();
  }
}

export interface AnalysisCategoryRow {
  category: string; total: number; successful: number; failed: number;
  success_rate: number; total_pledged_m: number; avg_pledged: number; total_backers: number;
}

export function getIndiegogoAnalysisCategories(filter: AnalysisDateFilter = {}): AnalysisCategoryRow[] {
  const db = openIndiegogoReadonly();
  if (!db) return [];
  try {
    const { where, params } = analysisWhere(filter, ["category IS NOT NULL", EFF_DECIDED]);
    return db.prepare(`
      SELECT category,
        COUNT(*) AS total,
        SUM(${EFF_SUCCESS}) AS successful,
        SUM(${EFFECTIVE_STATE_SQL}='failed') AS failed,
        ROUND(AVG(CASE WHEN ${EFF_DECIDED} THEN (CASE WHEN ${EFF_SUCCESS} THEN 1.0 ELSE 0.0 END) END)*100, 1) AS success_rate,
        ROUND(SUM(pledged_usd)/1000000.0, 2) AS total_pledged_m,
        ROUND(AVG(pledged_usd), 0) AS avg_pledged,
        SUM(backers_count) AS total_backers
      FROM platform_projects ${where}
      GROUP BY category ORDER BY total DESC LIMIT 25
    `).all(params) as AnalysisCategoryRow[];
  } finally {
    db.close();
  }
}

export interface AnalysisTrendRow { month: string; total: number; successful: number; success_rate: number; total_pledged_m: number }

export function getIndiegogoAnalysisTrends(filter: AnalysisDateFilter = {}): AnalysisTrendRow[] {
  const db = openIndiegogoReadonly();
  if (!db) return [];
  try {
    const { where, params } = analysisWhere(filter, ['launched_at IS NOT NULL', EFF_DECIDED]);
    return db.prepare(`
      SELECT strftime('%Y-%m', datetime(launched_at, 'unixepoch')) AS month,
        COUNT(*) AS total,
        SUM(${EFF_SUCCESS}) AS successful,
        ROUND(AVG(CASE WHEN ${EFF_DECIDED} THEN (CASE WHEN ${EFF_SUCCESS} THEN 1.0 ELSE 0.0 END) END)*100, 1) AS success_rate,
        ROUND(SUM(pledged_usd)/1000000.0, 2) AS total_pledged_m
      FROM platform_projects ${where}
      GROUP BY month ORDER BY month ASC
    `).all(params) as AnalysisTrendRow[];
  } finally {
    db.close();
  }
}

export interface AnalysisCountryRow {
  country: string; country_name: string; total: number; successful: number;
  success_rate: number; total_pledged_m: number; total_backers: number;
}

export function getIndiegogoAnalysisCountries(filter: AnalysisDateFilter = {}): AnalysisCountryRow[] {
  const db = openIndiegogoReadonly();
  if (!db) return [];
  try {
    const { where, params } = analysisWhere(filter, ['country IS NOT NULL', EFF_DECIDED]);
    return db.prepare(`
      SELECT country, country AS country_name,
        COUNT(*) AS total,
        SUM(${EFF_SUCCESS}) AS successful,
        ROUND(AVG(CASE WHEN ${EFF_DECIDED} THEN (CASE WHEN ${EFF_SUCCESS} THEN 1.0 ELSE 0.0 END) END)*100, 1) AS success_rate,
        ROUND(SUM(pledged_usd)/1000000.0, 2) AS total_pledged_m,
        SUM(backers_count) AS total_backers
      FROM platform_projects ${where}
      GROUP BY country ORDER BY total DESC LIMIT 20
    `).all(params) as AnalysisCountryRow[];
  } finally {
    db.close();
  }
}

// Distinct raw IGG categories with counts (for the single-platform IGG filter).
export function getIndiegogoRawCategories(): Array<{ category: string; count: number }> {
  const db = openIndiegogoReadonly();
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT COALESCE(NULLIF(TRIM(category), ''), '(uncategorized)') AS category, COUNT(*) AS count
       FROM platform_projects WHERE platform_id = ?
       GROUP BY COALESCE(NULLIF(TRIM(category), ''), '(uncategorized)')
       ORDER BY count DESC`
    ).all(IGG_PLATFORM) as Array<{ category: string; count: number }>;
  } finally {
    db.close();
  }
}
