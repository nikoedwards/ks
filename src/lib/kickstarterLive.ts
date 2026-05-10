import {
  insertSnapshot,
  insertSyncLog,
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
  creator?: { name?: string; slug?: string };
  category?: KSCategory;
  urls?: { web?: { project?: string } };
}

interface DiscoverResponse {
  projects?: KSDiscoverProject[];
  has_more_projects?: boolean;
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

function normalizeProject(project: KSDiscoverProject, now: number): Record<string, unknown> | null {
  if (!project.id || !project.name) return null;
  const sourceUrl = projectUrl(project);
  const slug = project.slug ?? extractProjectSlug(sourceUrl ?? undefined);
  const pledged = parseNum(project.pledged);
  const usdPledged = parseNum(project.usd_pledged ?? project.converted_pledged_amount ?? project.pledged);

  return {
    id: String(project.id),
    name: project.name.slice(0, 500),
    blurb: project.blurb?.slice(0, 1000) ?? null,
    goal: parseNum(project.goal),
    pledged,
    usd_pledged: usdPledged,
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
    source_url: sourceUrl,
    slug,
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

async function fetchDiscoverPage(page: number, opts: Required<Pick<LiveSyncOptions, 'state'>>) {
  const params = new URLSearchParams({
    sort: 'newest',
    page: String(page),
    format: 'json',
  });
  if (opts.state !== 'all') params.set('state', opts.state);

  const res = await fetch(`${DISCOVER_URL}?${params.toString()}`, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; KicksonarBot/0.1; +https://kicksonar.local)',
    },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });

  const text = await res.text();
  if (isBlockedHtml(text)) {
    return { blocked: true as const, status: res.status, body: null };
  }
  if (!res.ok) {
    throw new Error(`Kickstarter discover HTTP ${res.status}`);
  }
  return { blocked: false as const, status: res.status, body: JSON.parse(text) as DiscoverResponse };
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

  try {
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
        updateSyncState({ status: 'error', message, error: message, completedAt: new Date().toISOString(), progress: 0 });
        if (logId) await updateSyncLog(logId, { completed_at: new Date().toISOString(), status: 'error', error_message: message });
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'blocked', message };
      }

      const projects = pageData.body.projects ?? [];
      if (!projects.length) {
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
        await complete(logId, insertedOrUpdated, 'Reached the requested launch-date cutoff.');
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'since_reached' };
      }

      if (!pageData.body.has_more_projects) {
        await complete(logId, insertedOrUpdated, 'No more Kickstarter pages.');
        return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'no_more_projects' };
      }

      await new Promise(resolve => setTimeout(resolve, 750));
    }

    await complete(logId, insertedOrUpdated, 'Reached max pages.');
    return { discovered, insertedOrUpdated, snapshots, pages, stoppedReason: 'max_pages' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
