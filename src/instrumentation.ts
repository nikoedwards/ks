import cron from 'node-cron';
import { randomUUID } from 'crypto';
import { runSync, getLatestDatasetUrl } from './lib/sync';
import { getSyncState } from './lib/syncState';
import { isDatasetImported, prewarmAnalyticsCaches, acquireProcessLock } from './lib/db';
import { initTracker } from './lib/tracker';

// Per-process identity for the cross-process webrobots-import lock (id 2). The
// in-memory getSyncState() can't see other replicas, so without this both
// instances on the shared SQLite volume could start the ~270k-row import at
// once. TTL is generous (45 min) since the import is long and the lock isn't
// refreshed mid-run.
const SYNC_OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;
const SYNC_LOCK_TTL_SEC = 45 * 60;

// Per-process identity for the Indiegogo cross-replica locks (ids 3 discover, 4 track).
const INDIEGOGO_OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;
const INDIEGOGO_DISCOVER_LOCK_TTL_SEC = 10 * 60;
const INDIEGOGO_TRACK_LOCK_TTL_SEC = 20 * 60;
const INDIEGOGO_BACKLOG_LOCK_TTL_SEC = 20 * 60;

function indiegogoCrawlerEnabled() {
  return process.env.INDIEGOGO_CRAWLER_ENABLED === '1';
}

async function runIndiegogoDiscover() {
  if (!indiegogoCrawlerEnabled()) return;
  if (!acquireProcessLock(3, INDIEGOGO_OWNER, INDIEGOGO_DISCOVER_LOCK_TTL_SEC)) return;
  const igg = await import('./lib/indiegogo');
  const res = await igg.discoverIndiegogoIncremental();
  if (!res.ok) console.warn('[Kicksonar] Indiegogo discover pass:', res.message ?? 'failed');
}

async function runIndiegogoTrack() {
  if (!indiegogoCrawlerEnabled()) return;
  if (!acquireProcessLock(4, INDIEGOGO_OWNER, INDIEGOGO_TRACK_LOCK_TTL_SEC)) return;
  const igg = await import('./lib/indiegogo');
  await igg.trackIndiegogoLive();
}

async function runIndiegogoBacklog() {
  if (!indiegogoCrawlerEnabled()) return;
  if (!acquireProcessLock(5, INDIEGOGO_OWNER, INDIEGOGO_BACKLOG_LOCK_TTL_SEC)) return;
  const igg = await import('./lib/indiegogo');
  // One budget-bounded chunk per tick; resumable. Manual pause is respected
  // (paused slices are not picked up), and it no-ops cleanly when the catalog is
  // fully swept or the bulk worker is unhealthy.
  const res = await igg.runIndiegogoBacklogSweep();
  if (!res.ok) console.warn('[Kicksonar] Indiegogo backlog sweep pass:', res.message ?? 'failed');
}

async function checkWebrobotsDataset(reason: string) {
  const latestUrl = await getLatestDatasetUrl();
  const alreadySynced = await isDatasetImported(latestUrl);

  if (alreadySynced) {
    console.log(`[Kicksonar] webrobots dataset is up to date during ${reason}, skipping sync.`);
    return;
  }

  const state = getSyncState();
  if (state.status === 'running') return;
  if (!acquireProcessLock(2, SYNC_OWNER, SYNC_LOCK_TTL_SEC)) {
    console.log(`[Kicksonar] another instance is importing the webrobots dataset; skipping ${reason}.`);
    return;
  }
  console.log(`[Kicksonar] New webrobots dataset detected during ${reason}: ${latestUrl.split('/').pop()}, starting sync...`);
  runSync().catch(e => console.error(`[Kicksonar] Auto-sync from ${reason} failed:`, e));
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Web deployments and staging instances are read-only by default. Only the
    // single production Core writer may explicitly enable scheduled jobs.
    if (process.env.KICKSONAR_JOBS_ENABLED !== '1') {
      console.log('[Kicksonar Web] Background jobs are disabled (set KICKSONAR_JOBS_ENABLED=1 only on Core).');
      return;
    }

    // Start background tracker immediately on server boot.
    initTracker();
    console.log('[Kicksonar] Background tracker initialized');

    // Warm the heavy analytics caches a few seconds after boot so the first
    // leaderboard / homepage / live-intel visit is fast instead of cold.
    setTimeout(() => {
      try {
        prewarmAnalyticsCaches();
        console.log('[Kicksonar] Analytics caches pre-warmed');
      } catch (e) {
        console.error('[Kicksonar] Cache pre-warm failed:', e);
      }
    }, 5_000);

    // Check for a new webrobots dataset every day. Actual imports only run when
    // the latest dataset URL differs from the last completed sync.
    cron.schedule('0 4 * * *', async () => {
      try {
        await checkWebrobotsDataset('daily check');
      } catch (e) {
        console.error('[Kicksonar] Daily webrobots dataset check failed:', e);
      }
    });

    // Runs 30s after boot to avoid blocking startup.
    setTimeout(async () => {
      try {
        await checkWebrobotsDataset('startup');
      } catch (e) {
        console.error('[Kicksonar] Startup dataset check failed:', e);
      }
    }, 30_000);

    // Indiegogo real-time discovery (live worker) + tiered live tracker (detail
    // API, no worker). Both gated by INDIEGOGO_CRAWLER_ENABLED and cross-replica
    // process locks. Discovery is the can't-miss path so it runs more often.
    cron.schedule(process.env.INDIEGOGO_DISCOVER_CRON ?? '*/20 * * * *', async () => {
      try {
        await runIndiegogoDiscover();
      } catch (e) {
        console.error('[Kicksonar] Indiegogo discover cron failed:', e);
      }
    });
    cron.schedule(process.env.INDIEGOGO_TRACK_CRON ?? '*/30 * * * *', async () => {
      try {
        await runIndiegogoTrack();
      } catch (e) {
        console.error('[Kicksonar] Indiegogo track cron failed:', e);
      }
    });
    // Backlog catalog sweep: drains the full-catalog enumeration automatically so
    // it no longer needs manual "运行存量一轮" clicks. Budget-bounded + resumable.
    cron.schedule(process.env.INDIEGOGO_BACKLOG_CRON ?? '*/15 * * * *', async () => {
      try {
        await runIndiegogoBacklog();
      } catch (e) {
        console.error('[Kicksonar] Indiegogo backlog cron failed:', e);
      }
    });

    console.log('[Kicksonar] Cron jobs registered (daily webrobots check at 4:00 AM; Indiegogo discover/track/backlog when enabled)');
  }
}
