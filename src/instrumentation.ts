import cron from 'node-cron';
import { runSync, getLatestDatasetUrl } from './lib/sync';
import { getSyncState } from './lib/syncState';
import { getLastSync } from './lib/db';
import { initTracker } from './lib/tracker';

async function checkWebrobotsDataset(reason: string) {
  const lastSync = await getLastSync() as { url?: string; status?: string } | null;
  const latestUrl = await getLatestDatasetUrl();
  const alreadySynced = lastSync?.status === 'completed' && lastSync?.url === latestUrl;

  if (alreadySynced) {
    console.log(`[Kicksonar] webrobots dataset is up to date during ${reason}, skipping sync.`);
    return;
  }

  const state = getSyncState();
  if (state.status === 'running') return;
  console.log(`[Kicksonar] New webrobots dataset detected during ${reason}: ${latestUrl.split('/').pop()}, starting sync...`);
  runSync().catch(e => console.error(`[Kicksonar] Auto-sync from ${reason} failed:`, e));
}

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Start background tracker immediately on server boot.
    initTracker();
    console.log('[Kicksonar] Background tracker initialized');

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
