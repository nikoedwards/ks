export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const cron = await import('node-cron');
    const { runSync } = await import('./lib/sync');
    const { getSyncState } = await import('./lib/syncState');

    // Run on the 15th of each month at 3:00 AM
    cron.default.schedule('0 3 15 * *', async () => {
      const state = getSyncState();
      if (state.status === 'running') return;
      console.log('[KS Analytics] Running scheduled monthly sync...');
      try {
        await runSync();
        console.log('[KS Analytics] Scheduled sync completed.');
      } catch (e) {
        console.error('[KS Analytics] Scheduled sync failed:', e);
      }
    });

    console.log('[KS Analytics] Cron job registered (15th of each month, 3:00 AM)');
  }
}
