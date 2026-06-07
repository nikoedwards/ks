import {
  insertSnapshot,
  insertSyncLog,
  completeCrawlRun,
  recordCrawlerError,
  startCrawlRun,
  updateSyncLog,
  upsertProjects,
  saveDB,
  updateCrawlerState,
} from './db';
import { updateSyncState } from './syncState';
import { runKicktraqActiveSync } from './kicktraqActive';
import { resolveUsdAmounts as resolveUsdAmountsShared } from './money';
import { resolveProjectState } from './projectState';
import { pickWorkerBase, gatedWorkerFetch, getWorkerBases, WorkerPriority } from './workerGate';

const DISCOVER_URL = 'https://www.kickstarter.com/discover/advanced';

interface KSCategory {
  id?: number;
  name?: string;
  parent_name?: string;
}

export interface KSDiscoverProject {
  id: number | string;
  name?: string;
  blurb?: string;
  goal?: number | string;
  pledged?: number | string;
  usd_pledged?: number | string;
  converted_pledged_amount?: number;
  converted_goal_amount?: number;
  fx_rate?: number | string;
  state?: string;
  slug?: string;
  country?: string;
  country_displayable_name?: string;
  currency?: string;
  deadline?: number;
  created_at?: number;
  launched_at?: number;
  staff_pick?: boolean;
  backers_count?: number;
  comments_count?: number;
  updates_count?: number;
  creator?: { name?: string; slug?: string; urls?: { web?: { user?: string } } };
  category?: KSCategory;
  photo?: {
    full?: string;
    little?: string;
    small?: string;
    med?: string;
    ed?: string;
    thumb?: string;
    '1024x576'?: string;
    '1536x864'?: string;
    key?: string;
  };
  urls?: { web?: { project?: string } };
}

interface DiscoverResponse {
  projects?: KSDiscoverProject[];
  has_more_projects?: boolean;
  has_more?: boolean;
  total_hits?: number;
}

export interface LiveSyncOptions {
  since?: number;
  maxPages?: number;
  state?: 'live' | 'successful' | 'failed' | 'all';
}

export interface LiveSyncResult {
  discovered: number;
  insertedOrUpdated: number;
  snapshots: number;
  pages: number;
  stoppedReason: 'no_more_projects' | 'since_reached' | 'max_pages' | 'blocked' | 'error';
  message?: string;
}

let activeLiveSync: Promise<LiveSyncResult> | null = null;

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function resolveUsdAmounts(project: KSDiscoverProject): { pledgedUsd: number; goalUsd: number } {
  const { pledgedUsd, goalUsd } = resolveUsdAmountsShared({
    pledgedLocal: parseNum(project.pledged),
    goalLocal: parseNum(project.goal),
    convertedPledged: parseNum(project.converted_pledged_amount),
    convertedGoal: parseNum(project.converted_goal_amount),
    explicitUsdPledged: parseNum(project.usd_pledged),
    fxRate: parseNum(project.fx_rate),
    staticUsdRate: parseNum((project as { static_usd_rate?: number | string }).static_usd_rate),
    currency: project.currency ?? null,
    backers: project.backers_count ?? 0,
  });
  return { pledgedUsd, goalUsd };
}

function extractProjectSlug(url: string | undefined): string | null {
  const m = url?.match(/kickstarter\.com\/projects\/[^/?#]+\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function projectUrl(project: KSDiscoverProject): string | null {
  if (project.urls?.web?.project) return project.urls.web.project.split('?')[0];
  if (project.creator?.slug && project.slug) {
    return `https://www.kickstarter.com/projects/${project.creator.slug}/${project.slug}`;
  }
  return null;
}

function projectImage(project: KSDiscoverProject): { image_url: string | null; image_thumb_url: string | null } {
  const photo = project.photo;
  return {
    image_url: photo?.full ?? photo?.['1536x864'] ?? photo?.['1024x576'] ?? photo?.ed ?? photo?.med ?? photo?.small ?? null,
    image_thumb_url: photo?.little ?? photo?.thumb ?? photo?.small ?? photo?.ed ?? photo?.med ?? photo?.full ?? null,
  };
}

function normalizeProject(project: KSDiscoverProject, now: number): Record<string, unknown> | null {
  if (!project.id || !project.name) return null;
  const sourceUrl = projectUrl(project);
  const slug = project.slug ?? extractProjectSlug(sourceUrl ?? undefined);
  const pledged = parseNum(project.pledged);
  const { pledgedUsd, goalUsd } = resolveUsdAmounts(project);
  const image = projectImage(project);

  return {
    id: String(project.id),
    name: project.name.slice(0, 500),
    blurb: project.blurb?.slice(0, 1000) ?? null,
    goal: goalUsd,
    pledged,
    usd_pledged: pledgedUsd,
    state: resolveProjectState({ raw: project.state, deadline: project.deadline ?? null, goal: goalUsd, pledged: pledgedUsd, now }),
    country: project.country ?? null,
    country_name: project.country_displayable_name ?? null,
    currency: project.currency ?? null,
    category_id: project.category?.id ?? null,
    category_name: project.category?.name ?? null,
    category_parent: project.category?.parent_name ?? project.category?.name ?? null,
    backers_count: project.backers_count ?? 0,
    staff_pick: project.staff_pick ? 1 : 0,
    created_at: project.created_at ?? null,
    launched_at: project.launched_at ?? null,
    deadline: project.deadline ?? null,
    creator_name: project.creator?.name ?? null,
    creator_slug: project.creator?.slug ?? null,
    creator_url: project.creator?.urls?.web?.user ?? (project.creator?.slug ? `https://www.kickstarter.com/profile/${project.creator.slug}` : null),
    source_url: sourceUrl,
    slug,
    image_url: image.image_url,
    image_thumb_url: image.image_thumb_url,
    data_source: 'ks_live',
    first_seen_at: now,
    last_seen_at: now,
    webrobots_synced_at: null,
    ks_live_synced_at: now,
  };
}

export async function ingestKickstarterLiveProjects(projects: KSDiscoverProject[]): Promise<{ imported: number; snapshots: number }> {
  const now = Math.floor(Date.now() / 1000);
  const normalized = projects
    .map(project => normalizeProject(project, now))
    .filter((project): project is Record<string, unknown> => !!project);

  return storeNormalizedProjects(normalized, now);
}

async function storeNormalizedProjects(normalized: Record<string, unknown>[], now: number): Promise<{ imported: number; snapshots: number }> {
  if (!normalized.length) return { imported: 0, snapshots: 0 };
  const imported = await upsertProjects(normalized);
  let snapshots = 0;
  for (const row of normalized) {
    insertSnapshot({
      project_id: String(row.id),
      captured_at: now,
      pledged_usd: Number(row.usd_pledged ?? 0),
      backers_count: Number(row.backers_count ?? 0),
      days_to_go: Number(row.deadline ?? 0) > 0 ? Math.max(0, Math.round((Number(row.deadline) - now) / 86400)) : 0,
      comments_count: 0,
      updates_count: 0,
      state: resolveProjectState({ raw: row.state, deadline: Number(row.deadline ?? 0) || null, goal: Number(row.goal ?? 0), pledged: Number(row.usd_pledged ?? 0), now }),
      source: 'ks_live',
    });
    snapshots++;
  }
  await saveDB();
  return { imported, snapshots };
}

function isBlockedHtml(text: string) {
  return text.includes('cf_chl') || text.includes('Just a moment') || text.includes('Enable JavaScript and cookies');
}

function getOptionalEnv(name: string) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BrowserFetchOutcome {
  body: DiscoverResponse | null;
  reason: string | null;
}

function isBrowserWorkerConfigured(): boolean {
  return getWorkerBases().length > 0;
}

function summarizeWorkerError(text: string): string {
  if (!text) return '(empty body)';
  try {
    const parsed = JSON.parse(text) as {
      error?: string;
      errorDetails?: {
        name?: string;
        message?: string;
        code?: string;
        proxyConfigured?: boolean;
        proxyServer?: string | null;
        browserInitialized?: boolean;
        lastLaunchError?: { error?: { message?: string; name?: string; code?: string }; hasProxy?: boolean; elapsedMs?: number } | null;
      };
    };
    const details = parsed.errorDetails;
    if (details) {
      const parts: string[] = [];
      if (details.name && details.name !== 'Error') parts.push(details.name);
      if (details.message) parts.push(details.message);
      if (details.code) parts.push(`code=${details.code}`);
      if (details.proxyConfigured) parts.push(`proxy=${details.proxyServer ?? 'configured'}`);
      const lastLaunch = details.lastLaunchError?.error;
      if (lastLaunch?.message && lastLaunch.message !== details.message) {
        parts.push(`lastLaunch=${lastLaunch.name ?? 'Error'}:${lastLaunch.message}`);
      }
      const summary = parts.filter(Boolean).join(' | ');
      if (summary) return summary.slice(0, 1200);
    }
    if (parsed.error) return String(parsed.error).slice(0, 1200);
    return JSON.stringify(parsed).slice(0, 1200);
  } catch {
    return text.slice(0, 1200);
  }
}

async function fetchDiscoverViaBrowser(url: string): Promise<BrowserFetchOutcome> {
  const base = pickWorkerBase();
  if (!base) {
    const message = 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service. Deploy the browser-worker (see browser-worker/README.md) and set this env var.';
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      message,
    });
    return { body: null, reason: 'browser_worker_not_configured' };
  }
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  // The browser worker now passes a 45s Cloudflare challenge per cold-cached
  // page, so the per-request budget needs to be well above that. Default 180s
  // (was 60s) gives the worker headroom for one CF challenge + page render +
  // JSON extraction. Subsequent pages in the same sync reuse cf_clearance
  // cookies and complete much faster.
  const workerTimeoutMs = Math.max(60_000, Math.min(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000), 300_000));
  let res: Response;
  try {
    // Discovery runs at HIGH priority through the worker gate, so it always wins
    // the next free Chromium lane ahead of the low-priority rich/core backfill —
    // the starvation that produced the "blocked" wedge.
    res = await gatedWorkerFetch(base, '/discover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      // Explicitly tell the worker how long IT has, so its internal page-goto
      // / challenge-wait can fit inside our outer abort signal (otherwise the
      // worker uses its 60s default and we'd abort before it can recover).
      body: JSON.stringify({ url, timeoutMs: workerTimeoutMs - 10_000 }),
      signal: AbortSignal.timeout(workerTimeoutMs),
      cache: 'no-store',
    }, WorkerPriority.HIGH);
  } catch (err) {
    const message = `Browser worker request failed (${base}): ${err instanceof Error ? err.message : String(err)}`;
    recordCrawlerError({ source: 'ks_live', job_type: 'browser_fallback', url, message });
    return { body: null, reason: message };
  }
  const text = await res.text();
  if (!res.ok) {
    const detail = summarizeWorkerError(text);
    const message = `Browser worker HTTP ${res.status}: ${detail}`;
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      status_code: res.status,
      message,
    });
    return { body: null, reason: message };
  }

  try {
    const data = JSON.parse(text) as DiscoverResponse | { body?: DiscoverResponse | string; text?: string; ok?: boolean; error?: string };
    const body = 'body' in data && data.body
      ? (typeof data.body === 'string' ? JSON.parse(data.body) as DiscoverResponse : data.body)
      : 'text' in data && typeof data.text === 'string'
        ? JSON.parse(data.text) as DiscoverResponse
        : data as DiscoverResponse;
    if (!Array.isArray(body.projects)) {
      const message = `Browser worker response did not contain projects. Keys=${Object.keys(body as Record<string, unknown>).join(',')}; preview=${text.slice(0, 500)}`;
      recordCrawlerError({
        source: 'ks_live',
        job_type: 'browser_fallback',
        url,
        status_code: res.status,
        message,
      });
      return { body: null, reason: message };
    }
    return { body, reason: null };
  } catch (err) {
    const message = `Browser worker JSON parse failed: ${err instanceof Error ? err.message : String(err)}; preview=${text.slice(0, 500)}`;
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      status_code: res.status,
      message,
    });
    return { body: null, reason: message };
  }
}

async function fetchDiscoverPage(page: number, opts: Required<Pick<LiveSyncOptions, 'state'>>) {
  const params = new URLSearchParams({
    sort: 'newest',
    page: String(page),
    format: 'json',
  });
  if (opts.state !== 'all') params.set('state', opts.state);

  const url = `${DISCOVER_URL}?${params.toString()}`;
  const timeoutMs = Number(getOptionalEnv('LIVE_DISCOVERY_FETCH_TIMEOUT_MS') || 60_000);
  const attempts = Math.max(1, Math.min(Number(getOptionalEnv('LIVE_DISCOVERY_FETCH_ATTEMPTS') || 2), 4));
  let lastError: unknown = null;
  let lastBlockReason: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; KicksonarBot/0.1; +https://kicksonar.local)',
        },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });

      const text = await res.text();
      if (isBlockedHtml(text)) {
        const outcome = await fetchDiscoverViaBrowser(url);
        if (outcome.body) return { blocked: false as const, status: 200, body: outcome.body };
        lastBlockReason = outcome.reason;
        return { blocked: true as const, status: res.status, body: null, reason: outcome.reason };
      }
      if (!res.ok) {
        const outcome = await fetchDiscoverViaBrowser(url);
        if (outcome.body) return { blocked: false as const, status: 200, body: outcome.body };
        lastBlockReason = outcome.reason;
        throw new Error(`Kickstarter discover HTTP ${res.status}`);
      }
      try {
        return { blocked: false as const, status: res.status, body: JSON.parse(text) as DiscoverResponse };
      } catch (err) {
        const outcome = await fetchDiscoverViaBrowser(url);
        if (outcome.body) return { blocked: false as const, status: 200, body: outcome.body };
        lastBlockReason = outcome.reason;
        throw err;
      }
    } catch (err) {
      lastError = err;
      recordCrawlerError({
        source: 'ks_live',
        job_type: `discover:${opts.state}:direct`,
        url,
        message: `${err instanceof Error ? err.message : String(err)}${attempt < attempts ? `; retrying ${attempt}/${attempts}` : ''}`,
        context: { page, timeoutMs, attempt, attempts },
      });
      if (attempt < attempts) {
        await sleep(1000 * attempt);
        continue;
      }
    }
  }

  const outcome = await fetchDiscoverViaBrowser(url);
  if (outcome.body) return { blocked: false as const, status: 200, body: outcome.body };
  lastBlockReason = outcome.reason ?? lastBlockReason;
  const baseMessage = lastError instanceof Error
    ? lastError.message
    : String(lastError ?? 'Kickstarter discover failed');
  throw new Error(lastBlockReason ? `${baseMessage} (browser fallback: ${lastBlockReason})` : baseMessage);
}

/**
 * KS Live sync orchestrator.
 *
 * First principles: the product wants "the latest projects from Kickstarter,
 * ingested into our database". Kicktraq mirrors Kickstarter's public listings
 * without Cloudflare friction, so that is our reliable data path. The direct
 * `kickstarter.com/discover/advanced?format=json` endpoint is currently
 * Cloudflare-challenged from every IP we tested (Railway + China-via-Clash)
 * and only adds value as enrichment (image URLs, numeric KS ids, comments).
 *
 * Set `LIVE_DISCOVERY_KS_DIRECT=1` to opt into the legacy direct path (still
 * via the browser-worker fallback) on top of the Kicktraq pass. By default we
 * skip it to keep the worker from being slammed by failing CF requests.
 */
export async function runKickstarterLiveSync(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  if (activeLiveSync) return activeLiveSync;
  activeLiveSync = runLiveSyncOrchestrator(options).finally(() => {
    activeLiveSync = null;
  });
  return activeLiveSync;
}

async function runLiveSyncOrchestrator(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const state = options.state ?? 'live';

  // KS-direct primary mode: discovery uses the Kickstarter discover API (via the
  // browser worker), with Kicktraq removed from the discovery path entirely.
  if (process.env.KS_DIRECT_PRIMARY === '1') {
    try {
      return await runDirectKickstarterDiscover(options);
    } catch (err) {
      return {
        discovered: 0,
        insertedOrUpdated: 0,
        snapshots: 0,
        pages: 0,
        stoppedReason: 'error',
        message: `ks-direct discover threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const kicktraq = await runKicktraqActiveSync({
    maxPages: options.maxPages ?? 5,
    since: options.since,
    onlyCurrentlyLive: state === 'live',
  });

  const result: LiveSyncResult = {
    discovered: kicktraq.imported,
    insertedOrUpdated: kicktraq.imported,
    snapshots: kicktraq.snapshots,
    pages: kicktraq.pages,
    stoppedReason: kicktraq.stoppedReason === 'error' ? 'error' : 'no_more_projects',
    message: kicktraq.message
      ? `kicktraq: ${kicktraq.message}`
      : `kicktraq imported ${kicktraq.imported}, snapshots ${kicktraq.snapshots}, pages ${kicktraq.pages}`,
  };

  if (getOptionalEnv('LIVE_DISCOVERY_KS_DIRECT') !== '1') {
    return result;
  }

  // Opt-in legacy path: try the direct KS discover API as enrichment. Failures
  // here do not fail the overall sync — Kicktraq already covered the basics.
  try {
    const direct = await runDirectKickstarterDiscover(options);
    return {
      discovered: result.discovered + direct.discovered,
      insertedOrUpdated: result.insertedOrUpdated + direct.insertedOrUpdated,
      snapshots: result.snapshots + direct.snapshots,
      pages: result.pages + direct.pages,
      stoppedReason: result.stoppedReason,
      message: `${result.message ?? ''} | direct=${direct.stoppedReason}: ${direct.message ?? ''}`.trim(),
    };
  } catch (err) {
    return {
      ...result,
      message: `${result.message ?? ''} | direct enrichment threw: ${err instanceof Error ? err.message : String(err)}`.trim(),
    };
  }
}

// How long to wait before re-attempting discovery after a block. The old 6h was
// far too long: a transient Cloudflare challenge (common on a proxy-less
// datacenter IP) would freeze new-launch discovery for a quarter of a day even
// once the browser worker recovered, leaving "24h 新上线" stuck at 0. Retry within
// the hour by default so fresh launches resume as soon as the worker can pass.
const BLOCK_BACKOFF_SEC = Math.max(300, Number(getOptionalEnv('LIVE_DISCOVERY_BLOCK_BACKOFF_SEC') || 3600));

async function runDirectKickstarterDiscover(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const startedAt = new Date().toISOString();
  const startedAtSec = Math.floor(Date.now() / 1000);
  const since = options.since ?? Math.floor(Date.now() / 1000) - 30 * 86400;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 25, 100));
  const state = options.state ?? 'live';
  const now = Math.floor(Date.now() / 1000);
  const jobType = `discover:${state}`;

  updateCrawlerState('ks_live', jobType, {
    last_status: 'running',
    last_started_at: startedAtSec,
    next_attempt_at: null,
  });

  if (!isBrowserWorkerConfigured()) {
    const message = 'KS Live discovery skipped: KICKSTARTER_BROWSER_FETCH_URL is not configured. Deploy browser-worker (see browser-worker/README.md) and set this env var on the main service.';
    recordCrawlerError({
      source: 'ks_live',
      job_type: jobType,
      url: `${DISCOVER_URL}?sort=newest&state=${state}`,
      message,
    });
    updateCrawlerState('ks_live', jobType, {
      last_status: 'blocked',
      last_completed_at: Math.floor(Date.now() / 1000),
      blocked_streak: 1,
      next_attempt_at: Math.floor(Date.now() / 1000) + BLOCK_BACKOFF_SEC,
      message,
    });
    updateSyncState({ status: 'error', message, error: message, completedAt: new Date().toISOString(), progress: 0 });
    return { discovered: 0, insertedOrUpdated: 0, snapshots: 0, pages: 0, stoppedReason: 'blocked', message };
  }

  updateSyncState({
    status: 'running',
    message: 'Discovering live Kickstarter projects...',
    progress: 5,
    startedAt,
    completedAt: null,
    recordsImported: 0,
    error: null,
    lastUrl: `${DISCOVER_URL}?sort=newest&state=${state}`,
  });

  let logId: number | undefined;
  let discovered = 0;
  let insertedOrUpdated = 0;
  let snapshots = 0;
  let pages = 0;
  let crawlRunId: number | undefined;

  try {
    crawlRunId = startCrawlRun('ks_live', jobType);
    logId = await insertSyncLog({
      url: `ks_live:${state}:since=${since}:maxPages=${maxPages}`,
      started_at: startedAt,
      status: 'running',
    });

    for (let page = 1; page <= maxPages; page++) {
      pages = page;
      updateSyncState({
        message: `Discovering Kickstarter page ${page}/${maxPages}...`,
        progress: Math.min(90, 5 + Math.floor((page / maxPages) * 80)),
        recordsImported: insertedOrUpdated,
      });

      const pageData = await fetchDiscoverPage(page, { state });
      if (pageData.blocked) {
        const reason = pageData.reason ?? null;
        const message = reason
          ? `Kickstarter blocked the discover endpoint and the browser worker fallback failed: ${reason}`
          : 'Kickstarter returned a Cloudflare challenge and no browser-backed crawler is reachable.';
        completeCrawlRun(crawlRunId, {
          status: 'blocked',
          discovered_count: discovered,
          imported_count: insertedOrUpdated,
          snapshot_count: snapshots,
          page_count: pages,
          blocked_count: 1,
          message,
        });
        recordCrawlerError({
          source: 'ks_live',
          job_type: jobType,
          url: `${DISCOVER_URL}?sort=newest&state=${state}&page=${page}`,
          status_code: pageData.status,
          message,
        });
        const nextAttemptAt = Math.floor(Date.now() / 1000) + BLOCK_BACKOFF_SEC;
        updateCrawlerState('ks_live', jobType, {
          last_status: 'blocked',
          last_completed_at: Math.floor(Date.now() / 1000),
          blocked_streak: 1,
          next_attempt_at: nextAttemptAt,
          message,
        });
        updateSyncState({ status: 'error', message, error: message, completedAt: new Date().toISOString(), progress: 0 });
        if (logId) await updateSyncLog(logId, { completed_at: new Date().toISOString(), status: 'error', error_message: message });
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'blocked', message };
      }

      const projects = pageData.body.projects ?? [];
      if (!projects.length) {
        completeCrawlRun(crawlRunId, {
          status: 'completed',
          discovered_count: discovered,
          imported_count: insertedOrUpdated,
          snapshot_count: snapshots,
          page_count: pages,
          message: 'No more projects returned.',
        });
        updateCrawlerState('ks_live', jobType, {
          last_status: 'completed',
          last_completed_at: Math.floor(Date.now() / 1000),
          blocked_streak: 0,
          next_attempt_at: null,
          message: 'No more projects returned.',
        });
        await complete(logId, insertedOrUpdated, 'No more projects returned.');
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'no_more_projects' };
      }

      discovered += projects.length;
      const normalized = projects
        .map(project => normalizeProject(project, now))
        .filter((project): project is Record<string, unknown> => !!project);

      const fresh = normalized.filter(project => {
        const launchedAt = Number(project.launched_at ?? 0);
        return !launchedAt || launchedAt >= since;
      });

      if (fresh.length) {
        const ingested = await storeNormalizedProjects(fresh, now);
        insertedOrUpdated += ingested.imported;
        snapshots += ingested.snapshots;
      }

      const oldestLaunch = normalized.reduce((min, project) => {
        const launchedAt = Number(project.launched_at ?? 0);
        return launchedAt > 0 ? Math.min(min, launchedAt) : min;
      }, Number.POSITIVE_INFINITY);

      if (oldestLaunch !== Number.POSITIVE_INFINITY && oldestLaunch < since) {
        completeCrawlRun(crawlRunId, {
          status: 'completed',
          discovered_count: discovered,
          imported_count: insertedOrUpdated,
          snapshot_count: snapshots,
          page_count: pages,
          message: 'Reached the requested launch-date cutoff.',
        });
        updateCrawlerState('ks_live', jobType, {
          last_status: 'completed',
          last_completed_at: Math.floor(Date.now() / 1000),
          blocked_streak: 0,
          next_attempt_at: null,
          message: 'Reached the requested launch-date cutoff.',
        });
        await complete(logId, insertedOrUpdated, 'Reached the requested launch-date cutoff.');
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'since_reached' };
      }

      if (!(pageData.body.has_more_projects ?? pageData.body.has_more)) {
        completeCrawlRun(crawlRunId, {
          status: 'completed',
          discovered_count: discovered,
          imported_count: insertedOrUpdated,
          snapshot_count: snapshots,
          page_count: pages,
          message: 'No more Kickstarter pages.',
        });
        updateCrawlerState('ks_live', jobType, {
          last_status: 'completed',
          last_completed_at: Math.floor(Date.now() / 1000),
          blocked_streak: 0,
          next_attempt_at: null,
          message: 'No more Kickstarter pages.',
        });
        await complete(logId, insertedOrUpdated, 'No more Kickstarter pages.');
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'no_more_projects' };
      }

      await new Promise(resolve => setTimeout(resolve, 750));
    }

    completeCrawlRun(crawlRunId, {
      status: 'completed',
      discovered_count: discovered,
      imported_count: insertedOrUpdated,
      snapshot_count: snapshots,
      page_count: pages,
      message: 'Reached max pages.',
    });
    updateCrawlerState('ks_live', jobType, {
      last_status: 'completed',
      last_completed_at: Math.floor(Date.now() / 1000),
      blocked_streak: 0,
      next_attempt_at: null,
      message: 'Reached max pages.',
    });
    await complete(logId, insertedOrUpdated, 'Reached max pages.');
    return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'max_pages' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    completeCrawlRun(crawlRunId, {
      status: 'error',
      discovered_count: discovered,
      imported_count: insertedOrUpdated,
      snapshot_count: snapshots,
      page_count: pages,
      error_count: 1,
      message,
    });
    recordCrawlerError({
      source: 'ks_live',
      job_type: jobType,
      url: `${DISCOVER_URL}?sort=newest&state=${state}`,
      message,
      context: { since, maxPages, pages },
    });
    updateCrawlerState('ks_live', jobType, {
      last_status: 'error',
      last_completed_at: Math.floor(Date.now() / 1000),
      next_attempt_at: Math.floor(Date.now() / 1000) + 30 * 60,
      message,
    });
    updateSyncState({ status: 'error', message: `Live sync failed: ${message}`, error: message, completedAt: new Date().toISOString(), progress: 0 });
    if (logId) await updateSyncLog(logId, { completed_at: new Date().toISOString(), status: 'error', error_message: message });
    return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'error', message };
  }
}

async function complete(logId: number | undefined, records: number, message: string) {
  await saveDB();
  const completedAt = new Date().toISOString();
  updateSyncState({
    status: 'completed',
    message,
    progress: 100,
    completedAt,
    recordsImported: records,
  });
  if (logId) {
    await updateSyncLog(logId, {
      completed_at: completedAt,
      records_imported: records,
      status: 'completed',
    });
  }
}
