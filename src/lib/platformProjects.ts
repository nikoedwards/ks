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
    state: r.state,
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
    source_url: r.source_url,
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
    if (filter.state === 'successful') {
      conditions.push("(state = 'successful' OR state = 'indemand')");
    } else {
      conditions.push('state = @state');
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
