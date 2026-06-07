import { randomUUID } from 'crypto';
import {
  autoTrackLiveProjects,
  getDueProjects,
  getRichDueProjects,
  markRewardsSynced,
  getProjectById,
  getRecentCrawlerErrors,
  markEndedLiveProjects,
  scheduleFinalFetchForEndedProjects,
  recordCrawlerError,
  recordScrapeFailure,
  acquireTrackerLock,
  upsertTrackingSettings,
  getCrawlerState,
  pruneOldDiagnostics,
  getPrelaunchWatchDue,
  markPrelaunchChecked,
  getCollabBackfillDue,
  markCollabChecked,
} from './db';
import {
  buildKSJsonUrl,
  scrapeAndStore,
  extractCreatorSlug,
  extractProjectSlug,
  fetchCoreBatchViaWorker,
  fetchProjectViaWorker,
  fetchCollaboratorsViaWorker,
  storeCollaboratorsFromWorker,
  storeWorkerCoreResult,
} from './scraper';
import { normalizeState } from './projectState';
import { runKickstarterLiveSync } from './kickstarterLive';
import { runKicktraqActiveSync } from './kicktraqActive';
import { isFleetUnhealthy } from './workerGate';

let started = false;

// Stable per-process identity + TTL for the cross-process single-runner lock.
const TRACKER_OWNER = `${process.pid}-${randomUUID().slice(0, 8)}`;
const TRACKER_LOCK_TTL_SEC = Math.max(120, Number(process.env.TRACKER_LOCK_TTL_SEC ?? 600));

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
// worker (rich: rewards + creator). Also drives Kicktraq removal from
// discovery. Toggle with KS_DIRECT_PRIMARY=1.
const KS_DIRECT_PRIMARY = process.env.KS_DIRECT_PRIMARY === '1';

// Tiered KS-direct cadence (capacity for ~10k live projects on a single-lane
// worker):
//   - CORE pass (cheap, every cycle): one warm session batch-fetches stats.json
//     for many due projects via the worker /core endpoint, refreshing funding.
//   - RICH pass (expensive, low-freq): a small batch of projects whose rewards/
//     creator data is stale go through /project (one clear + GraphQL each).
// All env-overridable so production can tune throughput vs. worker load.
const KS_CORE_BATCH = Math.max(1, Number(process.env.KS_CORE_BATCH_SIZE ?? 60));
const KS_CORE_CHUNK = Math.max(1, Math.min(Number(process.env.KS_CORE_CHUNK ?? 40), 60));
const KS_RICH_BATCH = Math.max(0, Number(process.env.KS_RICH_BATCH_SIZE ?? 12));
const KS_RICH_INTERVAL_SEC = Math.max(3600, Number(process.env.KS_RICH_INTERVAL_SEC ?? 48 * 3600));
// Cap how long the (expensive, serial) RICH pass may run per cycle so it never
// starves the CORE funding pass that follows it. Default 2 min of a 3-min cycle.
const KS_RICH_CYCLE_BUDGET_MS = Math.max(20_000, Number(process.env.KS_RICH_CYCLE_BUDGET_MS ?? 120_000));

// Isolated "prelaunch watch" — fully separate from the live core/rich passes
// and OFF by default. When KS_PRELAUNCH_WATCH=1, a low-frequency pass probes
// known prelaunch projects via the worker /project endpoint to detect when they
// launch (state -> live), then hands them to the normal ingest path. Runs
// sequentially inside the locked cycle (after discovery), bounded by its own
// batch size + wall-clock budget so it never races or starves the live passes.
const KS_PRELAUNCH_WATCH = process.env.KS_PRELAUNCH_WATCH === '1';
const KS_PRELAUNCH_BATCH = Math.max(1, Number(process.env.KS_PRELAUNCH_BATCH ?? 10));
const KS_PRELAUNCH_INTERVAL_MS = Number(process.env.KS_PRELAUNCH_INTERVAL_MS ?? 30 * 60 * 1000);
const KS_PRELAUNCH_STALE_SEC = Math.max(3600, Number(process.env.KS_PRELAUNCH_STALE_SEC ?? 6 * 3600));
const KS_PRELAUNCH_BUDGET_MS = Math.max(20_000, Number(process.env.KS_PRELAUNCH_BUDGET_MS ?? 90_000));
let lastPrelaunchWatch = 0;

// Isolated "collaborator backfill" — fully separate from the live core/rich
// passes and OFF by default. When KS_COLLAB_BACKFILL=1, a low-frequency pass
// probes projects (live + previously rich-fetched) via the worker /collab
// endpoint and stores collaborators, healing both old and new projects. Runs
// sequentially inside the locked cycle (after the prelaunch watch), bounded by
// its own batch size + wall-clock budget so it never starves the live passes.
const KS_COLLAB_BACKFILL = process.env.KS_COLLAB_BACKFILL === '1';
const KS_COLLAB_BATCH = Math.max(1, Number(process.env.KS_COLLAB_BATCH ?? 10));
const KS_COLLAB_INTERVAL_MS = Number(process.env.KS_COLLAB_INTERVAL_MS ?? 20 * 60 * 1000);
const KS_COLLAB_STALE_SEC = Math.max(3600, Number(process.env.KS_COLLAB_STALE_SEC ?? 30 * 24 * 3600));
const KS_COLLAB_BUDGET_MS = Math.max(20_000, Number(process.env.KS_COLLAB_BUDGET_MS ?? 90_000));
let lastCollabBackfill = 0;

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
    // Cross-process guard: with multiple replicas / deploy overlap on one shared
    // SQLite volume, only the lock holder runs a cycle. Everyone else no-ops.
    if (!acquireTrackerLock(TRACKER_OWNER, TRACKER_LOCK_TTL_SEC)) {
      console.log('[tracker] another instance holds the tracker lock; skipping this cycle');
      return;
    }
    const now = Date.now();
    // Queue a post-deadline final fetch BEFORE scraping, so the due batch this
    // cycle captures the authoritative final numbers for just-ended projects.
    queueFinalFetchForEnded();
    await enrollLiveProjects(now);
    await scrapeDueProjects();
    // Safety net AFTER scraping: only projects we still couldn't settle (long
    // past deadline, unreachable) get the deadline-based state correction.
    reconcileEndedProjects();
    // Awaited (not fire-and-forget) so discovery runs while the single-lane
    // browser-worker is free — i.e. after this cycle's rich/core passes and
    // before the next cycle's. Overlapping discovery with the rich pass starved
    // the worker and timed out pages 2+ ("Browser worker request failed").
    await startDiscoveryJobs(now);
    await scrapePrelaunchWatch();
    await scrapeCollabBackfill();
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

async function scrapeOneDue(due: DueProject): Promise<boolean> {
  const { project_id, track_comments, track_text_diff } = due;
  const project = await getProjectById(project_id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
  if (!project) return false;

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
    return false;
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
  return result.ok;
}

function ksPathKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\.json$/, '').replace(/\/$/, '').toLowerCase();
  } catch {
    return url;
  }
}

// RICH pass: refresh rewards/creator for a small batch of projects whose rich
// data is stale, via the worker /project endpoint (serial — single worker lane).
async function scrapeRichDueProjects() {
  if (KS_RICH_BATCH <= 0) return;
  // Contingency: when every worker is tripped, skip the expensive rich pass (it
  // holds the single lane 70-120s each) so the high-priority discovery can keep
  // trying. Stale rewards get picked up once the fleet recovers.
  if (isFleetUnhealthy()) {
    console.warn('[tracker] worker fleet unhealthy; skipping rich pass to protect discovery');
    return;
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const due = getRichDueProjects(KS_RICH_BATCH, now - KS_RICH_INTERVAL_SEC) as DueProject[];
    if (!due.length) return;
    // Wall-clock budget: each /project can take 70-120s when Cloudflare issues
    // slow challenges (degraded IP). Without a cap the rich pass would run for
    // ~16 min and starve the cheap CORE funding pass that follows it in the same
    // cycle. Stop pulling new rich projects once the budget is spent — leftover
    // stale projects are simply picked up next cycle.
    const deadline = Date.now() + KS_RICH_CYCLE_BUDGET_MS;
    console.log(`[tracker] rich pass: ${due.length} project(s) (stale rewards/creator)`);
    let done = 0;
    for (const d of due) {
      if (Date.now() >= deadline) {
        console.log(`[tracker] rich pass: budget spent after ${done}/${due.length}; deferring the rest`);
        break;
      }
      try {
        const ok = await scrapeOneDue(d);
        // Stamp on success → next rich in KS_RICH_INTERVAL_SEC. On failure stamp
        // a near-past time so it retries rich in ~6h instead of blocking the
        // NULLS-first queue every cycle (core keeps funding fresh meanwhile).
        markRewardsSynced(
          d.project_id,
          ok ? now : now - KS_RICH_INTERVAL_SEC + 6 * 3600,
        );
      } catch (e) {
        console.error(`[tracker] rich scrape error for ${d.project_id}:`, e);
        markRewardsSynced(d.project_id, now - KS_RICH_INTERVAL_SEC + 6 * 3600);
      }
      done++;
    }
  } catch (e) {
    console.error('[tracker] rich pass error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'scrape_rich_due',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// CORE pass: cheap high-frequency funding refresh for due projects via the
// worker /core batch endpoint (one warm session, no per-project navigation).
async function scrapeCoreDueProjects() {
  try {
    const due = getDueProjects(KS_CORE_BATCH) as DueProject[];
    if (!due.length) return;

    const sent: { projectId: string; pageUrl: string }[] = [];
    for (const d of due) {
      const project = await getProjectById(d.project_id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
      if (!project) continue;
      const jsonUrl = buildProjectJsonUrl(project);
      if (!jsonUrl) {
        upsertTrackingSettings({ project_id: d.project_id, next_fetch: Math.floor(Date.now() / 1000) + 24 * 3600 });
        continue;
      }
      sent.push({ projectId: d.project_id, pageUrl: jsonUrl.replace(/\.json(?:[?#].*)?$/, '') });
    }
    if (!sent.length) return;

    const keyToId = new Map(sent.map((s) => [ksPathKey(s.pageUrl), s.projectId]));
    console.log(`[tracker] core pass: ${sent.length} project(s) via /core`);

    for (let i = 0; i < sent.length; i += KS_CORE_CHUNK) {
      const chunk = sent.slice(i, i + KS_CORE_CHUNK);
      const handled = new Set<string>();
      try {
        const results = await fetchCoreBatchViaWorker(chunk.map((c) => c.pageUrl));
        for (const r of results) {
          const id = keyToId.get(ksPathKey(r.url));
          if (!id) continue;
          handled.add(id);
          try {
            await storeWorkerCoreResult(id, r);
          } catch (e) {
            console.error(`[tracker] core store error for ${id}:`, e);
            recordScrapeFailure(id);
          }
        }
      } catch (e) {
        console.error('[tracker] core batch error:', e);
      }
      // Any project the worker didn't return a row for → back off so it doesn't
      // stay perpetually due and dominate the next core batch.
      for (const c of chunk) {
        if (!handled.has(c.projectId)) recordScrapeFailure(c.projectId);
      }
    }
  } catch (e) {
    console.error('[tracker] core pass error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'scrape_core_due',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

async function scrapeDueProjects() {
  // KS-direct primary: split into a cheap high-frequency CORE pass and an
  // expensive low-frequency RICH pass. Run RICH first — it does a full /project
  // scrape (which markFetched-bumps next_fetch), so those projects drop out of
  // the CORE due queue this cycle, avoiding duplicate worker calls.
  if (KS_DIRECT_PRIMARY) {
    await scrapeRichDueProjects();
    await scrapeCoreDueProjects();
    return;
  }
  try {
    const due = getDueProjects(TRACKING_BATCH_SIZE) as DueProject[];
    if (!due.length) return;

    const concurrency = Math.min(TRACKING_CONCURRENCY, due.length);
    console.log(`[tracker] scraping ${due.length} due project(s) with concurrency ${concurrency}`);

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

async function startDiscoveryJobs(now: number) {
  if (isDiscoveryDue('ks_live', 'discover:live', lastLiveSync, LIVE_SYNC_INTERVAL, now)) {
    lastLiveSync = now;
    console.log('[tracker] Starting KS live discovery sync...');
    try {
      const result = await runKickstarterLiveSync({
        state: 'live',
        maxPages: Number(process.env.LIVE_DISCOVERY_MAX_PAGES ?? 5),
        since: Math.floor(Date.now() / 1000) - Number(process.env.LIVE_DISCOVERY_LOOKBACK_DAYS ?? 3) * 24 * 3600,
      });
      console.log(`[tracker] KS live sync done: ${result.insertedOrUpdated} upserted, stopped=${result.stoppedReason}`);
      if (result.stoppedReason !== 'blocked') {
        const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
        console.log(`[tracker] post-KS auto-track: inserted=${auto.inserted}, remaining=${auto.remaining}`);
      }
    } catch (e) {
      console.error('[tracker] KS live sync error:', e);
      recordCrawlerError({
        source: 'tracker',
        job_type: 'ks_live_discovery',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // KS-direct primary mode: Kicktraq is relegated to manual historical OCR only,
  // so skip it as a discovery source. KS live discovery (above) is the source.
  if (!KS_DIRECT_PRIMARY && isDiscoveryDue('kicktraq_active', 'discover', lastKicktraqSync, KICKTRAQ_SYNC_INTERVAL, now)) {
    lastKicktraqSync = now;
    console.log('[tracker] Starting Kicktraq active sync...');
    try {
      const result = await runKicktraqActiveSync({
        maxPages: 5,
        onlyCurrentlyLive: true,
      });
      console.log(`[tracker] Kicktraq active sync done: ${result.imported} imported, stopped=${result.stoppedReason}`);
      const auto = autoTrackLiveProjects(AUTO_TRACK_BATCH_SIZE);
      console.log(`[tracker] post-Kicktraq auto-track: inserted=${auto.inserted}, remaining=${auto.remaining}`);
    } catch (e) {
      console.error('[tracker] Kicktraq active sync error:', e);
      recordCrawlerError({
        source: 'tracker',
        job_type: 'kicktraq_active_discovery',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

// Isolated prelaunch watch pass. Default OFF (KS_PRELAUNCH_WATCH). Probes known
// prelaunch projects to detect launch; never touches the live core/rich queues.
async function scrapePrelaunchWatch() {
  if (!KS_PRELAUNCH_WATCH) return;
  if (isFleetUnhealthy()) return;
  const now = Date.now();
  if (now - lastPrelaunchWatch <= KS_PRELAUNCH_INTERVAL_MS) return;
  lastPrelaunchWatch = now;
  try {
    const due = getPrelaunchWatchDue(KS_PRELAUNCH_BATCH, Math.floor(Date.now() / 1000) - KS_PRELAUNCH_STALE_SEC);
    if (!due.length) return;
    console.log(`[tracker] prelaunch watch: ${due.length} project(s)`);
    const deadline = Date.now() + KS_PRELAUNCH_BUDGET_MS;
    let launched = 0;
    let done = 0;
    for (const row of due) {
      if (Date.now() >= deadline) {
        console.log(`[tracker] prelaunch watch: budget spent after ${done}/${due.length}; deferring the rest`);
        break;
      }
      done++;
      try {
        if (await watchOnePrelaunch(row.project_id)) launched++;
      } catch (e) {
        console.error(`[tracker] prelaunch watch error for ${row.project_id}:`, e);
      }
    }
    if (launched) console.log(`[tracker] prelaunch watch: ${launched} project(s) launched -> live`);
  } catch (e) {
    console.error('[tracker] prelaunch watch error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'prelaunch_watch',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// Probe a single prelaunch project. Returns true if it has launched (now live).
// We read state cheaply via the worker /project and only run the full ingest
// (scrapeAndStore) once the project is no longer prelaunch — this avoids the
// "no usable funding/backers" rejection + failure backoff that a still-prelaunch
// page would otherwise trip in scrapeAndStore.
async function watchOnePrelaunch(projectId: string): Promise<boolean> {
  const project = await getProjectById(projectId) as { source_url?: string; creator_slug?: string; slug?: string } | null;
  if (!project) return false;
  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) {
    markPrelaunchChecked(projectId);
    return false;
  }
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  // login_redirect demotion (-> suspended) is handled inside fetchProjectViaWorker;
  // a null result simply means "couldn't read it this time, try again later".
  const ks = await fetchProjectViaWorker(pageUrl, projectId);
  markPrelaunchChecked(projectId);
  if (!ks) return false;
  const norm = normalizeState(ks.state);
  if (norm && norm !== 'prelaunch') {
    // Launched (or ended/canceled): full ingest so it's stored + promoted into
    // the normal pipeline. auto-track enrolls live ones on the next cycle.
    await scrapeAndStore(projectId, jsonUrl, {
      track_rewards: KS_DIRECT_PRIMARY ? 1 : 0,
      track_comments: 1,
      track_text_diff: 1,
    });
    return norm === 'live';
  }
  return false;
}

// Isolated collaborator backfill pass. Default OFF (KS_COLLAB_BACKFILL). Probes
// projects via the worker /collab endpoint and stores collaborators; never
// touches the live core/rich queues or the stable /project path.
async function scrapeCollabBackfill() {
  if (!KS_COLLAB_BACKFILL) return;
  if (isFleetUnhealthy()) return;
  const now = Date.now();
  if (now - lastCollabBackfill <= KS_COLLAB_INTERVAL_MS) return;
  lastCollabBackfill = now;
  try {
    const due = getCollabBackfillDue(KS_COLLAB_BATCH, Math.floor(Date.now() / 1000) - KS_COLLAB_STALE_SEC);
    if (!due.length) return;
    console.log(`[tracker] collab backfill: ${due.length} project(s)`);
    const deadline = Date.now() + KS_COLLAB_BUDGET_MS;
    let filled = 0;
    let done = 0;
    for (const row of due) {
      if (Date.now() >= deadline) {
        console.log(`[tracker] collab backfill: budget spent after ${done}/${due.length}; deferring the rest`);
        break;
      }
      done++;
      try {
        if (await backfillOneCollab(row.project_id)) filled++;
      } catch (e) {
        console.error(`[tracker] collab backfill error for ${row.project_id}:`, e);
      }
    }
    if (filled) console.log(`[tracker] collab backfill: ${filled}/${done} project(s) got collaborators`);
  } catch (e) {
    console.error('[tracker] collab backfill error:', e);
    recordCrawlerError({
      source: 'tracker',
      job_type: 'collab_backfill',
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

// Probe a single project's collaborators via the worker /collab endpoint and
// store them. Always marks the project as checked (so we don't re-probe it next
// cycle), even when it has genuinely zero collaborators. Returns true if any
// collaborators were stored.
async function backfillOneCollab(projectId: string): Promise<boolean> {
  const project = await getProjectById(projectId) as { source_url?: string; creator_slug?: string; slug?: string } | null;
  if (!project) return false;
  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) {
    markCollabChecked(projectId);
    return false;
  }
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const res = await fetchCollaboratorsViaWorker(pageUrl, projectId);
  markCollabChecked(projectId);
  if (!res) return false;
  const stored = storeCollaboratorsFromWorker(projectId, res.collaborators);
  return stored > 0;
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

