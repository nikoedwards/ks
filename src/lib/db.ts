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
      source_url TEXT,
      slug TEXT
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
      last_fetched INTEGER,
      next_fetch INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
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

  if (state && state !== 'all') { conditions.push('state = @state'); params.state = state; }
  if (category) { conditions.push('category_parent = @category'); params.category = category; }
  if (country) { conditions.push('country = @country'); params.country = country; }
  if (search) { conditions.push('(name LIKE @search OR blurb LIKE @search)'); params.search = `%${search}%`; }
  if (dateFrom) { conditions.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo) { conditions.push('launched_at <= @dateTo'); params.dateTo = dateTo; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const sortMap: Record<string, string> = {
    usd_pledged: `usd_pledged ${dir}`,
    backers: `backers_count ${dir}`,
    goal: `goal ${dir}`,
    launched: `launched_at ${dir}`,
    funding_rate: `(CASE WHEN goal>0 THEN usd_pledged/goal ELSE 0 END) ${dir}`,
  };
  const orderBy = sortMap[sort] || `usd_pledged ${dir}`;
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM projects ${where}`).get(params) as { c: number };
  const total = countRow?.c ?? 0;

  const rows = db.prepare(
    `SELECT id, name, blurb, state, country, country_name, currency,
            category_parent, category_name, goal, pledged, usd_pledged,
            backers_count, staff_pick, launched_at, deadline, source_url, slug
     FROM projects ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
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
    INSERT OR REPLACE INTO projects
      (id, name, blurb, goal, pledged, usd_pledged, state, country, country_name,
       currency, category_id, category_name, category_parent, backers_count,
       staff_pick, created_at, launched_at, deadline, creator_name, source_url, slug)
    VALUES
      (@id, @name, @blurb, @goal, @pledged, @usd_pledged, @state, @country, @country_name,
       @currency, @category_id, @category_name, @category_parent, @backers_count,
       @staff_pick, @created_at, @launched_at, @deadline, @creator_name, @source_url, @slug)
  `);
  const insertMany = db.transaction((items: Record<string, unknown>[]) => {
    for (const row of items) insert.run(row);
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
            creator_name, source_url, slug
     FROM projects WHERE id = ?`
  ).get(id) ?? null;
}

// ─── Tracking ────────────────────────────────────────────────────────────────

export interface TrackingSettings {
  project_id: string;
  is_tracking: number;
  track_rewards: number;
  track_comments: number;
  analyze_comments: number;
  track_text_diff: number;
  priority: number;
  last_fetched: number | null;
  next_fetch: number | null;
  created_at: number;
}

export function getTrackingSettings(projectId: string): TrackingSettings | null {
  return getDB().prepare('SELECT * FROM tracking_settings WHERE project_id = ?').get(projectId) as TrackingSettings | null;
}

export function upsertTrackingSettings(settings: Partial<TrackingSettings> & { project_id: string }) {
  const db = getDB();
  const existing = db.prepare('SELECT project_id, priority FROM tracking_settings WHERE project_id = ?').get(settings.project_id) as { project_id: string; priority: number } | null;
  if (!existing) {
    const priority = settings.priority ?? 1;
    const nextFetch = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO tracking_settings
        (project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority, next_fetch)
      VALUES (@project_id, @is_tracking, @track_rewards, @track_comments, @analyze_comments, @track_text_diff, @priority, @next_fetch)
    `).run({
      project_id: settings.project_id,
      is_tracking: settings.is_tracking ?? 1,
      track_rewards: settings.track_rewards ?? 1,
      track_comments: settings.track_comments ?? 0,
      analyze_comments: settings.analyze_comments ?? 0,
      track_text_diff: settings.track_text_diff ?? 1,
      priority: priority,
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

export function markFetched(projectId: string) {
  const now = Math.floor(Date.now() / 1000);
  const s = getDB().prepare('SELECT priority FROM tracking_settings WHERE project_id = ?').get(projectId) as { priority: number } | null;
  const interval = s?.priority === 2 ? 3600 : 4 * 3600;
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
