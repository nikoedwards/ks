import {
  autoTrackLiveProjects,
  getDueProjects,
  getProjectById,
  getRecentCrawlerErrors,
  recordCrawlerError,
  upsertTrackingSettings,
} from './db';
import { buildKSJsonUrl, scrapeAndStore, extractCreatorSlug, extractProjectSlug } from './scraper';
import { runKickstarterLiveSync } from './kickstarterLive';
import { runKicktraqActiveSync } from './kicktraqActive';

let started = false;

let lastLiveSync = 0;
let lastKicktraqSync = 0;
let lastAutoTrack = 0;

const LIVE_SYNC_INTERVAL = Number(process.env.LIVE_DISCOVERY_INTERVAL_MS ?? 15 * 60 * 1000);
const KICKTRAQ_SYNC_INTERVAL = 6 * 60 * 60 * 1000;
const AUTO_TRACK_INTERVAL = 15 * 60 * 1000;
const TRACKER_CYCLE_INTERVAL = 5 * 60 * 1000;
const TRACKING_BATCH_SIZE = Number(process.env.TRACKER_BATCH_SIZE ?? 20);
const AUTO_TRACK_BATCH_SIZE = Number(process.env.AUTO_TRACK_BATCH_SIZE ?? 250);

export function initTracker() {
  if (started || typeof window !== 'undefined') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  started = true;

  setTimeout(() => {
    runCycle();
    setInterval(runCycle, TRACKER_CYCLE_INTERVAL);
  }, 10_000);
}

async function runCycle() {
  const now = Date.now();

  await enrollLiveProjects(now);
  await scrapeDueProjects();
  startDiscoveryJobs(now);
}

export async function runOfficialPipelineOnce(options: {
  maxPages?: number;
  lookbackDays?: number;
  scrapeDue?: boolean;
} = {}) {
  const now = Date.now();
  const live = await runKickstarterLiveSync({
    state: 'live',
    maxPages: options.maxPages ?? Number(process.env.LIVE_DISCOVERY_MAX_PAGES ?? 5),
    since: Math.floor(Date.now() / 1000) - (options.lookbackDays ?? Number(process.env.LIVE_DISCOVERY_LOOKBACK_DAYS ?? 3)) * 24 * 3600,
  });
  const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
  if (options.scrapeDue ?? true) {
    await scrapeDueProjects();
  }
  lastLiveSync = now;
  lastAutoTrack = now;
  return { live, auto };
}

async function enrollLiveProjects(now: number) {
  if (now - lastAutoTrack <= AUTO_TRACK_INTERVAL) return;
  lastAutoTrack = now;

  try {
    const result = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
    if (result.inserted || result.reactivated || result.remaining) {
      console.log(
        `[tracker] auto-track live projects: inserted=${result.inserted}, reactivated=${result.reactivated}, remaining=${result.remaining}/${result.totalTrackable}`,
      );
    }
  } catch (e) {
    console.error('[tracker] auto-track cycle error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'auto_track_live',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function scrapeDueProjects() {
  try {
    const due = getDueProjects(TRACKING_BATCH_SIZE);
    if (!due.length) return;

    console.log(`[tracker] scraping ${due.length} due project(s)`);
    for (const { project_id, track_comments, track_text_diff } of due) {
      const project = await getProjectById(project_id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
      if (!project) continue;

      const jsonUrl = buildProjectJsonUrl(project);
      if (!jsonUrl) {
        console.warn(`[tracker] Cannot build JSON URL for project ${project_id}, source_url=${project.source_url}`);
        recordCrawlerError({
          source: 'tracker',
          job_type: 'project_json',
          project_id,
          url: project.source_url ?? null,
          message: 'Cannot build Kickstarter JSON URL for project.',
        });
        upsertTrackingSettings({ project_id, next_fetch: Math.floor(Date.now() / 1000) + 24 * 3600 });
        continue;
      }

      const result = await scrapeAndStore(project_id, jsonUrl, { track_rewards: 0, track_comments, track_text_diff });
      if (!result.ok) {
        console.warn(`[tracker] Scrape failed for ${project_id}, will retry in 30min`);
        const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
        const recentDetail = getRecentCrawlerErrors({ projectId: project_id, urls: [jsonUrl, pageUrl], limit: 1 })[0]?.message;
        recordCrawlerError({
          source: 'tracker',
          job_type: 'project_json',
          project_id,
          url: jsonUrl,
          message: recentDetail
            ? `Kickstarter project sync failed: ${recentDetail}`
            : 'Kickstarter project JSON scrape failed.',
        });
        upsertTrackingSettings({ project_id, next_fetch: Math.floor(Date.now() / 1000) + 30 * 60 });
      }

      await sleep(900);
    }
  } catch (e) {
    console.error('[tracker] scrape cycle error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'scrape_due_projects',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

function startDiscoveryJobs(now: number) {
  if (now - lastLiveSync > LIVE_SYNC_INTERVAL) {
    lastLiveSync = now;
    console.log('[tracker] Starting KS live discovery sync...');
    runKickstarterLiveSync({
      state: 'live',
      maxPages: Number(process.env.LIVE_DISCOVERY_MAX_PAGES ?? 5),
      since: Math.floor(Date.now() / 1000) - Number(process.env.LIVE_DISCOVERY_LOOKBACK_DAYS ?? 3) * 24 * 3600,
    }).then(result => {
      console.log(`[tracker] KS live sync done: ${result.insertedOrUpdated} upserted, stopped=${result.stoppedReason}`);
      const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
      console.log(`[tracker] post-KS auto-track: inserted=${auto.inserted}, remaining=${auto.remaining}`);
    }).catch(e => {
      console.error('[tracker] KS live sync error:', e);
      recordCrawlerError({
        source: 'tracker',
        job_type: 'ks_live_discovery',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }

  if (now - lastKicktraqSync > KICKTRAQ_SYNC_INTERVAL) {
    lastKicktraqSync = now;
    console.log('[tracker] Starting Kicktraq active sync...');
    runKicktraqActiveSync({
      maxPages: 5,
      onlyCurrentlyLive: true,
    }).then(result => {
      console.log(`[tracker] Kicktraq active sync done: ${result.imported} imported, stopped=${result.stoppedReason}`);
      const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
      console.log(`[tracker] post-Kicktraq auto-track: inserted=${auto.inserted}, remaining=${auto.remaining}`);
    }).catch(e => {
      console.error('[tracker] Kicktraq active sync error:', e);
      recordCrawlerError({
        source: 'tracker',
        job_type: 'kicktraq_active_discovery',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }
}

function buildProjectJsonUrl(project: { source_url?: string; creator_slug?: string; slug?: string }) {
  let jsonUrl = buildKSJsonUrl(project.source_url ?? '');

  if (!jsonUrl && project.creator_slug && project.slug) {
    jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`);
  }

  if (!jsonUrl && project.source_url) {
    const creatorSlug = extractCreatorSlug(project.source_url);
    const projectSlug = extractProjectSlug(project.source_url);
    if (creatorSlug && projectSlug) {
      jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${creatorSlug}/${projectSlug}`);
    }
  }

  return jsonUrl;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
