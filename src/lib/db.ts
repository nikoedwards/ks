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

function ensureRuntimeMigrations(db: Database) {
  try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN creator_slug TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE projects ADD COLUMN data_source TEXT DEFAULT 'webrobots'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN first_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN last_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN webrobots_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN ks_live_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN image_url TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN image_thumb_url TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN subscriber_count INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN priority_score INTEGER DEFAULT 0'); } catch { /* already exists */ }
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) db.prepare("UPDATE users SET role = 'admin' WHERE lower(email) = ?").run(adminEmail);
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)").run();
}

function getDB(): Database {
  if (globalThis.__ksDb) {
    ensureRuntimeMigrations(globalThis.__ksDb);
    return globalThis.__ksDb;
  }

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
      image_url TEXT,
      image_thumb_url TEXT,
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

    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload_json TEXT,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'queued',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      scheduled_at INTEGER DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      last_error TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      discovered_count INTEGER DEFAULT 0,
      imported_count INTEGER DEFAULT 0,
      snapshot_count INTEGER DEFAULT 0,
      page_count INTEGER DEFAULT 0,
      blocked_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS source_raw_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL,
      fetched_at INTEGER DEFAULT (unixepoch()),
      status_code INTEGER,
      content_type TEXT,
      payload_bytes INTEGER DEFAULT 0,
      checksum TEXT,
      payload_preview TEXT
    );

    CREATE TABLE IF NOT EXISTS crawler_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT,
      project_id TEXT,
      url TEXT,
      status_code INTEGER,
      message TEXT NOT NULL,
      occurred_at INTEGER DEFAULT (unixepoch()),
      context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_jobs_due ON crawl_jobs(status, scheduled_at, priority);
    CREATE INDEX IF NOT EXISTS idx_crawl_runs_source ON crawl_runs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_payloads_source_key ON source_raw_payloads(source, source_key, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_errors_source ON crawler_errors(source, occurred_at);

    CREATE TABLE IF NOT EXISTS nav_settings (
      nav_key TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      admin_visible INTEGER DEFAULT 1,
      user_visible INTEGER DEFAULT 1,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);

  ensureRuntimeMigrations(db);

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

function dateWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  return {
    clauses: [] as string[],
    params: {} as Record<string, unknown>,
    launched: `${p}launched_at`,
  };
}

export async function getStats(filter: { dateFrom?: number; dateTo?: number } = {}): Promise<DashboardStats> {
  const w = dateWhere();
  if (filter.dateFrom) { w.clauses.push(`${w.launched} >= @dateFrom`); w.params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { w.clauses.push(`${w.launched} <= @dateTo`); w.params.dateTo = filter.dateTo; }
  const where = w.clauses.length ? `WHERE ${w.clauses.join(' AND ')}` : '';
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
    ${where}
  `).get(w.params) as DashboardStats;
}

export async function getStateDistribution(filter: { dateFrom?: number; dateTo?: number } = {}): Promise<{ state: string; count: number }[]> {
  const w = dateWhere();
  if (filter.dateFrom) { w.clauses.push(`${w.launched} >= @dateFrom`); w.params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { w.clauses.push(`${w.launched} <= @dateTo`); w.params.dateTo = filter.dateTo; }
  const where = w.clauses.length ? `WHERE ${w.clauses.join(' AND ')}` : '';
  return getDB().prepare(
    `SELECT state, COUNT(*) as count FROM projects ${where} GROUP BY state ORDER BY count DESC`
  ).all(w.params) as { state: string; count: number }[];
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
            CASE WHEN s.state IN ('live','successful','failed','canceled','suspended') THEN s.state ELSE p.state END as state,
            p.country, p.country_name, p.currency,
            p.category_parent, p.category_name, p.goal,
            p.pledged, p.usd_pledged,
            COALESCE(s.snap_backers, p.backers_count) as backers_count,
            p.staff_pick, p.launched_at, p.deadline, p.source_url, p.slug,
            p.image_url, p.image_thumb_url, p.data_source,
            CASE
              WHEN s.source = 'kicktraq_active' AND COALESCE(p.currency, 'USD') <> 'USD' THEN NULL
              WHEN s.pledged_usd IS NOT NULL AND (s.pledged_usd > 0 OR p.usd_pledged = 0) THEN s.pledged_usd
              ELSE NULL
            END as live_pledged_usd,
            s.snap_backers as live_backers_count,
            s.captured_at as live_captured_at,
            s.days_to_go as live_days_to_go
     FROM projects p
     LEFT JOIN (
       SELECT ps.project_id, ps.captured_at, ps.pledged_usd,
              ps.backers_count as snap_backers, ps.days_to_go, ps.state, ps.source
       FROM project_snapshots ps
       JOIN (
         SELECT project_id, MAX(id) as id
         FROM project_snapshots
         WHERE state NOT IN ('unknown', 'historical')
         GROUP BY project_id
       ) latest ON latest.id = ps.id
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
       image_url, image_thumb_url, data_source, first_seen_at, last_seen_at, webrobots_synced_at, ks_live_synced_at)
    VALUES
      (@id, @name, @blurb, @goal, @pledged, @usd_pledged, @state, @country, @country_name,
       @currency, @category_id, @category_name, @category_parent, @backers_count,
       @staff_pick, @created_at, @launched_at, @deadline, @creator_name, @creator_slug, @source_url, @slug,
       @image_url, @image_thumb_url, @data_source, @first_seen_at, @last_seen_at, @webrobots_synced_at, @ks_live_synced_at)
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
      image_url = COALESCE(excluded.image_url, projects.image_url),
      image_thumb_url = COALESCE(excluded.image_thumb_url, projects.image_thumb_url),
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
        image_url: row.image_url ?? null,
        image_thumb_url: row.image_thumb_url ?? null,
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

export interface CrawlRunUpdate {
  status?: string;
  completed_at?: number;
  discovered_count?: number;
  imported_count?: number;
  snapshot_count?: number;
  page_count?: number;
  blocked_count?: number;
  error_count?: number;
  message?: string;
}

export function startCrawlRun(source: string, jobType: string): number {
  const result = getDB().prepare(`
    INSERT INTO crawl_runs (source, job_type, status, started_at)
    VALUES (?, ?, 'running', unixepoch())
  `).run(source, jobType);
  return Number(result.lastInsertRowid);
}

export function completeCrawlRun(id: number | undefined, data: CrawlRunUpdate) {
  if (!id) return;
  const next = {
    completed_at: Math.floor(Date.now() / 1000),
    ...data,
  };
  const sets = Object.keys(next).map(k => `${k} = @${k}`).join(', ');
  getDB().prepare(`UPDATE crawl_runs SET ${sets} WHERE id = @id`).run({ ...next, id });
}

export function recordCrawlerError(error: {
  source: string;
  job_type?: string;
  project_id?: string | null;
  url?: string | null;
  status_code?: number | null;
  message: string;
  context?: Record<string, unknown>;
}) {
  getDB().prepare(`
    INSERT INTO crawler_errors (source, job_type, project_id, url, status_code, message, context_json)
    VALUES (@source, @job_type, @project_id, @url, @status_code, @message, @context_json)
  `).run({
    source: error.source,
    job_type: error.job_type ?? null,
    project_id: error.project_id ?? null,
    url: error.url ?? null,
    status_code: error.status_code ?? null,
    message: error.message,
    context_json: error.context ? JSON.stringify(error.context).slice(0, 4000) : null,
  });
}

export function recordSourcePayload(payload: {
  source: string;
  source_key: string;
  status_code?: number | null;
  content_type?: string | null;
  payload_bytes?: number;
  checksum?: string | null;
  payload_preview?: string | null;
}) {
  getDB().prepare(`
    INSERT INTO source_raw_payloads
      (source, source_key, status_code, content_type, payload_bytes, checksum, payload_preview)
    VALUES
      (@source, @source_key, @status_code, @content_type, @payload_bytes, @checksum, @payload_preview)
  `).run({
    source: payload.source,
    source_key: payload.source_key,
    status_code: payload.status_code ?? null,
    content_type: payload.content_type ?? null,
    payload_bytes: payload.payload_bytes ?? 0,
    checksum: payload.checksum ?? null,
    payload_preview: payload.payload_preview?.slice(0, 1000) ?? null,
  });
}

export function updateProjectLiveMetadata(projectId: string, data: {
  name?: string | null;
  blurb?: string | null;
  state?: string | null;
  goal_usd?: number | null;
  pledged_usd?: number | null;
  backers_count?: number | null;
  image_url?: string | null;
  image_thumb_url?: string | null;
}) {
  getDB().prepare(`
    UPDATE projects SET
      name = COALESCE(@name, name),
      blurb = COALESCE(@blurb, blurb),
      state = COALESCE(@state, state),
      goal = CASE WHEN @goal_usd IS NOT NULL THEN @goal_usd ELSE goal END,
      usd_pledged = CASE WHEN @pledged_usd IS NOT NULL THEN @pledged_usd ELSE usd_pledged END,
      backers_count = CASE WHEN @backers_count IS NOT NULL THEN @backers_count ELSE backers_count END,
      image_url = COALESCE(@image_url, image_url),
      image_thumb_url = COALESCE(@image_thumb_url, image_thumb_url),
      last_seen_at = unixepoch()
    WHERE id = @project_id
  `).run({
    project_id: projectId,
    name: data.name ?? null,
    blurb: data.blurb ?? null,
    state: data.state ?? null,
    goal_usd: data.goal_usd ?? null,
    pledged_usd: data.pledged_usd ?? null,
    backers_count: data.backers_count ?? null,
    image_url: data.image_url ?? null,
    image_thumb_url: data.image_thumb_url ?? null,
  });
}

export const DEFAULT_NAV_ITEMS = [
  'dashboard',
  'projects',
  'live-intel',
  'analysis',
  'predict',
  'favorites',
  'data-quality',
  'settings',
  'admin-users',
  'admin-nav',
] as const;

export type NavKey = typeof DEFAULT_NAV_ITEMS[number];

const ADMIN_ONLY_NAV_ITEMS = new Set<NavKey>([
  'data-quality',
  'settings',
  'admin-users',
  'admin-nav',
]);

export function ensureDefaultNavSettings() {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO nav_settings (nav_key, sort_order, admin_visible, user_visible)
    VALUES (@nav_key, @sort_order, @admin_visible, @user_visible)
  `);
  const tx = db.transaction(() => {
    DEFAULT_NAV_ITEMS.forEach((key, index) => {
      const adminOnly = ADMIN_ONLY_NAV_ITEMS.has(key);
      const hiddenByDefault = key === 'dashboard';
      stmt.run({
        nav_key: key,
        sort_order: index,
        admin_visible: hiddenByDefault ? 0 : 1,
        user_visible: adminOnly || hiddenByDefault ? 0 : 1,
      });
    });
    db.prepare(`
      UPDATE nav_settings
      SET user_visible = 0
      WHERE nav_key IN ('data-quality', 'settings', 'admin-users', 'admin-nav')
    `).run();
  });
  tx();
}

export function getNavSettings(role: 'admin' | 'user' = 'user') {
  ensureDefaultNavSettings();
  const visibleCol = role === 'admin' ? 'admin_visible' : 'user_visible';
  return getDB().prepare(`
    SELECT nav_key, sort_order, admin_visible, user_visible
    FROM nav_settings
    WHERE ${visibleCol} = 1
    ORDER BY sort_order ASC
  `).all();
}

export function getAllNavSettings() {
  ensureDefaultNavSettings();
  return getDB().prepare(`
    SELECT nav_key, sort_order, admin_visible, user_visible
    FROM nav_settings
    ORDER BY sort_order ASC
  `).all();
}

export function updateNavSettings(items: { nav_key: string; sort_order: number; admin_visible: number; user_visible: number }[]) {
  ensureDefaultNavSettings();
  const allowed = new Set(DEFAULT_NAV_ITEMS);
  const stmt = getDB().prepare(`
    UPDATE nav_settings
    SET sort_order = @sort_order,
        admin_visible = @admin_visible,
        user_visible = @user_visible,
        updated_at = unixepoch()
    WHERE nav_key = @nav_key
  `);
  const tx = getDB().transaction(() => {
    for (const item of items) {
      if (!allowed.has(item.nav_key as NavKey)) continue;
      const adminOnly = ADMIN_ONLY_NAV_ITEMS.has(item.nav_key as NavKey);
      stmt.run({
        nav_key: item.nav_key,
        sort_order: item.sort_order,
        admin_visible: item.admin_visible ? 1 : 0,
        user_visible: adminOnly ? 0 : (item.user_visible ? 1 : 0),
      });
    }
  });
  tx();
}

export function getUserAdminDashboard() {
  const db = getDB();
  ensureRuntimeMigrations(db);
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_users,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
      SUM(CASE WHEN role != 'admin' OR role IS NULL THEN 1 ELSE 0 END) as normal_users,
      SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified_users
    FROM users
  `).get();
  const users = db.prepare(`
    SELECT
      u.id, u.username, u.email, COALESCE(u.role, 'user') as role, u.email_verified, u.created_at,
      COUNT(DISTINCT f.project_id) as favorites_count,
      COUNT(DISTINCT s.project_id) as subscriptions_count,
      MAX(sess.expires_at) as session_expires_at
    FROM users u
    LEFT JOIN favorites f ON f.user_id = u.id
    LEFT JOIN user_project_subscriptions s ON s.user_id = u.id AND s.is_tracking = 1
    LEFT JOIN sessions sess ON sess.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC, u.id DESC
  `).all();
  return { summary, users };
}

export function updateUserRole(userId: number, role: 'admin' | 'user') {
  getDB().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
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

export function getDataQualityReport() {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const sixHoursAgo = now - 6 * 3600;
  const dayAgo = now - 24 * 3600;

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_projects,
      SUM(CASE WHEN state = 'live' THEN 1 ELSE 0 END) as live_projects,
      SUM(CASE WHEN data_source LIKE '%webrobots%' THEN 1 ELSE 0 END) as webrobots_projects,
      SUM(CASE WHEN data_source LIKE '%ks_live%' THEN 1 ELSE 0 END) as ks_live_projects,
      SUM(CASE WHEN data_source LIKE '%kicktraq%' THEN 1 ELSE 0 END) as kicktraq_projects,
      SUM(CASE WHEN source_url IS NULL OR source_url = '' THEN 1 ELSE 0 END) as missing_source_url,
      SUM(CASE WHEN creator_slug IS NULL OR creator_slug = '' OR slug IS NULL OR slug = '' THEN 1 ELSE 0 END) as missing_slug,
      SUM(CASE WHEN launched_at IS NULL THEN 1 ELSE 0 END) as missing_launch_date
    FROM projects
  `).get() as Record<string, number | null>;

  const snapshots = db.prepare(`
    SELECT
      COUNT(*) as total_snapshots,
      SUM(CASE WHEN captured_at >= @dayAgo THEN 1 ELSE 0 END) as snapshots_24h,
      COUNT(DISTINCT project_id) as projects_with_snapshots,
      MAX(captured_at) as latest_snapshot_at
    FROM project_snapshots
  `).get({ dayAgo }) as Record<string, number | null>;

  const staleLive = db.prepare(`
    SELECT COUNT(*) as c
    FROM projects p
    LEFT JOIN (
      SELECT project_id, MAX(captured_at) as last_snapshot_at
      FROM project_snapshots
      GROUP BY project_id
    ) s ON s.project_id = p.id
    WHERE p.state = 'live'
      AND (s.last_snapshot_at IS NULL OR s.last_snapshot_at < @sixHoursAgo)
  `).get({ sixHoursAgo }) as { c: number };

  const liveTracking = db.prepare(`
    SELECT
      COUNT(*) as live_trackable,
      SUM(CASE WHEN t.project_id IS NOT NULL AND t.is_tracking = 1 THEN 1 ELSE 0 END) as auto_tracked_live,
      SUM(CASE WHEN (t.project_id IS NULL OR t.is_tracking = 0) THEN 1 ELSE 0 END) as untracked_live
    FROM projects p
    LEFT JOIN tracking_settings t ON t.project_id = p.id
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as Record<string, number | null>;

  const tracking = db.prepare(`
    SELECT
      COUNT(*) as tracked_projects,
      SUM(CASE WHEN next_fetch IS NULL OR next_fetch <= @now THEN 1 ELSE 0 END) as due_projects
    FROM tracking_settings
    WHERE is_tracking = 1
  `).get({ now }) as Record<string, number | null>;

  const recentRuns = db.prepare(`
    SELECT id, source, job_type, status, started_at, completed_at,
           discovered_count, imported_count, snapshot_count, page_count,
           blocked_count, error_count, message
    FROM crawl_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 12
  `).all();

  const sourceHealth = db.prepare(`
    SELECT
      source,
      COUNT(*) as runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      MAX(started_at) as last_started_at,
      MAX(completed_at) as last_completed_at,
      SUM(discovered_count) as discovered_count,
      SUM(imported_count) as imported_count,
      SUM(snapshot_count) as snapshot_count
    FROM crawl_runs
    GROUP BY source
    ORDER BY last_started_at DESC
  `).all();

  const recentErrors = db.prepare(`
    SELECT id, source, job_type, project_id, url, status_code, message, occurred_at
    FROM crawler_errors
    ORDER BY occurred_at DESC, id DESC
    LIMIT 10
  `).all();

  const syncSources = db.prepare(`
    SELECT
      CASE
        WHEN url LIKE 'ks_live:%' THEN 'ks_live'
        WHEN url LIKE 'kicktraq_active:%' THEN 'kicktraq_active'
        WHEN url LIKE 'kicktraq_full_scan:%' THEN 'kicktraq_full_scan'
        ELSE 'webrobots'
      END as source,
      COUNT(*) as runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      MAX(completed_at) as last_completed_at,
      SUM(COALESCE(records_imported, 0)) as records_imported
    FROM sync_logs
    GROUP BY source
    ORDER BY last_completed_at DESC
  `).all();

  return {
    generatedAt: now,
    totals: {
      totalProjects: Number(totals.total_projects ?? 0),
      liveProjects: Number(totals.live_projects ?? 0),
      webrobotsProjects: Number(totals.webrobots_projects ?? 0),
      ksLiveProjects: Number(totals.ks_live_projects ?? 0),
      kicktraqProjects: Number(totals.kicktraq_projects ?? 0),
      missingSourceUrl: Number(totals.missing_source_url ?? 0),
      missingSlug: Number(totals.missing_slug ?? 0),
      missingLaunchDate: Number(totals.missing_launch_date ?? 0),
    },
    snapshots: {
      totalSnapshots: Number(snapshots.total_snapshots ?? 0),
      snapshots24h: Number(snapshots.snapshots_24h ?? 0),
      projectsWithSnapshots: Number(snapshots.projects_with_snapshots ?? 0),
      latestSnapshotAt: snapshots.latest_snapshot_at ?? null,
      staleLiveProjects: staleLive.c ?? 0,
    },
    tracking: {
      trackedProjects: Number(tracking.tracked_projects ?? 0),
      dueProjects: Number(tracking.due_projects ?? 0),
      liveTrackable: Number(liveTracking.live_trackable ?? 0),
      autoTrackedLive: Number(liveTracking.auto_tracked_live ?? 0),
      untrackedLive: Number(liveTracking.untracked_live ?? 0),
    },
    sourceHealth,
    syncSources,
    recentRuns,
    recentErrors,
  };
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

export function getLiveIntel(limit = 12) {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - 24 * 3600;
  const cutoff6h = now - 6 * 3600;
  const safeLimit = Math.max(1, Math.min(limit, 50));

  const baseCte = `
    WITH latest AS (
      SELECT project_id, MAX(captured_at) as latest_at
      FROM project_snapshots
      GROUP BY project_id
    ),
    latest_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN latest l ON l.project_id = s.project_id AND l.latest_at = s.captured_at
    ),
    prior24 AS (
      SELECT l.project_id, MAX(s.captured_at) as prior_at
      FROM latest l
      JOIN project_snapshots s ON s.project_id = l.project_id AND s.captured_at <= @cutoff24h
      GROUP BY l.project_id
    ),
    prior24_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN prior24 p ON p.project_id = s.project_id AND p.prior_at = s.captured_at
    ),
    prior6 AS (
      SELECT l.project_id, MAX(s.captured_at) as prior_at
      FROM latest l
      JOIN project_snapshots s ON s.project_id = l.project_id AND s.captured_at <= @cutoff6h
      GROUP BY l.project_id
    ),
    prior6_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN prior6 p ON p.project_id = s.project_id AND p.prior_at = s.captured_at
    ),
    live_rows AS (
      SELECT
        p.id, p.name, p.blurb, p.goal, p.state, p.country, p.currency,
        p.category_parent, p.category_name, p.backers_count, p.usd_pledged,
        p.launched_at, p.deadline, p.source_url, p.image_url, p.image_thumb_url,
        COALESCE(ls.pledged_usd, p.usd_pledged) as pledged_usd,
        COALESCE(ls.backers_count, p.backers_count) as live_backers_count,
        ls.captured_at as latest_snapshot_at,
        COALESCE(ls.state, p.state) as live_state,
        COALESCE(ls.pledged_usd, p.usd_pledged) - COALESCE(p24.pledged_usd, COALESCE(ls.pledged_usd, p.usd_pledged)) as pledged_delta_24h,
        COALESCE(ls.backers_count, p.backers_count) - COALESCE(p24.backers_count, COALESCE(ls.backers_count, p.backers_count)) as backers_delta_24h,
        COALESCE(ls.pledged_usd, p.usd_pledged) - COALESCE(p6.pledged_usd, COALESCE(ls.pledged_usd, p.usd_pledged)) as pledged_delta_6h,
        COALESCE(ls.backers_count, p.backers_count) - COALESCE(p6.backers_count, COALESCE(ls.backers_count, p.backers_count)) as backers_delta_6h,
        CASE WHEN p.goal > 0 THEN ROUND((COALESCE(ls.pledged_usd, p.usd_pledged) / p.goal) * 100, 1) ELSE 0 END as funded_pct,
        CASE
          WHEN p.deadline > @now AND p.launched_at IS NOT NULL AND p.launched_at < @now
          THEN ROUND((COALESCE(ls.pledged_usd, p.usd_pledged) / MAX(1, @now - p.launched_at)) * (p.deadline - p.launched_at), 0)
          ELSE COALESCE(ls.pledged_usd, p.usd_pledged)
        END as projected_usd
      FROM projects p
      LEFT JOIN latest_snap ls ON ls.project_id = p.id
      LEFT JOIN prior24_snap p24 ON p24.project_id = p.id
      LEFT JOIN prior6_snap p6 ON p6.project_id = p.id
      WHERE COALESCE(ls.state, p.state) = 'live'
    )
  `;

  const params = { now, cutoff24h, cutoff6h, limit: safeLimit };
  const selectProject = `
    SELECT id, name, blurb, goal, state, country, currency, category_parent, category_name,
           launched_at, deadline, source_url, image_url, image_thumb_url,
           pledged_usd, live_backers_count, latest_snapshot_at,
           pledged_delta_24h, backers_delta_24h, pledged_delta_6h, backers_delta_6h,
           funded_pct, projected_usd
    FROM live_rows
  `;

  const fastestFunding = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE pledged_delta_24h > 0
    ORDER BY pledged_delta_24h DESC, pledged_usd DESC
    LIMIT @limit
  `).all(params);

  const fastestBackers = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE backers_delta_24h > 0
    ORDER BY backers_delta_24h DESC, live_backers_count DESC
    LIMIT @limit
  `).all(params);

  const newlyLaunched = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE launched_at IS NOT NULL
    ORDER BY launched_at DESC
    LIMIT @limit
  `).all(params);

  const endingSoon = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE deadline > @now
    ORDER BY deadline ASC
    LIMIT @limit
  `).all(params);

  const overfunded = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE goal > 0 AND funded_pct >= 100
    ORDER BY funded_pct DESC, pledged_usd DESC
    LIMIT @limit
  `).all(params);

  const categories = db.prepare(`
    ${baseCte}
    SELECT
      COALESCE(category_parent, 'Uncategorized') as category,
      COUNT(*) as live_projects,
      SUM(pledged_delta_24h) as pledged_delta_24h,
      SUM(backers_delta_24h) as backers_delta_24h,
      ROUND(AVG(funded_pct), 1) as avg_funded_pct,
      SUM(CASE WHEN funded_pct >= 100 THEN 1 ELSE 0 END) as overfunded_projects
    FROM live_rows
    GROUP BY COALESCE(category_parent, 'Uncategorized')
    ORDER BY pledged_delta_24h DESC, live_projects DESC
    LIMIT 10
  `).all(params);

  const summary = db.prepare(`
    ${baseCte}
    SELECT
      COUNT(*) as live_projects,
      SUM(pledged_delta_24h) as pledged_delta_24h,
      SUM(backers_delta_24h) as backers_delta_24h,
      SUM(CASE WHEN launched_at >= @cutoff24h THEN 1 ELSE 0 END) as launched_24h,
      SUM(CASE WHEN deadline BETWEEN @now AND @now + 86400 THEN 1 ELSE 0 END) as ending_24h,
      SUM(CASE WHEN funded_pct >= 100 THEN 1 ELSE 0 END) as overfunded_projects
    FROM live_rows
  `).get(params);

  return {
    generatedAt: now,
    summary,
    fastestFunding,
    fastestBackers,
    newlyLaunched,
    endingSoon,
    overfunded,
    categories,
  };
}

export async function getProjectById(id: string) {
  return getDB().prepare(
    `SELECT id, name, blurb, state, country, country_name, currency,
            category_id, category_parent, category_name, goal, pledged, usd_pledged,
            backers_count, staff_pick, created_at, launched_at, deadline,
            creator_name, creator_slug, source_url, slug, image_url, image_thumb_url
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
  pledged_usd?: number | null;
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
      usd_pledged   = CASE WHEN @pledged_usd IS NOT NULL AND @pledged_usd > 0 THEN @pledged_usd ELSE usd_pledged END,
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
    pledged_usd: ktData.pledged_usd ?? null,
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

export function getDueProjects(limit = 25): { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number }[] {
  const now = Math.floor(Date.now() / 1000);
  return getDB().prepare(`
    SELECT project_id, priority, track_rewards, track_comments, track_text_diff
    FROM tracking_settings WHERE is_tracking = 1 AND (next_fetch IS NULL OR next_fetch <= ?)
    ORDER BY priority DESC, priority_score DESC, COALESCE(next_fetch, 0) ASC, last_fetched ASC
    LIMIT ?
  `).all(now, limit) as { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number }[];
}

export function autoTrackLiveProjects(limit = 250): { inserted: number; reactivated: number; totalTrackable: number; remaining: number } {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const jitterWindow = 2 * 3600;

  const totalRow = db.prepare(`
    SELECT COUNT(*) as c
    FROM projects p
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as { c: number };

  const candidates = db.prepare(`
    SELECT p.id, t.project_id as tracked, t.is_tracking
    FROM projects p
    LEFT JOIN tracking_settings t ON t.project_id = p.id
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
      AND (t.project_id IS NULL OR t.is_tracking = 0)
    ORDER BY COALESCE(p.deadline, 0) ASC, COALESCE(p.last_seen_at, 0) DESC
    LIMIT ?
  `).all(limit) as { id: string; tracked: string | null; is_tracking: number | null }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tracking_settings
      (project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff,
       priority, subscriber_count, priority_score, next_fetch)
    VALUES
      (@project_id, 1, 1, 0, 0, 1, 1, 0, 1, @next_fetch)
  `);
  const reactivate = db.prepare(`
    UPDATE tracking_settings
    SET is_tracking = 1,
        track_rewards = 1,
        track_text_diff = 1,
        priority = MAX(priority, 1),
        priority_score = MAX(priority_score, 1),
        next_fetch = @next_fetch
    WHERE project_id = @project_id
  `);

  let inserted = 0;
  let reactivated = 0;
  const tx = db.transaction(() => {
    candidates.forEach((project, index) => {
      const next_fetch = now + Math.floor((index / Math.max(1, candidates.length)) * jitterWindow);
      if (project.tracked) {
        reactivate.run({ project_id: project.id, next_fetch });
        reactivated++;
      } else {
        const result = insert.run({ project_id: project.id, next_fetch });
        if (result.changes) inserted++;
      }
    });
  });
  tx();

  const trackedRow = db.prepare(`
    SELECT COUNT(*) as c
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1
      AND p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as { c: number };

  return {
    inserted,
    reactivated,
    totalTrackable: totalRow.c,
    remaining: Math.max(0, totalRow.c - trackedRow.c),
  };
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
    SELECT s.captured_at, s.pledged_usd, s.backers_count, s.days_to_go,
           s.comments_count, s.updates_count, s.state, s.source
    FROM project_snapshots s
    JOIN projects p ON p.id = s.project_id
    WHERE s.project_id = ?
      AND NOT (s.source = 'kicktraq_active' AND COALESCE(p.currency, 'USD') <> 'USD')
      AND NOT (
        s.source = 'ks'
        AND COALESCE(s.pledged_usd, 0) = 0
        AND COALESCE(s.backers_count, 0) = 0
        AND (COALESCE(p.usd_pledged, 0) > 0 OR COALESCE(p.backers_count, 0) > 0)
      )
    ORDER BY s.captured_at ASC LIMIT ?
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
