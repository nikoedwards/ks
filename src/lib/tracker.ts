import {
  autoTrackLiveProjects,
  getDueProjects,
  getProjectById,
  getRecentCrawlerErrors,
  markEndedLiveProjects,
  scheduleFinalFetchForEndedProjects,
  recordCrawlerError,
  recordScrapeFailure,
  upsertTrackingSettings,
  getCrawlerState,
  pruneOldDiagnostics,
} from './db';
import { buildKSJsonUrl, scrapeAndStore, extractCreatorSlug, extractProjectSlug } from './scraper';
import { runKickstarterLiveSync } from './kickstarterLive';
import { runKicktraqActiveSync } from './kicktraqActive';

let started = false;

let lastLiveSync = 0;
let lastKicktraqSync = 0;
let lastAutoTrack = 0;
let lastDiagnosticsPrune = 0;

const LIVE_SYNC_INTERVAL = Number(process.env.LIVE_DISCOVERY_INTERVAL_MS ?? 15 * 60 * 1000);
const KICKTRAQ_SYNC_INTERVAL = 6 * 60 * 60 * 1000;
const AUTO_TRACK_INTERVAL = 15 * 60 * 1000;
// Drain the due queue more aggressively. Per-project tracker scrapes use the
// cheap Kicktraq summary path (not the single-lane browser worker), so a bigger
// batch + higher concurrency on a shorter cycle multiplies throughput without
// touching the worker. 120 / 3min ≈ 2,400 projects/hour (was 60 / 5min ≈ 720/h),
// so a ~10k backlog drains in ~4h instead of ~14h. All env-overridable.
const TRACKER_CYCLE_INTERVAL = Number(process.env.TRACKER_CYCLE_MS ?? 3 * 60 * 1000);
const DIAGNOSTICS_PRUNE_INTERVAL = 60 * 60 * 1000;
const TRACKING_BATCH_SIZE = Number(process.env.TRACKER_BATCH_SIZE ?? 120);
const TRACKING_CONCURRENCY = Math.max(1, Number(process.env.TRACKER_CONCURRENCY ?? 10));
const AUTO_TRACK_BATCH_SIZE = Number(process.env.AUTO_TRACK_BATCH_SIZE ?? 250);

// KS-direct primary: per-project refresh goes through the single-lane browser
// worker /project endpoint (rich: rewards + creator), so cap concurrency low —
// extra concurrency just queues at the worker. Also drives Kicktraq removal
// from discovery. Toggle with KS_DIRECT_PRIMARY=1.
const KS_DIRECT_PRIMARY = process.env.KS_DIRECT_PRIMARY === '1';
const KS_DIRECT_CONCURRENCY = Math.max(1, Number(process.env.KS_DIRECT_CONCURRENCY ?? 2));

export function initTracker() {
  if (started || typeof window !== 'undefined') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  started = true;

  setTimeout(() => {
    runCycle();
    setInterval(runCycle, TRACKER_CYCLE_INTERVAL);
  }, 10_000);
}

let cycleRunning = false;

async function runCycle() {
  // Guard against overlap: if a batch (e.g. one stuck on the slow browser-worker
  // fallback) runs past the 5-min interval, don't let the next tick stack a
  // second concurrent batch on top of it.
  if (cycleRunning) {
    console.warn('[tracker] previous cycle still running; skipping this tick');
    return;
  }
  cycleRunning = true;
  try {
    const now = Date.now();
    // Queue a post-deadline final fetch BEFORE scraping, so the due batch this
    // cycle captures the authoritative final numbers for just-ended projects.
    queueFinalFetchForEnded();
    await enrollLiveProjects(now);
    await scrapeDueProjects();
    // Safety net AFTER scraping: only projects we still couldn't settle (long
    // past deadline, unreachable) get the deadline-based state correction.
    reconcileEndedProjects();
    startDiscoveryJobs(now);
    runDiagnosticsPrune(now);
  } finally {
    cycleRunning = false;
  }
}

function queueFinalFetchForEnded() {
  try {
    const queued = scheduleFinalFetchForEndedProjects();
    if (queued > 0) {
      console.log(`[tracker] queued ${queued} ended project(s) for a final post-deadline fetch`);
    }
  } catch (e) {
    console.error('[tracker] final-fetch queue error:', e);
  }
}

function reconcileEndedProjects() {
  try {
    const changed = markEndedLiveProjects();
    if (changed > 0) {
      console.log(`[tracker] reconciled ${changed} long-ended project(s) out of 'live' state (final fetch unavailable)`);
    }
  } catch (e) {
    console.error('[tracker] ended-project reconcile error:', e);
  }
}

function runDiagnosticsPrune(now: number) {
  if (now - lastDiagnosticsPrune <= DIAGNOSTICS_PRUNE_INTERVAL) return;
  lastDiagnosticsPrune = now;
  try {
    const summary = pruneOldDiagnostics();
    if (summary.errorsDeleted || summary.payloadsDeleted || summary.debugDeleted || summary.runsDeleted || summary.syncLogsDeleted) {
      console.log(
        `[tracker] diagnostics prune: errors=${summary.errorsDeleted} payloads=${summary.payloadsDeleted} debug=${summary.debugDeleted} runs=${summary.runsDeleted} sync_logs=${summary.syncLogsDeleted} wal_checkpoint=${summary.walCheckpointed}${summary.diskFullEncountered ? ' DISK_FULL' : ''}`,
      );
    }
  } catch (e) {
    console.error('[tracker] diagnostics prune error:', e);
  }
}

function isDiscoveryDue(source: string, jobType: string, lastRunAt: number, defaultIntervalMs: number, nowMs: number): boolean {
  if (nowMs - lastRunAt <= defaultIntervalMs) return false;
  const state = getCrawlerState(source, jobType);
  if (state?.next_attempt_at && state.next_attempt_at * 1000 > nowMs) return false;
  return true;
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

type DueProject = { project_id: string; track_comments: number; track_text_diff: number; consecutive_failures: number };

async function scrapeOneDue(due: DueProject) {
  const { project_id, track_comments, track_text_diff } = due;
  const project = await getProjectById(project_id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
  if (!project) return;

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
    return;
  }

  // In KS-direct primary mode the worker /project response carries reward tiers,
  // so enable reward persistence; otherwise keep the legacy lightweight path.
  const result = await scrapeAndStore(project_id, jsonUrl, {
    track_rewards: KS_DIRECT_PRIMARY ? 1 : 0,
    track_comments,
    track_text_diff,
  });
  if (!result.ok) {
    const backoff = recordScrapeFailure(project_id);
    const minutes = Math.round((backoff.next_fetch - Math.floor(Date.now() / 1000)) / 60);
    console.warn(`[tracker] Scrape failed for ${project_id} (failures=${backoff.consecutive_failures}), retry in ${minutes}min`);
    const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
    const recentDetail = getRecentCrawlerErrors({ projectId: project_id, urls: [jsonUrl, pageUrl], limit: 1 })[0]?.message;
    recordCrawlerError({
      source: 'tracker',
      job_type: 'project_json',
      project_id,
      url: jsonUrl,
      message: recentDetail
        ? `Kickstarter project sync failed (#${backoff.consecutive_failures}): ${recentDetail}`
        : `Kickstarter project JSON scrape failed (#${backoff.consecutive_failures}).`,
    });
  }
  // On success, the scrape pipeline already wrote next_fetch + reset consecutive_failures.
}

async function scrapeDueProjects() {
  try {
    const due = getDueProjects(TRACKING_BATCH_SIZE) as DueProject[];
    if (!due.length) return;

    const concurrency = Math.min(KS_DIRECT_PRIMARY ? KS_DIRECT_CONCURRENCY : TRACKING_CONCURRENCY, due.length);
    console.log(`[tracker] scraping ${due.length} due project(s) with concurrency ${concurrency}${KS_DIRECT_PRIMARY ? ' (ks-direct)' : ''}`);

    // Bounded worker pool: each worker pulls the next index until the batch is
    // drained. Replaces the old strictly-serial loop (20 per 5 min) so the
    // backlog clears several times faster while staying capped.
    let cursor = 0;
    const runWorker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= due.length) return;
        try {
          await scrapeOneDue(due[index]);
        } catch (e) {
          console.error(`[tracker] scrape error for ${due[index]?.project_id}:`, e);
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
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
  if (isDiscoveryDue('ks_live', 'discover:live', lastLiveSync, LIVE_SYNC_INTERVAL, now)) {
    lastLiveSync = now;
    console.log('[tracker] Starting KS live discovery sync...');
    runKickstarterLiveSync({
      state: 'live',
      maxPages: Number(process.env.LIVE_DISCOVERY_MAX_PAGES ?? 5),
      since: Math.floor(Date.now() / 1000) - Number(process.env.LIVE_DISCOVERY_LOOKBACK_DAYS ?? 3) * 24 * 3600,
    }).then(result => {
      console.log(`[tracker] KS live sync done: ${result.insertedOrUpdated} upserted, stopped=${result.stoppedReason}`);
      if (result.stoppedReason !== 'blocked') {
        const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
        console.log(`[tracker] post-KS auto-track: inserted=${auto.inserted}, remaining=${auto.remaining}`);
      }
    }).catch(e => {
      console.error('[tracker] KS live sync error:', e);
      recordCrawlerError({
        source: 'tracker',
        job_type: 'ks_live_discovery',
        message: e instanceof Error ? e.message : String(e),
      });
    });
  }

  // KS-direct primary mode: Kicktraq is relegated to manual historical OCR only,
  // so skip it as a discovery source. KS live discovery (above) is the source.
  if (!KS_DIRECT_PRIMARY && isDiscoveryDue('kicktraq_active', 'discover', lastKicktraqSync, KICKTRAQ_SYNC_INTERVAL, now)) {
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

