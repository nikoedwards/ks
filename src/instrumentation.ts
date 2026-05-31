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

    console.log('[Kicksonar] Cron jobs registered (daily webrobots check at 4:00 AM)');
  }
}
