import { getDueProjects, getProjectById, upsertTrackingSettings } from './db';
import { buildKSJsonUrl, scrapeAndStore, extractCreatorSlug, extractProjectSlug } from './scraper';
import { runKickstarterLiveSync } from './kickstarterLive';
import { runKicktraqActiveSync } from './kicktraqActive';

let started = false;

// Track last time we ran discovery syncs
let lastLiveSync = 0;
let lastKicktraqSync = 0;

// Live sync every 2 hours, kicktraq sync every 6 hours
const LIVE_SYNC_INTERVAL = 2 * 60 * 60 * 1000;
const KICKTRAQ_SYNC_INTERVAL = 6 * 60 * 60 * 1000;

export function initTracker() {
  if (started || typeof window !== 'undefined') return;
  started = true;
  // Delay 10s on startup so the server finishes booting, then poll every 5min
  setTimeout(() => {
    runCycle();
    setInterval(runCycle, 5 * 60 * 1000);
  }, 10_000);
}

async function runCycle() {
  const now = Date.now();

  // ── 1. Scrape tracked projects ──────────────────────────────────────────────
  try {
    const due = getDueProjects();
    if (due.length) {
      console.log(`[tracker] ${due.length} project(s) due for scraping`);
      for (const { project_id, track_rewards, track_comments, track_text_diff } of due) {
        const project = await getProjectById(project_id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
        if (!project) continue;

        // Try to build a valid KS JSON URL
        let jsonUrl = buildKSJsonUrl(project.source_url ?? '');

        // Fallback: reconstruct URL from creator_slug + slug if source_url is a category URL
        if (!jsonUrl && project.creator_slug && project.slug) {
          const reconstructed = `https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`;
          jsonUrl = buildKSJsonUrl(reconstructed);
          if (jsonUrl) {
            // Persist the corrected URL so we don't have to reconstruct every time
            console.log(`[tracker] Reconstructed URL for ${project_id}: ${reconstructed}`);
          }
        }

        // Last resort: try to extract slugs from source_url even if it's a category URL
        if (!jsonUrl && project.source_url) {
          const creatorSlug = extractCreatorSlug(project.source_url);
          const projectSlug = extractProjectSlug(project.source_url);
          if (creatorSlug && projectSlug) {
            const reconstructed = `https://www.kickstarter.com/projects/${creatorSlug}/${projectSlug}`;
            jsonUrl = buildKSJsonUrl(reconstructed);
          }
        }

        if (!jsonUrl) {
          console.warn(`[tracker] Cannot build JSON URL for project ${project_id}, source_url=${project.source_url}`);
          // Mark as fetched with a long delay so we don't keep retrying immediately
          upsertTrackingSettings({ project_id, next_fetch: Math.floor(Date.now() / 1000) + 24 * 3600 });
          continue;
        }

        const ok = await scrapeAndStore(project_id, jsonUrl, { track_rewards, track_comments, track_text_diff });
        if (!ok) {
          console.warn(`[tracker] Scrape failed for ${project_id}, will retry in 30min`);
          upsertTrackingSettings({ project_id, next_fetch: Math.floor(Date.now() / 1000) + 30 * 60 });
        }

        await sleep(600);
      }
    }
  } catch (e) {
    console.error('[tracker] scrape cycle error:', e);
  }

  // ── 2. Periodic KS live discovery (new projects) ────────────────────────────
  if (now - lastLiveSync > LIVE_SYNC_INTERVAL) {
    lastLiveSync = now;
    console.log('[tracker] Starting KS live discovery sync...');
    runKickstarterLiveSync({
      state: 'live',
      maxPages: 10,
      since: Math.floor(Date.now() / 1000) - 3 * 24 * 3600, // last 3 days
    }).then(result => {
      console.log(`[tracker] KS live sync done: ${result.insertedOrUpdated} upserted, stopped=${result.stoppedReason}`);
    }).catch(e => {
      console.error('[tracker] KS live sync error:', e);
    });
  }

  // ── 3. Periodic Kicktraq active discovery ───────────────────────────────────
  if (now - lastKicktraqSync > KICKTRAQ_SYNC_INTERVAL) {
    lastKicktraqSync = now;
    console.log('[tracker] Starting Kicktraq active sync...');
    runKicktraqActiveSync({
      maxPages: 5,
      onlyCurrentlyLive: true,
    }).then(result => {
      console.log(`[tracker] Kicktraq active sync done: ${result.imported} imported, stopped=${result.stoppedReason}`);
    }).catch(e => {
      console.error('[tracker] Kicktraq active sync error:', e);
    });
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
