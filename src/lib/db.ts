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
  page?: number;
  limit?: number;
}

export async function getProjects(filter: ProjectFilter = {}) {
  const db = getDB();
  const { state, category, country, search, sort = 'usd_pledged', page = 1, limit = 20 } = filter;

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (state && state !== 'all') { conditions.push('state = @state'); params.state = state; }
  if (category) { conditions.push('category_parent = @category'); params.category = category; }
  if (country) { conditions.push('country = @country'); params.country = country; }
  if (search) { conditions.push('(name LIKE @search OR blurb LIKE @search)'); params.search = `%${search}%`; }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const sortMap: Record<string, string> = {
    usd_pledged: 'usd_pledged DESC',
    backers: 'backers_count DESC',
    goal: 'goal DESC',
    launched: 'launched_at DESC',
    funding_rate: '(CASE WHEN goal>0 THEN usd_pledged/goal ELSE 0 END) DESC',
  };
  const orderBy = sortMap[sort] || 'usd_pledged DESC';
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM projects ${where}`).get(params) as { c: number };
  const total = countRow?.c ?? 0;

  const rows = db.prepare(
    `SELECT id, name, blurb, state, country, country_name, currency,
            category_parent, category_name, goal, pledged, usd_pledged,
            backers_count, staff_pick, launched_at, deadline, source_url
     FROM projects ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });

  return { total, rows, page, limit };
}

export async function getCategories() {
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
    WHERE category_parent IS NOT NULL AND state IN ('successful','failed')
    GROUP BY category_parent ORDER BY total DESC LIMIT 25
  `).all();
}

export async function getTrends() {
  return getDB().prepare(`
    SELECT
      strftime('%Y-%m', datetime(launched_at, 'unixepoch')) as month,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m
    FROM projects
    WHERE launched_at IS NOT NULL AND state IN ('successful','failed')
      AND launched_at > strftime('%s', date('now', '-36 months'))
    GROUP BY month ORDER BY month ASC
  `).all();
}

export async function getCountries() {
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
    WHERE country IS NOT NULL AND state IN ('successful','failed')
    GROUP BY country ORDER BY total DESC LIMIT 20
  `).all();
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
  ).run(log);
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
