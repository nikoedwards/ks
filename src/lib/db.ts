import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'kickstarter.db');

declare global {
  // eslint-disable-next-line no-var
  var __ksDb: Database | undefined;
}

function getDB(): Database {
  if (globalThis.__ksDb) return globalThis.__ksDb;

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new BetterSqlite3(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      blurb TEXT,
      goal REAL DEFAULT 0,
      pledged REAL DEFAULT 0,
      usd_pledged REAL DEFAULT 0,
      state TEXT NOT NULL,
      country TEXT,
      country_name TEXT,
      currency TEXT,
      category_id INTEGER,
      category_name TEXT,
      category_parent TEXT,
      backers_count INTEGER DEFAULT 0,
      staff_pick INTEGER DEFAULT 0,
      created_at INTEGER,
      launched_at INTEGER,
      deadline INTEGER,
      creator_name TEXT,
      creator_slug TEXT,
      source_url TEXT,
      slug TEXT,
      data_source TEXT DEFAULT 'webrobots',
      first_seen_at INTEGER,
      last_seen_at INTEGER,
      webrobots_synced_at INTEGER,
      ks_live_synced_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_state ON projects(state);
    CREATE INDEX IF NOT EXISTS idx_category ON projects(category_parent);
    CREATE INDEX IF NOT EXISTS idx_country ON projects(country);
    CREATE INDEX IF NOT EXISTS idx_launched ON projects(launched_at);
    CREATE INDEX IF NOT EXISTS idx_pledged ON projects(usd_pledged);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

    CREATE TABLE IF NOT EXISTS email_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email);

    CREATE TABLE IF NOT EXISTS tracking_settings (
      project_id TEXT PRIMARY KEY,
      is_tracking INTEGER DEFAULT 1,
      track_rewards INTEGER DEFAULT 1,
      track_comments INTEGER DEFAULT 0,
      analyze_comments INTEGER DEFAULT 0,
      track_text_diff INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 1,
      subscriber_count INTEGER DEFAULT 0,
      priority_score INTEGER DEFAULT 0,
      last_fetched INTEGER,
      next_fetch INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_project_subscriptions (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      is_tracking INTEGER DEFAULT 1,
      track_rewards INTEGER DEFAULT 1,
      track_comments INTEGER DEFAULT 0,
      analyze_comments INTEGER DEFAULT 0,
      track_text_diff INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      pledged_usd REAL,
      backers_count INTEGER,
      days_to_go INTEGER,
      comments_count INTEGER,
      updates_count INTEGER,
      state TEXT,
      source TEXT DEFAULT 'ks',
      UNIQUE(project_id, captured_at, source)
    );

    CREATE TABLE IF NOT EXISTS reward_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      reward_id TEXT NOT NULL,
      title TEXT,
      description TEXT,
      amount_usd REAL,
      backers_count INTEGER,
      limit_count INTEGER,
      is_limited INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_text_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      field TEXT NOT NULL,
      content TEXT NOT NULL,
      UNIQUE(project_id, captured_at, field)
    );

    CREATE TABLE IF NOT EXISTS project_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      comment_id TEXT NOT NULL UNIQUE,
      author TEXT,
      content TEXT NOT NULL,
      posted_at INTEGER,
      fetched_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON project_snapshots(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_rewards_project ON reward_snapshots(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_text_project ON project_text_history(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_comments_project ON project_comments(project_id, posted_at);
    CREATE INDEX IF NOT EXISTS idx_tracking_next ON tracking_settings(next_fetch);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_project ON user_project_subscriptions(project_id, is_tracking);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON user_project_subscriptions(user_id, is_tracking);

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      started_at TEXT,
      completed_at TEXT,
      records_imported INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    );
  `);

  // Add email_verified column to existing users table if absent
  try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1'); } catch { /* already exists */ }
  // Add creator_slug column to existing projects table if absent
  try { db.exec('ALTER TABLE projects ADD COLUMN creator_slug TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE projects ADD COLUMN data_source TEXT DEFAULT 'webrobots'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN first_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN last_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN webrobots_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN ks_live_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN subscriber_count INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN priority_score INTEGER DEFAULT 0'); } catch { /* already exists */ }

  globalThis.__ksDb = db;
  return db;
}

// No-op: better-sqlite3 writes directly to disk, no explicit save needed
export async function saveDB(): Promise<void> {
  getDB().pragma('wal_checkpoint(TRUNCATE)');
}

// ─── Public query functions ──────────────────────────────────────────────────

export interface DashboardStats {
  total: number;
  successful: number;
  failed: number;
  live: number;
  canceled: number;
  success_rate: number;
  total_pledged_usd: number;
  avg_backers: number;
  avg_goal: number;
}

export async function getStats(): Promise<DashboardStats> {
  return getDB().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN state='failed'     THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN state='live'       THEN 1 ELSE 0 END) as live,
      SUM(CASE WHEN state='canceled'   THEN 1 ELSE 0 END) as canceled,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_usd,
      ROUND(AVG(backers_count), 1) as avg_backers,
      ROUND(AVG(goal), 0) as avg_goal
    FROM projects
  `).get() as DashboardStats;
}

export async function getStateDistribution(): Promise<{ state: string; count: number }[]> {
  return getDB().prepare(
    `SELECT state, COUNT(*) as count FROM projects GROUP BY state ORDER BY count DESC`
  ).all() as { state: string; count: number }[];
}

export interface ProjectFilter {
  state?: string;
  category?: string;
  country?: string;
  search?: string;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  dateFrom?: number;
  dateTo?: number;
}

export async function getProjects(filter: ProjectFilter = {}) {
  const db = getDB();
  const { state, category, country, search, sort = 'usd_pledged', sortDir = 'desc', page = 1, limit = 20, dateFrom, dateTo } = filter;

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (state && state !== 'all') { conditions.push('p.state = @state'); params.state = state; }
  if (category) { conditions.push('p.category_parent = @category'); params.category = category; }
  if (country) { conditions.push('p.country = @country'); params.country = country; }
  if (search) { conditions.push('(p.name LIKE @search OR p.blurb LIKE @search)'); params.search = `%${search}%`; }
  if (dateFrom) { conditions.push('p.launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo) { conditions.push('p.launched_at <= @dateTo'); params.dateTo = dateTo; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortMap: Record<string, string> = {
    usd_pledged: `p.usd_pledged ${dir}`,
    backers: `p.backers_count ${dir}`,
    goal: `p.goal ${dir}`,
    launched: `p.launched_at ${dir}`,
    funding_rate: `(CASE WHEN p.goal>0 THEN p.usd_pledged/p.goal ELSE 0 END) ${dir}`,
  };
  const orderBy = sortMap[sort] || `p.usd_pledged ${dir}`;
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM projects p ${where}`).get(params) as { c: number };
  const total = countRow?.c ?? 0;

  const rows = db.prepare(
    `SELECT p.id, p.name, p.blurb,
            COALESCE(s.state, p.state) as state,
            p.country, p.country_name, p.currency,
            p.category_parent, p.category_name, p.goal,
            p.pledged, p.usd_pledged,
            COALESCE(s.snap_backers, p.backers_count) as backers_count,
            p.staff_pick, p.launched_at, p.deadline, p.source_url, p.slug,
            p.data_source,
            s.pledged_usd as live_pledged_usd,
            s.snap_backers as live_backers_count,
            s.captured_at as live_captured_at,
            s.days_to_go as live_days_to_go
     FROM projects p
     LEFT JOIN (
       SELECT project_id,
              MAX(captured_at) as captured_at,
              pledged_usd,
              backers_count as snap_backers,
              days_to_go,
              state
       FROM project_snapshots
       GROUP BY project_id
     ) s ON s.project_id = p.id
     ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });

  return { total, rows, page, limit };
}

export async function getCategories(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const where = `WHERE category_parent IS NOT NULL AND state IN ('successful','failed')${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      category_parent as category,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN state='failed'     THEN 1 ELSE 0 END) as failed,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m,
      ROUND(AVG(usd_pledged), 0) as avg_pledged,
      SUM(backers_count) as total_backers
    FROM projects
    ${where}
    GROUP BY category_parent ORDER BY total DESC LIMIT 25
  `).all(params);
}

export async function getTrends(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const defaultWindow = !dateFrom && !dateTo ? "AND launched_at > strftime('%s', date('now', '-36 months'))" : '';
  const where = `WHERE launched_at IS NOT NULL AND state IN ('successful','failed') ${defaultWindow}${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      strftime('%Y-%m', datetime(launched_at, 'unixepoch')) as month,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m
    FROM projects
    ${where}
    GROUP BY month ORDER BY month ASC
  `).all(params);
}

export async function getCountries(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const where = `WHERE country IS NOT NULL AND state IN ('successful','failed')${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      country,
      country_name,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m,
      SUM(backers_count) as total_backers
    FROM projects
    ${where}
    GROUP BY country ORDER BY total DESC LIMIT 20
  `).all(params);
}

export async function getCategoryList(): Promise<string[]> {
  const rows = getDB().prepare(
    `SELECT DISTINCT category_parent FROM projects WHERE category_parent IS NOT NULL ORDER BY category_parent`
  ).all() as { category_parent: string }[];
  return rows.map(r => r.category_parent);
}

export async function getCountryList(): Promise<{ country: string; country_name: string }[]> {
  return getDB().prepare(
    `SELECT DISTINCT country, country_name FROM projects WHERE country IS NOT NULL ORDER BY country`
  ).all() as { country: string; country_name: string }[];
}

// Returns the DB instance for use in sync
export async function getDBInstance(): Promise<Database> {
  return getDB();
}

// Synchronous batch upsert using better-sqlite3 transactions
export function upsertBatch(db: Database, rows: Record<string, unknown>[]): void {
  const insert = db.prepare(`
    INSERT INTO projects
      (id, name, blurb, goal, pledged, usd_pledged, state, country, country_name,
       currency, category_id, category_name, category_parent, backers_count,
       staff_pick, created_at, launched_at, deadline, creator_name, creator_slug, source_url, slug,
       data_source, first_seen_at, last_seen_at, webrobots_synced_at, ks_live_synced_at)
    VALUES
      (@id, @name, @blurb, @goal, @pledged, @usd_pledged, @state, @country, @country_name,
       @currency, @category_id, @category_name, @category_parent, @backers_count,
       @staff_pick, @created_at, @launched_at, @deadline, @creator_name, @creator_slug, @source_url, @slug,
       @data_source, @first_seen_at, @last_seen_at, @webrobots_synced_at, @ks_live_synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      blurb = excluded.blurb,
      goal = excluded.goal,
      pledged = excluded.pledged,
      usd_pledged = excluded.usd_pledged,
      state = excluded.state,
      country = COALESCE(excluded.country, projects.country),
      country_name = COALESCE(excluded.country_name, projects.country_name),
      currency = COALESCE(excluded.currency, projects.currency),
      category_id = COALESCE(excluded.category_id, projects.category_id),
      category_name = COALESCE(excluded.category_name, projects.category_name),
      category_parent = COALESCE(excluded.category_parent, projects.category_parent),
      backers_count = excluded.backers_count,
      staff_pick = excluded.staff_pick,
      created_at = COALESCE(excluded.created_at, projects.created_at),
      launched_at = COALESCE(excluded.launched_at, projects.launched_at),
      deadline = COALESCE(excluded.deadline, projects.deadline),
      creator_name = COALESCE(excluded.creator_name, projects.creator_name),
      creator_slug = COALESCE(excluded.creator_slug, projects.creator_slug),
      source_url = COALESCE(excluded.source_url, projects.source_url),
      slug = COALESCE(excluded.slug, projects.slug),
      data_source = CASE
        WHEN projects.data_source = excluded.data_source THEN projects.data_source
        WHEN projects.data_source IS NULL THEN excluded.data_source
        WHEN excluded.data_source IS NULL THEN projects.data_source
        WHEN instr(projects.data_source, excluded.data_source) > 0 THEN projects.data_source
        ELSE projects.data_source || ',' || excluded.data_source
      END,
      first_seen_at = COALESCE(MIN(projects.first_seen_at, excluded.first_seen_at), projects.first_seen_at, excluded.first_seen_at),
      last_seen_at = COALESCE(MAX(projects.last_seen_at, excluded.last_seen_at), projects.last_seen_at, excluded.last_seen_at),
      webrobots_synced_at = COALESCE(excluded.webrobots_synced_at, projects.webrobots_synced_at),
      ks_live_synced_at = COALESCE(excluded.ks_live_synced_at, projects.ks_live_synced_at)
  `);
  const insertMany = db.transaction((items: Record<string, unknown>[]) => {
    const now = Math.floor(Date.now() / 1000);
    for (const row of items) {
      const dataSource = row.data_source ?? 'webrobots';
      insert.run({
        ...row,
        data_source: dataSource,
        first_seen_at: row.first_seen_at ?? now,
        last_seen_at: row.last_seen_at ?? now,
        webrobots_synced_at: row.webrobots_synced_at ?? (dataSource === 'webrobots' ? now : null),
        ks_live_synced_at: row.ks_live_synced_at ?? (dataSource === 'ks_live' ? now : null),
      });
    }
  });
  insertMany(rows);
}

export async function upsertProjects(rows: Record<string, unknown>[]): Promise<number> {
  upsertBatch(getDB(), rows);
  return rows.length;
}

export async function insertSyncLog(log: {
  url: string;
  started_at: string;
  completed_at?: string;
  records_imported?: number;
  status: string;
  error_message?: string;
}): Promise<number> {
  const db = getDB();
  const result = db.prepare(
    `INSERT INTO sync_logs (url, started_at, completed_at, records_imported, status, error_message)
     VALUES (@url, @started_at, @completed_at, @records_imported, @status, @error_message)`
  ).run({
    url: log.url,
    started_at: log.started_at,
    completed_at: log.completed_at ?? null,
    records_imported: log.records_imported ?? null,
    status: log.status,
    error_message: log.error_message ?? null,
  });
  return Number(result.lastInsertRowid);
}

export async function updateSyncLog(
  id: number,
  data: Partial<{ completed_at: string; records_imported: number; status: string; error_message: string }>,
): Promise<void> {
  const sets = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  getDB().prepare(`UPDATE sync_logs SET ${sets} WHERE id = @id`).run({ ...data, id });
}

export async function getLastSync() {
  return getDB().prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1`).get() ?? null;
}

export async function getSyncHistory() {
  return getDB().prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10`).all();
}

export async function getProjectCount(): Promise<number> {
  const row = getDB().prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
  return row?.c ?? 0;
}

export async function getMeta(): Promise<{
  earliestDate: string | null;
  latestDate: string | null;
  totalProjects: number;
  lastSyncDate: string | null;
}> {
  const db = getDB();
  const dateRow = db.prepare(`
    SELECT
      date(MIN(launched_at), 'unixepoch') as earliest,
      date(MAX(launched_at), 'unixepoch') as latest,
      COUNT(*) as total
    FROM projects WHERE launched_at IS NOT NULL
  `).get() as { earliest: string | null; latest: string | null; total: number };

  const syncRow = db.prepare(
    `SELECT completed_at FROM sync_logs WHERE status='completed' ORDER BY id DESC LIMIT 1`
  ).get() as { completed_at: string } | undefined;

  return {
    earliestDate: dateRow?.earliest ?? null,
    latestDate: dateRow?.latest ?? null,
    totalProjects: dateRow?.total ?? 0,
    lastSyncDate: syncRow?.completed_at ? syncRow.completed_at.slice(0, 10) : null,
  };
}

export async function getProjectById(id: string) {
  return getDB().prepare(
    `SELECT id, name, blurb, state, country, country_name, currency,
            category_id, category_parent, category_name, goal, pledged, usd_pledged,
            backers_count, staff_pick, created_at, launched_at, deadline,
            creator_name, creator_slug, source_url, slug
     FROM projects WHERE id = ?`
  ).get(id) ?? null;
}

/**
 * Look up a project by creator_slug + project_slug.
 * Used to deduplicate Kicktraq-sourced projects against webrobots/KS-live records.
 * Returns the canonical numeric KS id if found, null otherwise.
 */
export function getProjectIdBySlug(creatorSlug: string, projectSlug: string): string | null {
  const row = getDB().prepare(
    `SELECT id FROM projects
     WHERE creator_slug = ? AND slug = ?
       AND id NOT LIKE 'kt:%'
     LIMIT 1`
  ).get(creatorSlug, projectSlug) as { id: string } | null;
  return row?.id ?? null;
}

/**
 * Merge a Kicktraq-sourced project into an existing canonical project.
 * Updates fields that webrobots/KS-live may have left null, and marks data_source.
 */
export function mergeKicktraqIntoProject(canonicalId: string, ktData: {
  backers_count?: number;
  pledged?: number;
  launched_at?: number | null;
  deadline?: number | null;
  category_parent?: string | null;
  category_name?: string | null;
}) {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE projects SET
      backers_count = MAX(backers_count, @backers_count),
      usd_pledged   = CASE WHEN @pledged > usd_pledged THEN @pledged ELSE usd_pledged END,
      launched_at   = COALESCE(launched_at, @launched_at),
      deadline      = COALESCE(deadline, @deadline),
      category_parent = COALESCE(category_parent, @category_parent),
      category_name   = COALESCE(category_name, @category_name),
      last_seen_at  = @now,
      data_source   = CASE
        WHEN instr(data_source, 'kicktraq') > 0 THEN data_source
        ELSE data_source || ',kicktraq'
      END
    WHERE id = @id
  `).run({
    id: canonicalId,
    backers_count: ktData.backers_count ?? 0,
    pledged: ktData.pledged ?? 0,
    launched_at: ktData.launched_at ?? null,
    deadline: ktData.deadline ?? null,
    category_parent: ktData.category_parent ?? null,
    category_name: ktData.category_name ?? null,
    now,
  });
}

export interface TrackingSettings {
  project_id: string;
  is_tracking: number;
  track_rewards: number;
  track_comments: number;
  analyze_comments: number;
  track_text_diff: number;
  priority: number;
  subscriber_count: number;
  priority_score: number;
  last_fetched: number | null;
  next_fetch: number | null;
  created_at: number;
}

export interface UserProjectSubscription {
  user_id: number;
  project_id: string;
  is_tracking: number;
  track_rewards: number;
  track_comments: number;
  analyze_comments: number;
  track_text_diff: number;
  priority: number;
  created_at: number;
  updated_at: number;
}

export function getTrackingSettings(projectId: string): TrackingSettings | null {
  return getDB().prepare('SELECT * FROM tracking_settings WHERE project_id = ?').get(projectId) as TrackingSettings | null;
}

export function getUserProjectSubscription(userId: number, projectId: string): UserProjectSubscription | null {
  return getDB().prepare(
    'SELECT * FROM user_project_subscriptions WHERE user_id = ? AND project_id = ?'
  ).get(userId, projectId) as UserProjectSubscription | null;
}

export function upsertTrackingSettings(settings: Partial<TrackingSettings> & { project_id: string }) {
  const db = getDB();
  const existing = db.prepare('SELECT project_id, priority FROM tracking_settings WHERE project_id = ?').get(settings.project_id) as { project_id: string; priority: number } | null;
  if (!existing) {
    const priority = settings.priority ?? 1;
    const nextFetch = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO tracking_settings
        (project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority, subscriber_count, priority_score, next_fetch)
      VALUES (@project_id, @is_tracking, @track_rewards, @track_comments, @analyze_comments, @track_text_diff, @priority, @subscriber_count, @priority_score, @next_fetch)
    `).run({
      project_id: settings.project_id,
      is_tracking: settings.is_tracking ?? 1,
      track_rewards: settings.track_rewards ?? 1,
      track_comments: settings.track_comments ?? 0,
      analyze_comments: settings.analyze_comments ?? 0,
      track_text_diff: settings.track_text_diff ?? 1,
      priority: priority,
      subscriber_count: settings.subscriber_count ?? 0,
      priority_score: settings.priority_score ?? 0,
      next_fetch: nextFetch,
    });
  } else {
    const updates: string[] = [];
    const params: Record<string, unknown> = { project_id: settings.project_id };
    for (const [k, v] of Object.entries(settings)) {
      if (k !== 'project_id' && v !== undefined) {
        updates.push(`${k} = @${k}`);
        params[k] = v;
      }
    }
    if (updates.length) {
      db.prepare(`UPDATE tracking_settings SET ${updates.join(', ')} WHERE project_id = @project_id`).run(params);
    }
  }
}

export function upsertUserProjectSubscription(
  userId: number,
  projectId: string,
  settings: Partial<Omit<UserProjectSubscription, 'user_id' | 'project_id' | 'created_at' | 'updated_at'>> = {}
) {
  const db = getDB();
  const existing = getUserProjectSubscription(userId, projectId);
  const now = Math.floor(Date.now() / 1000);

  const next = {
    user_id: userId,
    project_id: projectId,
    is_tracking: settings.is_tracking ?? existing?.is_tracking ?? 1,
    track_rewards: settings.track_rewards ?? existing?.track_rewards ?? 1,
    track_comments: settings.track_comments ?? existing?.track_comments ?? 0,
    analyze_comments: settings.analyze_comments ?? existing?.analyze_comments ?? 0,
    track_text_diff: settings.track_text_diff ?? existing?.track_text_diff ?? 1,
    priority: settings.priority ?? existing?.priority ?? 1,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO user_project_subscriptions
      (user_id, project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority, updated_at)
    VALUES
      (@user_id, @project_id, @is_tracking, @track_rewards, @track_comments, @analyze_comments, @track_text_diff, @priority, @updated_at)
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      is_tracking = excluded.is_tracking,
      track_rewards = excluded.track_rewards,
      track_comments = excluded.track_comments,
      analyze_comments = excluded.analyze_comments,
      track_text_diff = excluded.track_text_diff,
      priority = excluded.priority,
      updated_at = excluded.updated_at
  `).run(next);

  syncTrackingSettingsFromSubscriptions(projectId);
}

export function removeUserProjectSubscription(userId: number, projectId: string) {
  getDB().prepare(`
    UPDATE user_project_subscriptions
    SET is_tracking = 0, updated_at = unixepoch()
    WHERE user_id = ? AND project_id = ?
  `).run(userId, projectId);
  syncTrackingSettingsFromSubscriptions(projectId);
}

export function syncTrackingSettingsFromSubscriptions(projectId: string) {
  const db = getDB();
  const aggregate = db.prepare(`
    SELECT
      COUNT(*) as subscriber_count,
      MAX(track_rewards) as track_rewards,
      MAX(track_comments) as track_comments,
      MAX(analyze_comments) as analyze_comments,
      MAX(track_text_diff) as track_text_diff,
      MAX(priority) as priority,
      SUM(CASE WHEN priority = 2 THEN 10 ELSE 4 END) as priority_score
    FROM user_project_subscriptions
    WHERE project_id = ? AND is_tracking = 1
  `).get(projectId) as {
    subscriber_count: number;
    track_rewards: number | null;
    track_comments: number | null;
    analyze_comments: number | null;
    track_text_diff: number | null;
    priority: number | null;
    priority_score: number | null;
  };

  if (!aggregate.subscriber_count) {
    const existing = getTrackingSettings(projectId);
    if (existing) upsertTrackingSettings({ project_id: projectId, is_tracking: 0, subscriber_count: 0, priority_score: 0 });
    return;
  }

  upsertTrackingSettings({
    project_id: projectId,
    is_tracking: 1,
    track_rewards: aggregate.track_rewards ?? 1,
    track_comments: aggregate.track_comments ?? 0,
    analyze_comments: aggregate.analyze_comments ?? 0,
    track_text_diff: aggregate.track_text_diff ?? 1,
    priority: aggregate.priority ?? 1,
    subscriber_count: aggregate.subscriber_count,
    priority_score: aggregate.priority_score ?? 0,
    next_fetch: Math.floor(Date.now() / 1000),
  });
}

export function markFetched(projectId: string) {
  const now = Math.floor(Date.now() / 1000);
  const s = getDB().prepare(
    'SELECT priority, subscriber_count, priority_score FROM tracking_settings WHERE project_id = ?'
  ).get(projectId) as { priority: number; subscriber_count: number; priority_score: number } | null;
  const score = s?.priority_score ?? 0;
  const interval = s?.priority === 2 || score >= 20
    ? 3600
    : score >= 8 || (s?.subscriber_count ?? 0) >= 2
      ? 2 * 3600
      : 4 * 3600;
  getDB().prepare('UPDATE tracking_settings SET last_fetched = ?, next_fetch = ? WHERE project_id = ?').run(now, now + interval, projectId);
}

export function getDueProjects(): { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number }[] {
  const now = Math.floor(Date.now() / 1000);
  return getDB().prepare(`
    SELECT project_id, priority, track_rewards, track_comments, track_text_diff
    FROM tracking_settings WHERE is_tracking = 1 AND (next_fetch IS NULL OR next_fetch <= ?)
  `).all(now) as { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number }[];
}

export function getTrackingList(): (TrackingSettings & { name: string | null })[] {
  return getDB().prepare(`
    SELECT t.*, p.name FROM tracking_settings t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1 ORDER BY t.created_at DESC
  `).all() as (TrackingSettings & { name: string | null })[];
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface Snapshot {
  captured_at: number;
  pledged_usd: number;
  backers_count: number;
  days_to_go: number;
  comments_count: number;
  updates_count: number;
  state: string;
  source: string;
}

export function insertSnapshot(snap: Omit<Snapshot, 'source'> & { project_id: string; source?: string }) {
  getDB().prepare(`
    INSERT OR IGNORE INTO project_snapshots
      (project_id, captured_at, pledged_usd, backers_count, days_to_go, comments_count, updates_count, state, source)
    VALUES (@project_id, @captured_at, @pledged_usd, @backers_count, @days_to_go, @comments_count, @updates_count, @state, @source)
  `).run({ source: 'ks', ...snap });
}

export function getSnapshots(projectId: string, limitRows = 500): Snapshot[] {
  return getDB().prepare(`
    SELECT captured_at, pledged_usd, backers_count, days_to_go, comments_count, updates_count, state, source
    FROM project_snapshots WHERE project_id = ? ORDER BY captured_at ASC LIMIT ?
  `).all(projectId, limitRows) as Snapshot[];
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

export interface RewardSnapshot {
  reward_id: string;
  title: string;
  description: string;
  amount_usd: number;
  backers_count: number;
  limit_count: number | null;
  is_limited: number;
}

export function insertRewardSnapshots(projectId: string, capturedAt: number, rewards: RewardSnapshot[]) {
  const stmt = getDB().prepare(`
    INSERT INTO reward_snapshots
      (project_id, captured_at, reward_id, title, description, amount_usd, backers_count, limit_count, is_limited)
    VALUES (@project_id, @captured_at, @reward_id, @title, @description, @amount_usd, @backers_count, @limit_count, @is_limited)
  `);
  const tx = getDB().transaction(() => {
    for (const r of rewards) stmt.run({ project_id: projectId, captured_at: capturedAt, ...r });
  });
  tx();
}

export function getLatestRewards(projectId: string): RewardSnapshot[] {
  const db = getDB();
  const latest = db.prepare('SELECT MAX(captured_at) as ts FROM reward_snapshots WHERE project_id = ?').get(projectId) as { ts: number | null };
  if (!latest?.ts) return [];
  return db.prepare(`
    SELECT reward_id, title, description, amount_usd, backers_count, limit_count, is_limited
    FROM reward_snapshots WHERE project_id = ? AND captured_at = ? ORDER BY amount_usd ASC
  `).all(projectId, latest.ts) as RewardSnapshot[];
}

// ─── Text history ─────────────────────────────────────────────────────────────

export function insertTextIfChanged(projectId: string, capturedAt: number, field: string, content: string) {
  const db = getDB();
  const last = db.prepare(
    'SELECT content FROM project_text_history WHERE project_id = ? AND field = ? ORDER BY captured_at DESC LIMIT 1'
  ).get(projectId, field) as { content: string } | null;
  if (!last || last.content !== content) {
    db.prepare('INSERT OR IGNORE INTO project_text_history (project_id, captured_at, field, content) VALUES (?, ?, ?, ?)').run(projectId, capturedAt, field, content);
  }
}

export function getTextHistory(projectId: string): { field: string; captured_at: number; content: string }[] {
  return getDB().prepare(
    'SELECT field, captured_at, content FROM project_text_history WHERE project_id = ? ORDER BY field, captured_at ASC'
  ).all(projectId) as { field: string; captured_at: number; content: string }[];
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export function insertComment(c: { project_id: string; comment_id: string; author: string; content: string; posted_at: number }) {
  getDB().prepare(`
    INSERT OR IGNORE INTO project_comments (project_id, comment_id, author, content, posted_at)
    VALUES (@project_id, @comment_id, @author, @content, @posted_at)
  `).run(c);
}

export function getComments(projectId: string, limitRows = 100): { comment_id: string; author: string; content: string; posted_at: number }[] {
  return getDB().prepare(
    'SELECT comment_id, author, content, posted_at FROM project_comments WHERE project_id = ? ORDER BY posted_at DESC LIMIT ?'
  ).all(projectId, limitRows) as { comment_id: string; author: string; content: string; posted_at: number }[];
}

// ─── Similar projects ─────────────────────────────────────────────────────────

export function getSimilarProjects(projectId: string, category: string, goalUsd: number, backers: number, limit = 6): Record<string, unknown>[] {
  const low = goalUsd * 0.2;
  const high = goalUsd * 5;
  return getDB().prepare(`
    SELECT id, name, blurb, state, category_parent, category_name, usd_pledged, goal, backers_count,
           launched_at, source_url, slug,
           (
             CASE WHEN category_parent = @category THEN 40 ELSE 0 END +
             CASE WHEN usd_pledged BETWEEN @low AND @high THEN 30 ELSE 0 END +
             CASE WHEN ABS(backers_count - @backers) < @backers * 0.5 THEN 20 ELSE 0 END +
             CASE WHEN state = 'successful' THEN 10 ELSE 0 END
           ) as score
    FROM projects
    WHERE id != @id AND goal > 0 AND usd_pledged > 0
    ORDER BY score DESC, usd_pledged DESC
    LIMIT @limit
  `).all({ id: projectId, category, low, high, backers, limit }) as Record<string, unknown>[];
}
