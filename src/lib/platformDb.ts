import fs from 'fs';
import path from 'path';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import {
  getPlatformDefinition,
  isPlatformId,
  isPlatformViewId,
  type PlatformDefinition,
  type PlatformId,
  type PlatformViewId,
} from './platforms';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const PLATFORM_DIR = path.join(DATA_DIR, 'platforms');
const GLOBAL_DB_PATH = path.join(DATA_DIR, 'global_crowdfunding.db');
const LEGACY_KICKSTARTER_DB_PATH = path.join(DATA_DIR, 'kickstarter.db');

export type PlatformAction = 'init_db' | 'validate_config' | 'dry_run_capabilities' | 'crawl' | 'import' | 'export';

interface TableCount {
  table: string;
  rows: number;
}

export interface PlatformQuality {
  ok: true;
  view: PlatformViewId;
  scope: 'legacy' | 'source' | 'global';
  platform: PlatformDefinition | null;
  database: {
    path: string;
    exists: boolean;
    fileBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    tableCounts: TableCount[];
  };
  status: {
    state: 'legacy_active' | 'planned_empty' | 'initialized' | 'aggregate_empty';
    message: string;
  };
  isolation: {
    writesToLegacyKickstarterDb: boolean;
    canInitialize: boolean;
    canRunCrawler: boolean;
    canImport: boolean;
    canExport: boolean;
    automaticJobsEnabled: boolean;
  };
  recentRuns: unknown[];
  recentErrors: unknown[];
}

function safeStatBytes(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function platformDbPath(platform: PlatformId) {
  return path.join(PLATFORM_DIR, `${platform}.db`);
}

function openDb(dbPath: string): Database {
  ensureDir(path.dirname(dbPath));
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  return db;
}

function tableExists(db: Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function countTables(dbPath: string, tables: string[]): TableCount[] {
  if (!fs.existsSync(dbPath)) return [];
  try {
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      return tables.map(table => {
        if (!tableExists(db, table)) return { table, rows: 0 };
        const row = db.prepare(`SELECT COUNT(*) as rows FROM ${table}`).get() as { rows: number };
        return { table, rows: Number(row.rows ?? 0) };
      });
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

const SOURCE_TABLES = [
  'platform_projects',
  'platform_snapshots',
  'platform_raw_payloads',
  'platform_crawl_runs',
  'platform_crawler_errors',
];

const GLOBAL_TABLES = [
  'global_projects',
  'global_snapshots',
  'global_refresh_runs',
];

function ensureSourceSchema(db: Database, platform: PlatformId) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_projects (
      platform_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      canonical_key TEXT,
      name TEXT NOT NULL,
      blurb TEXT,
      state TEXT,
      category TEXT,
      country TEXT,
      currency TEXT,
      goal_amount REAL,
      pledged_amount REAL,
      pledged_usd REAL,
      backers_count INTEGER,
      launched_at INTEGER,
      deadline INTEGER,
      source_url TEXT,
      image_url TEXT,
      raw_status TEXT,
      first_seen_at INTEGER DEFAULT (unixepoch()),
      last_seen_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (platform_id, source_project_id),
      CHECK (platform_id = '${platform}')
    );

    CREATE TABLE IF NOT EXISTS platform_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      pledged_amount REAL,
      pledged_usd REAL,
      backers_count INTEGER,
      comments_count INTEGER,
      state TEXT,
      source TEXT NOT NULL,
      CHECK (platform_id = '${platform}'),
      UNIQUE(platform_id, source_project_id, captured_at, source)
    );

    CREATE TABLE IF NOT EXISTS platform_raw_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      payload_kind TEXT NOT NULL,
      fetched_at INTEGER DEFAULT (unixepoch()),
      status_code INTEGER,
      content_type TEXT,
      payload_bytes INTEGER DEFAULT 0,
      checksum TEXT,
      payload_preview TEXT,
      CHECK (platform_id = '${platform}')
    );

    CREATE TABLE IF NOT EXISTS platform_crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
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
      message TEXT,
      CHECK (platform_id = '${platform}')
    );

    CREATE TABLE IF NOT EXISTS platform_crawler_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      job_type TEXT,
      source_project_id TEXT,
      url TEXT,
      status_code INTEGER,
      message TEXT NOT NULL,
      occurred_at INTEGER DEFAULT (unixepoch()),
      context_json TEXT,
      CHECK (platform_id = '${platform}')
    );

    CREATE INDEX IF NOT EXISTS idx_platform_projects_state ON platform_projects(platform_id, state, last_seen_at);
    CREATE INDEX IF NOT EXISTS idx_platform_snapshots_project ON platform_snapshots(platform_id, source_project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_platform_runs_platform ON platform_crawl_runs(platform_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_platform_errors_platform ON platform_crawler_errors(platform_id, occurred_at);
  `);
}

function ensureGlobalSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS global_projects (
      platform_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      global_project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      blurb TEXT,
      state TEXT,
      category TEXT,
      country TEXT,
      currency TEXT,
      goal_amount REAL,
      pledged_amount REAL,
      pledged_usd REAL,
      backers_count INTEGER,
      launched_at INTEGER,
      deadline INTEGER,
      source_url TEXT,
      image_url TEXT,
      refreshed_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (platform_id, source_project_id)
    );

    CREATE TABLE IF NOT EXISTS global_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_id TEXT NOT NULL,
      source_project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      pledged_amount REAL,
      pledged_usd REAL,
      backers_count INTEGER,
      state TEXT,
      UNIQUE(platform_id, source_project_id, captured_at)
    );

    CREATE TABLE IF NOT EXISTS global_refresh_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      platform_count INTEGER DEFAULT 0,
      project_count INTEGER DEFAULT 0,
      snapshot_count INTEGER DEFAULT 0,
      message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_global_projects_platform ON global_projects(platform_id, state, launched_at);
    CREATE INDEX IF NOT EXISTS idx_global_snapshots_project ON global_snapshots(platform_id, source_project_id, captured_at);
  `);
}

export function initializePlatformSourceDb(platform: PlatformId) {
  if (platform === 'kickstarter') {
    throw new Error('Kickstarter is managed by the legacy database and cannot be initialized through the platform adapter.');
  }
  const db = openDb(platformDbPath(platform));
  try {
    ensureSourceSchema(db, platform);
  } finally {
    db.close();
  }
}

export function initializeGlobalDb() {
  const db = openDb(GLOBAL_DB_PATH);
  try {
    ensureGlobalSchema(db);
  } finally {
    db.close();
  }
}

export function getPlatformQuality(view: PlatformViewId): PlatformQuality {
  if (!isPlatformViewId(view)) {
    throw new Error(`Unknown platform view: ${view}`);
  }

  if (view === 'global') {
    const exists = fs.existsSync(GLOBAL_DB_PATH);
    const counts = countTables(GLOBAL_DB_PATH, GLOBAL_TABLES);
    return {
      ok: true,
      view,
      scope: 'global',
      platform: null,
      database: {
        path: GLOBAL_DB_PATH,
        exists,
        fileBytes: safeStatBytes(GLOBAL_DB_PATH),
        walBytes: safeStatBytes(`${GLOBAL_DB_PATH}-wal`),
        shmBytes: safeStatBytes(`${GLOBAL_DB_PATH}-shm`),
        tableCounts: counts,
      },
      status: {
        state: exists ? 'initialized' : 'aggregate_empty',
        message: exists
          ? 'Global aggregation database is initialized. It is rebuildable and does not write back to source databases.'
          : 'Global aggregation database has not been initialized yet. Empty state is expected in phase one.',
      },
      isolation: {
        writesToLegacyKickstarterDb: false,
        canInitialize: true,
        canRunCrawler: false,
        canImport: false,
        canExport: false,
        automaticJobsEnabled: false,
      },
      recentRuns: [],
      recentErrors: [],
    };
  }

  if (!isPlatformId(view)) {
    throw new Error(`Unknown platform: ${view}`);
  }

  const platform = getPlatformDefinition(view);

  if (view === 'kickstarter') {
    return {
      ok: true,
      view,
      scope: 'legacy',
      platform,
      database: {
        path: LEGACY_KICKSTARTER_DB_PATH,
        exists: fs.existsSync(LEGACY_KICKSTARTER_DB_PATH),
        fileBytes: safeStatBytes(LEGACY_KICKSTARTER_DB_PATH),
        walBytes: safeStatBytes(`${LEGACY_KICKSTARTER_DB_PATH}-wal`),
        shmBytes: safeStatBytes(`${LEGACY_KICKSTARTER_DB_PATH}-shm`),
        tableCounts: [],
      },
      status: {
        state: 'legacy_active',
        message: 'Kickstarter remains on the existing stable database and crawler pipeline.',
      },
      isolation: {
        writesToLegacyKickstarterDb: true,
        canInitialize: false,
        canRunCrawler: true,
        canImport: true,
        canExport: true,
        automaticJobsEnabled: true,
      },
      recentRuns: [],
      recentErrors: [],
    };
  }

  const dbPath = platformDbPath(view);
  const exists = fs.existsSync(dbPath);
  return {
    ok: true,
    view,
    scope: 'source',
    platform,
    database: {
      path: dbPath,
      exists,
      fileBytes: safeStatBytes(dbPath),
      walBytes: safeStatBytes(`${dbPath}-wal`),
      shmBytes: safeStatBytes(`${dbPath}-shm`),
      tableCounts: countTables(dbPath, SOURCE_TABLES),
    },
    status: {
      state: exists ? 'initialized' : 'planned_empty',
      message: exists
        ? `${platform.label} isolated source database is initialized. Crawlers remain disabled in phase one.`
        : `${platform.label} is registered but has no source database yet. Use init_db to create an isolated empty DB.`,
    },
    isolation: {
      writesToLegacyKickstarterDb: false,
      canInitialize: true,
      canRunCrawler: false,
      canImport: false,
      canExport: false,
      automaticJobsEnabled: false,
    },
    recentRuns: [],
    recentErrors: [],
  };
}

export function runPlatformAction(view: PlatformViewId, action: PlatformAction) {
  if (!isPlatformViewId(view)) {
    return { status: 404, payload: { ok: false, error: `Unknown platform: ${view}` } };
  }

  if (action === 'crawl' || action === 'import' || action === 'export') {
    return {
      status: 501,
      payload: {
        ok: false,
        action,
        error: `${action} is not implemented in phase one. No crawler/import/export job was started.`,
      },
    };
  }

  if (action === 'validate_config' || action === 'dry_run_capabilities') {
    return {
      status: 200,
      payload: {
        ok: true,
        action,
        quality: getPlatformQuality(view),
        message: 'Configuration is readable. No crawler, import, or export side effect was performed.',
      },
    };
  }

  if (action === 'init_db') {
    if (view === 'global') {
      initializeGlobalDb();
      return {
        status: 200,
        payload: {
          ok: true,
          action,
          quality: getPlatformQuality(view),
          message: 'Initialized Global aggregation database.',
        },
      };
    }

    if (view === 'kickstarter') {
      return {
        status: 409,
        payload: {
          ok: false,
          action,
          error: 'Kickstarter uses the existing legacy database; init_db is disabled to protect it.',
        },
      };
    }

    initializePlatformSourceDb(view);
    return {
      status: 200,
      payload: {
        ok: true,
        action,
        quality: getPlatformQuality(view),
        message: `Initialized isolated database for ${getPlatformDefinition(view).label}.`,
      },
    };
  }

  return { status: 400, payload: { ok: false, error: `Unsupported action: ${action}` } };
}
