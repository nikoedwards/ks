import {
  insertSnapshot,
  insertSyncLog,
  completeCrawlRun,
  recordCrawlerError,
  startCrawlRun,
  updateSyncLog,
  upsertProjects,
  saveDB,
} from './db';
import { updateSyncState } from './syncState';

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

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function resolveUsdAmounts(project: KSDiscoverProject): { pledgedUsd: number; goalUsd: number } {
  const pledgedLocal = parseNum(project.pledged);
  const goalLocal = parseNum(project.goal);
  const convertedPledged = parseNum(project.converted_pledged_amount);
  const convertedGoal = parseNum(project.converted_goal_amount);
  const explicitUsd = parseNum(project.usd_pledged);
  const pledgedUsd = convertedPledged > 0 ? convertedPledged : explicitUsd > 0 ? explicitUsd : pledgedLocal;
  const inferredRate = pledgedLocal > 0 && pledgedUsd > 0 ? pledgedUsd / pledgedLocal : parseNum(project.fx_rate);
  const goalUsd = convertedGoal > 0 ? convertedGoal : inferredRate > 0 ? goalLocal * inferredRate : goalLocal;
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
    state: project.state ?? 'unknown',
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
      state: String(row.state ?? 'unknown'),
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

async function fetchDiscoverViaBrowser(url: string) {
  const proxyUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  if (!proxyUrl) {
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service.',
    });
    return null;
  }
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ url, expect: 'json' }),
    signal: AbortSignal.timeout(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 60_000)),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) {
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      status_code: res.status,
      message: `Browser worker HTTP ${res.status}: ${text.slice(0, 500)}`,
    });
    return null;
  }

  try {
    const data = JSON.parse(text) as DiscoverResponse | { body?: DiscoverResponse | string; text?: string; ok?: boolean; error?: string };
    const body = 'body' in data && data.body
      ? (typeof data.body === 'string' ? JSON.parse(data.body) as DiscoverResponse : data.body)
      : 'text' in data && typeof data.text === 'string'
        ? JSON.parse(data.text) as DiscoverResponse
        : data as DiscoverResponse;
    if (!Array.isArray(body.projects)) {
      recordCrawlerError({
        source: 'ks_live',
        job_type: 'browser_fallback',
        url,
        status_code: res.status,
        message: `Browser worker response did not contain projects. Keys=${Object.keys(body as Record<string, unknown>).join(',')}; preview=${text.slice(0, 500)}`,
      });
      return null;
    }
    return body;
  } catch (err) {
    recordCrawlerError({
      source: 'ks_live',
      job_type: 'browser_fallback',
      url,
      status_code: res.status,
      message: `Browser worker JSON parse failed: ${err instanceof Error ? err.message : String(err)}; preview=${text.slice(0, 500)}`,
    });
    return null;
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
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.kickstarter.com/discover/advanced?sort=newest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
    },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });

  const text = await res.text();
  if (isBlockedHtml(text)) {
    const body = await fetchDiscoverViaBrowser(url);
    if (body) return { blocked: false as const, status: 200, body };
    return { blocked: true as const, status: res.status, body: null };
  }
  if (!res.ok) {
    throw new Error(`Kickstarter discover HTTP ${res.status}`);
  }
  try {
    return { blocked: false as const, status: res.status, body: JSON.parse(text) as DiscoverResponse };
  } catch (err) {
    const body = await fetchDiscoverViaBrowser(url);
    if (body) return { blocked: false as const, status: 200, body };
    throw err;
  }
}

export async function runKickstarterLiveSync(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const startedAt = new Date().toISOString();
  const since = options.since ?? Math.floor(Date.now() / 1000) - 30 * 86400;
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 25, 100));
  const state = options.state ?? 'live';
  const now = Math.floor(Date.now() / 1000);

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
    crawlRunId = startCrawlRun('ks_live', `discover:${state}`);
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
        const message = 'Kickstarter returned a Cloudflare challenge. Use a browser-backed crawler or provide harvested project URLs for this environment.';
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
          job_type: `discover:${state}`,
          url: `${DISCOVER_URL}?sort=newest&state=${state}&page=${page}`,
          status_code: pageData.status,
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
      job_type: `discover:${state}`,
      url: `${DISCOVER_URL}?sort=newest&state=${state}`,
      message,
      context: { since, maxPages, pages },
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
