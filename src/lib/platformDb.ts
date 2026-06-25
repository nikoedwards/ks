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
import type { IndiegogoImportMode, IndiegogoWebrobotsDiagnostics, IndiegogoBacklogStatus } from './indiegogo';
import type { IndiegogoWorkerHealth } from './indiegogoWorker';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const PLATFORM_DIR = path.join(DATA_DIR, 'platforms');
const GLOBAL_DB_PATH = path.join(DATA_DIR, 'global_crowdfunding.db');
const LEGACY_KICKSTARTER_DB_PATH = path.join(DATA_DIR, 'kickstarter.db');

export type PlatformAction =
  | 'init_db'
  | 'validate_config'
  | 'dry_run_capabilities'
  | 'crawl'
  | 'import'
  | 'export'
  | 'discover'
  | 'track'
  | 'backlog_sweep';

export interface PlatformActionOptions {
  mode?: IndiegogoImportMode;
  maxDatasets?: number;
  wait?: boolean;
  detailLimit?: number;
  staleBefore?: number;
  maxPages?: number;
  trackLimit?: number;
  pageBudget?: number;
  sweepOp?: 'start' | 'pause' | 'resume';
}

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
  webrobots?: IndiegogoWebrobotsDiagnostics;
  workers?: { live: IndiegogoWorkerHealth; bulk: IndiegogoWorkerHealth };
  backlog?: IndiegogoBacklogStatus;
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

export function getPlatformDbPath(platform: PlatformId) {
  return platformDbPath(platform);
}

export function openPlatformSourceDb(platform: PlatformId): Database {
  if (platform === 'kickstarter') {
    throw new Error('Kickstarter is managed by the legacy database and cannot be opened as an isolated platform database.');
  }
  const db = openDb(platformDbPath(platform));
  ensureSourceSchema(db, platform);
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
  'platform_detail_queue',
  'platform_raw_payloads',
  'indiegogo_project_details',
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
      project_url_name TEXT,
      creator_url_name TEXT,
      project_type TEXT,
      is_indemand INTEGER DEFAULT 0,
      is_prelaunch INTEGER DEFAULT 0,
      percent_raised REAL,
      comments_count INTEGER,
      updates_count INTEGER,
      rewards_count INTEGER,
      detail_status TEXT,
      detail_fetched_at INTEGER,
      webrobots_run_id TEXT,
      last_api_seen_at INTEGER,
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
      updates_count INTEGER,
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

    CREATE TABLE IF NOT EXISTS platform_detail_queue (
      platform_id TEXT NOT NULL,
      project_url_name TEXT NOT NULL,
      source_project_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER DEFAULT 1,
      attempts INTEGER DEFAULT 0,
      next_fetch INTEGER,
      last_error TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (platform_id, project_url_name),
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
    CREATE INDEX IF NOT EXISTS idx_platform_projects_slug ON platform_projects(platform_id, project_url_name);
    CREATE INDEX IF NOT EXISTS idx_platform_snapshots_project ON platform_snapshots(platform_id, source_project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_platform_detail_queue_due ON platform_detail_queue(platform_id, status, next_fetch, priority);
    CREATE INDEX IF NOT EXISTS idx_platform_runs_platform ON platform_crawl_runs(platform_id, started_at);
    CREATE INDEX IF NOT EXISTS idx_platform_errors_platform ON platform_crawler_errors(platform_id, occurred_at);
  `);

  if (platform === 'indiegogo') {
    db.exec(`
      CREATE TABLE IF NOT EXISTS indiegogo_project_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT NOT NULL DEFAULT 'indiegogo',
        source_project_id TEXT NOT NULL,
        project_url_name TEXT,
        source TEXT NOT NULL,
        fetched_at INTEGER NOT NULL,
        status_code INTEGER,
        raw_json TEXT NOT NULL,
        detail_json TEXT,
        webrobots_json TEXT,
        webrobots_run_id TEXT,
        payload_bytes INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        CHECK (platform_id = 'indiegogo'),
        UNIQUE(platform_id, source_project_id, source, fetched_at)
      );

      CREATE INDEX IF NOT EXISTS idx_igg_project_details_slug
        ON indiegogo_project_details(platform_id, project_url_name, fetched_at);
      CREATE INDEX IF NOT EXISTS idx_igg_project_details_source
        ON indiegogo_project_details(platform_id, source, fetched_at);

      CREATE TABLE IF NOT EXISTS indiegogo_search_slices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform_id TEXT NOT NULL DEFAULT 'indiegogo',
        sweep_id TEXT NOT NULL,
        slice_key TEXT NOT NULL,
        sort_type INTEGER DEFAULT 0,
        phase INTEGER,
        category TEXT,
        tag INTEGER,
        status TEXT NOT NULL DEFAULT 'pending',
        total_items INTEGER,
        total_pages INTEGER,
        capped INTEGER DEFAULT 0,
        next_page INTEGER DEFAULT 1,
        discovered INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        CHECK (platform_id = 'indiegogo'),
        UNIQUE(platform_id, sweep_id, slice_key)
      );

      CREATE INDEX IF NOT EXISTS idx_igg_search_slices_due
        ON indiegogo_search_slices(platform_id, sweep_id, status, priority);
    `);
  }

  const projectColumns = [
    'ALTER TABLE platform_projects ADD COLUMN project_url_name TEXT',
    'ALTER TABLE platform_projects ADD COLUMN creator_url_name TEXT',
    'ALTER TABLE platform_projects ADD COLUMN project_type TEXT',
    'ALTER TABLE platform_projects ADD COLUMN is_indemand INTEGER DEFAULT 0',
    'ALTER TABLE platform_projects ADD COLUMN is_prelaunch INTEGER DEFAULT 0',
    'ALTER TABLE platform_projects ADD COLUMN percent_raised REAL',
    'ALTER TABLE platform_projects ADD COLUMN comments_count INTEGER',
    'ALTER TABLE platform_projects ADD COLUMN updates_count INTEGER',
    'ALTER TABLE platform_projects ADD COLUMN rewards_count INTEGER',
    'ALTER TABLE platform_projects ADD COLUMN detail_status TEXT',
    'ALTER TABLE platform_projects ADD COLUMN detail_fetched_at INTEGER',
    'ALTER TABLE platform_projects ADD COLUMN webrobots_run_id TEXT',
    'ALTER TABLE platform_projects ADD COLUMN last_api_seen_at INTEGER',
  ];
  for (const sql of projectColumns) {
    try { db.exec(sql); } catch { /* already exists */ }
  }
  try { db.exec('ALTER TABLE platform_snapshots ADD COLUMN updates_count INTEGER'); } catch { /* already exists */ }
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

function recentRows(dbPath: string, table: string, orderColumn: string, limit = 10): unknown[] {
  if (!fs.existsSync(dbPath)) return [];
  try {
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, table)) return [];
      return db.prepare(`SELECT * FROM ${table} ORDER BY ${orderColumn} DESC, id DESC LIMIT ?`).all(limit) as unknown[];
    } finally {
      db.close();
    }
  } catch {
    return [];
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
  const canRunCrawler = platform.capabilities.crawlerImplemented;
  const canImport = platform.capabilities.importImplemented;
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
        ? `${platform.label} isolated source database is initialized.${canRunCrawler || canImport ? ' Manual crawler/import actions are available.' : ' Crawlers remain disabled in phase one.'}`
        : `${platform.label} is registered but has no source database yet. Use init_db to create an isolated empty DB.`,
    },
    isolation: {
      writesToLegacyKickstarterDb: false,
      canInitialize: true,
      canRunCrawler,
      canImport,
      canExport: false,
      automaticJobsEnabled: view === 'indiegogo' && process.env.INDIEGOGO_CRAWLER_ENABLED === '1',
    },
    recentRuns: recentRows(dbPath, 'platform_crawl_runs', 'started_at'),
    recentErrors: recentRows(dbPath, 'platform_crawler_errors', 'occurred_at'),
  };
}

export async function getPlatformQualityForResponse(view: PlatformViewId): Promise<PlatformQuality> {
  const quality = getPlatformQuality(view);
  if (view !== 'indiegogo') return quality;
  const igg = await import('./indiegogo');
  const worker = await import('./indiegogoWorker');
  const [webrobots, liveHealth, bulkHealth] = await Promise.all([
    igg.getIndiegogoWebrobotsDiagnostics(),
    worker.getIndiegogoWorkerHealth('live'),
    worker.getIndiegogoWorkerHealth('bulk'),
  ]);
  return {
    ...quality,
    webrobots,
    workers: { live: liveHealth, bulk: bulkHealth },
    backlog: igg.getIndiegogoBacklogStatus(),
  };
}

export async function runPlatformAction(view: PlatformViewId, action: PlatformAction, options: PlatformActionOptions = {}) {
  if (!isPlatformViewId(view)) {
    return { status: 404, payload: { ok: false, error: `Unknown platform: ${view}` } };
  }

  if (view === 'indiegogo') {
    const igg = await import('./indiegogo');
    if (action === 'validate_config' || action === 'dry_run_capabilities') {
      const validation = await igg.validateIndiegogoConfig();
      return {
        status: 200,
        payload: {
          ok: true,
          action,
          quality: await getPlatformQualityForResponse(view),
          validation,
          message: 'Indiegogo configuration is readable. No crawler/import/export side effect was performed.',
        },
      };
    }
    if (action === 'import') {
      const importOptions = {
        mode: options.mode ?? 'all_available',
        maxDatasets: options.maxDatasets ?? (options.mode === 'missing' ? 1 : undefined),
      };
      if (!options.wait) {
        igg.importIndiegogoWebrobots(importOptions).catch(err => console.error('[indiegogo] Webrobots import failed:', err));
        return {
          status: 202,
          payload: {
            ok: true,
            action,
            message: `Indiegogo Webrobots import started (${importOptions.mode}).`,
          },
        };
      }
      const result = await igg.importIndiegogoWebrobots(importOptions);
      return { status: result.ok ? 200 : 500, payload: { ok: result.ok, action, result } };
    }
    if (action === 'crawl') {
      const detailOptions = {
        limit: options.detailLimit ?? 25,
        staleBefore: options.staleBefore,
      };
      if (!options.wait) {
        (async () => {
          await igg.syncIndiegogoActive();
          await igg.refreshIndiegogoDetails(detailOptions);
        })().catch(err => console.error('[indiegogo] crawl pipeline failed:', err));
        return {
          status: 202,
          payload: {
            ok: true,
            action,
            message: 'Indiegogo active sync and detail refresh started.',
          },
        };
      }
      const active = await igg.syncIndiegogoActive();
      const details = await igg.refreshIndiegogoDetails(detailOptions);
      return {
        status: active.ok && details.ok ? 200 : 500,
        payload: { ok: active.ok && details.ok, action, result: { active, details } },
      };
    }
    if (action === 'discover') {
      const discoverOptions = { maxPages: options.maxPages };
      if (!options.wait) {
        igg.discoverIndiegogoIncremental(discoverOptions).catch(err => console.error('[indiegogo] discover failed:', err));
        return { status: 202, payload: { ok: true, action, message: 'Indiegogo live discovery started.' } };
      }
      const result = await igg.discoverIndiegogoIncremental(discoverOptions);
      return { status: result.ok ? 200 : 500, payload: { ok: result.ok, action, result } };
    }
    if (action === 'track') {
      const trackOptions = { limit: options.trackLimit ?? options.detailLimit };
      if (!options.wait) {
        igg.trackIndiegogoLive(trackOptions).catch(err => console.error('[indiegogo] track failed:', err));
        return { status: 202, payload: { ok: true, action, message: 'Indiegogo tiered live tracking started.' } };
      }
      const result = await igg.trackIndiegogoLive(trackOptions);
      return { status: result.ok ? 200 : 500, payload: { ok: result.ok, action, result } };
    }
    if (action === 'backlog_sweep') {
      const op = options.sweepOp ?? 'start';
      if (op === 'pause') {
        const changed = igg.pauseIndiegogoBacklogSweep();
        return { status: 200, payload: { ok: true, action, op, message: `Paused ${changed} backlog slice(s).`, status_detail: igg.getIndiegogoBacklogStatus() } };
      }
      if (op === 'resume') {
        const changed = igg.resumeIndiegogoBacklogSweep();
        return { status: 200, payload: { ok: true, action, op, message: `Resumed ${changed} backlog slice(s).`, status_detail: igg.getIndiegogoBacklogStatus() } };
      }
      const sweepOptions = { pageBudget: options.pageBudget };
      if (!options.wait) {
        igg.runIndiegogoBacklogSweep(sweepOptions).catch(err => console.error('[indiegogo] backlog sweep failed:', err));
        return { status: 202, payload: { ok: true, action, op, message: 'Indiegogo backlog sweep started.', status_detail: igg.getIndiegogoBacklogStatus() } };
      }
      const result = await igg.runIndiegogoBacklogSweep(sweepOptions);
      return { status: result.ok ? 200 : 500, payload: { ok: result.ok, action, op, result } };
    }
  }

  if (action === 'crawl' || action === 'import' || action === 'export' || action === 'discover' || action === 'track' || action === 'backlog_sweep') {
    return {
      status: 501,
      payload: {
        ok: false,
        action,
        error: `${action} is not implemented for this platform. No job was started.`,
      },
    };
  }

  if (action === 'validate_config' || action === 'dry_run_capabilities') {
    return {
      status: 200,
      payload: {
        ok: true,
        action,
        quality: await getPlatformQualityForResponse(view),
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
          quality: await getPlatformQualityForResponse(view),
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
        quality: await getPlatformQualityForResponse(view),
        message: `Initialized isolated database for ${getPlatformDefinition(view).label}.`,
      },
    };
  }

  return { status: 400, payload: { ok: false, error: `Unsupported action: ${action}` } };
}
