import {
  insertSnapshot,
  recordCrawlerError,
  saveDB,
  upsertProjects,
} from './db';

const DISCOVER_URL = 'https://www.kickstarter.com/discover/advanced';

interface KSDiscoverProject {
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
  category?: { id?: number; name?: string; parent_name?: string };
  photo?: {
    full?: string;
    little?: string;
    small?: string;
    med?: string;
    ed?: string;
    thumb?: string;
    '1024x576'?: string;
    '1536x864'?: string;
  };
  urls?: { web?: { project?: string } };
}

interface DiscoverResponse {
  projects?: KSDiscoverProject[];
  has_more_projects?: boolean;
  has_more?: boolean;
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

function projectUrl(project: KSDiscoverProject): string | null {
  if (project.urls?.web?.project) return project.urls.web.project.split('?')[0];
  if (project.creator?.slug && project.slug) {
    return `https://www.kickstarter.com/projects/${project.creator.slug}/${project.slug}`;
  }
  return null;
}

function normalizeUrl(url: string | null | undefined) {
  return url?.split('?')[0].replace(/\/+$/, '') ?? null;
}

function discoverProjectMatches(project: KSDiscoverProject, target: {
  id: string;
  sourceUrl?: string | null;
  creatorSlug?: string | null;
  slug?: string | null;
}) {
  if (String(project.id) === String(target.id)) return true;
  const sourceUrl = normalizeUrl(target.sourceUrl);
  const discoveredUrl = normalizeUrl(projectUrl(project));
  if (sourceUrl && discoveredUrl && sourceUrl === discoveredUrl) return true;
  const slugMatches = Boolean(target.slug && project.slug === target.slug);
  const creatorMatches = Boolean(target.creatorSlug && project.creator?.slug === target.creatorSlug);
  return slugMatches && (!target.creatorSlug || creatorMatches);
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
    source_url: projectUrl(project),
    slug: project.slug ?? null,
    image_url: image.image_url,
    image_thumb_url: image.image_thumb_url,
    data_source: 'ks_live',
    first_seen_at: now,
    last_seen_at: now,
    webrobots_synced_at: null,
    ks_live_synced_at: now,
    comments_count: project.comments_count ?? 0,
    updates_count: project.updates_count ?? 0,
  };
}

async function fetchDiscoverPage(page: number, state: string, term?: string): Promise<DiscoverResponse> {
  const params = new URLSearchParams({ sort: 'newest', page: String(page), format: 'json' });
  if (state !== 'all') params.set('state', state);
  if (term?.trim()) params.set('term', term.trim());
  const url = `${DISCOVER_URL}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (compatible; KicksonarManual/0.1; +https://kicksonar.local)',
    },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok || text.includes('cf_chl') || text.includes('Just a moment')) {
    throw new Error(`Kickstarter Discover HTTP ${res.status}`);
  }
  return JSON.parse(text) as DiscoverResponse;
}

async function storeProject(project: KSDiscoverProject) {
  const now = Math.floor(Date.now() / 1000);
  const normalized = normalizeProject(project, now);
  if (!normalized) return { imported: 0, snapshots: 0 };
  const imported = await upsertProjects([normalized]);
  insertSnapshot({
    project_id: String(normalized.id),
    captured_at: now,
    pledged_usd: Number(normalized.usd_pledged ?? 0),
    backers_count: Number(normalized.backers_count ?? 0),
    days_to_go: Number(normalized.deadline ?? 0) > 0 ? Math.max(0, Math.round((Number(normalized.deadline) - now) / 86400)) : 0,
    comments_count: Number(normalized.comments_count ?? 0),
    updates_count: Number(normalized.updates_count ?? 0),
    state: String(normalized.state ?? 'unknown'),
    source: 'ks_live_manual',
  });
  await saveDB();
  return { imported, snapshots: 1 };
}

export async function syncKickstarterLiveProject(target: {
  id: string;
  name?: string | null;
  sourceUrl?: string | null;
  creatorSlug?: string | null;
  slug?: string | null;
}, options: { maxPages?: number; state?: 'live' | 'successful' | 'failed' | 'all' } = {}) {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 8, 25));
  const state = options.state ?? 'live';
  const terms = Array.from(new Set([
    target.name?.trim(),
    target.slug?.replace(/[-_]+/g, ' ').trim(),
    target.creatorSlug?.trim(),
    undefined,
  ].filter((term): term is string | undefined => term === undefined || term.length > 0)));
  let pages = 0;

  try {
    for (const term of terms) {
      const pageLimit = term ? Math.min(3, maxPages) : maxPages;
      for (let page = 1; page <= pageLimit; page++) {
        pages++;
        const body = await fetchDiscoverPage(page, state, term);
        const matched = (body.projects ?? []).find(project => discoverProjectMatches(project, target));
        if (matched) {
          const stored = await storeProject(matched);
          return {
            ok: stored.imported > 0 || stored.snapshots > 0,
            source: 'ks_live_manual' as const,
            imported: stored.imported,
            snapshots: stored.snapshots,
            pages,
            message: 'Synced Kickstarter basic project fields from isolated manual Discover.',
          };
        }
        if (!(body.has_more_projects ?? body.has_more)) break;
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
  } catch (err) {
    recordCrawlerError({
      source: 'ks_live_manual',
      job_type: 'single_project_discover',
      project_id: target.id,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      source: 'ks_live_manual' as const,
      imported: 0,
      snapshots: 0,
      pages,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    ok: false,
    source: 'ks_live_manual' as const,
    imported: 0,
    snapshots: 0,
    pages,
    message: 'Project was not found in isolated Kickstarter Discover results.',
  };
}
