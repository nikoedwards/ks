import cron from 'node-cron';
import { runSync, getLatestDatasetUrl } from './lib/sync';
import { getSyncState } from './lib/syncState';
import { getLastSync } from './lib/db';
import { initTracker } from './lib/tracker';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // ── Start background tracker immediately on server boot ──────────────────
    initTracker();
    console.log('[Kicksonar] Background tracker initialized');

    // ── Monthly webrobots sync: 15th of each month at 3:00 AM ───────────────
    cron.schedule('0 3 15 * *', async () => {
      const state = getSyncState();
      if (state.status === 'running') return;
      console.log('[Kicksonar] Running scheduled monthly webrobots sync...');
      try {
        await runSync();
        console.log('[Kicksonar] Scheduled sync completed.');
      } catch (e) {
        console.error('[Kicksonar] Scheduled sync failed:', e);
      }
    });

    // ── On startup: check if a newer webrobots dataset is available ──────────
    // Runs 30s after boot to avoid blocking startup
    setTimeout(async () => {
      try {
        const lastSync = await getLastSync() as { url?: string; status?: string } | null;
        const latestUrl = await getLatestDatasetUrl();

        const alreadySynced = lastSync?.status === 'completed' && lastSync?.url === latestUrl;
        if (!alreadySynced) {
          const state = getSyncState();
          if (state.status !== 'running') {
            console.log(`[Kicksonar] New webrobots dataset detected: ${latestUrl.split('/').pop()}, starting sync...`);
            runSync().catch(e => console.error('[Kicksonar] Auto-sync on startup failed:', e));
          }
        } else {
          console.log('[Kicksonar] webrobots dataset is up to date, skipping auto-sync.');
        }
      } catch (e) {
        console.error('[Kicksonar] Startup dataset check failed:', e);
      }
    }, 30_000);

    console.log('[Kicksonar] Cron jobs registered (monthly sync on 15th at 3:00 AM)');
  }
}
