import {
  deleteKicktraqSnapshots,
  getProjectById,
  getSnapshots,
  insertSnapshot,
  insertRewardSnapshots,
  upsertProjectCollaborators,
  insertTextIfChanged,
  insertComment,
  markFetched,
  recordCrawlerError,
  updateProjectLiveMetadata,
  type ProjectCollaborator,
  type RewardSnapshot,
} from './db';

export function getOptionalEnv(name: string) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

// ─── KS JSON API types ────────────────────────────────────────────────────────

interface KSReward {
  id: number;
  title?: string;
  description?: string;
  minimum: number | string;
  backers_count: number;
  limit?: number | null;
  limited?: boolean;
  remaining?: number | null;
}

interface KSProject {
  id: number;
  name: string;
  blurb?: string;
  state: string;
  slug?: string;
  pledged: number | string;
  usd_pledged?: string | number;
  converted_pledged_amount?: number;
  converted_goal_amount?: number;
  fx_rate?: number | string;
  goal: number | string;
  backers_count: number;
  comments_count?: number;
  updates_count?: number;
  deadline?: number;
  rewards?: KSReward[];
  creator?: { name?: string; slug?: string; urls?: { web?: { user?: string } } };
  collaborators?: KSCollaborator[];
  project_collaborators?: KSCollaborator[];
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
}

interface KSCollaborator {
  id?: number | string;
  name?: string;
  slug?: string;
  role?: string;
  avatar?: { thumb?: string; small?: string; medium?: string };
  photo?: { thumb?: string; small?: string; med?: string; full?: string };
  urls?: { web?: { user?: string; profile?: string } };
}

interface KicktraqSummary {
  pledged_usd: number;
  backers_count: number;
  goal_usd: number;
  currency: string | null;
  deadline?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function extractCreatorSlug(sourceUrl: string): string | null {
  const m = sourceUrl.match(/kickstarter\.com\/projects\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function extractProjectSlug(sourceUrl: string): string | null {
  const m = sourceUrl.match(/kickstarter\.com\/projects\/[^/?#]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function buildKSJsonUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || !['www.kickstarter.com', 'kickstarter.com'].includes(url.hostname) || !url.pathname.startsWith('/projects/')) {
      return null;
    }
    url.hostname = 'www.kickstarter.com';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/$/, '');
    if (!url.pathname.endsWith('.json')) url.pathname += '.json';
    return url.toString();
  } catch {
    return null;
  }
}

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function resolveUsdAmounts(p: KSProject): { pledgedUsd: number; goalUsd: number } {
  const pledgedLocal = parseNum(p.pledged);
  const goalLocal = parseNum(p.goal);
  const convertedPledged = parseNum(p.converted_pledged_amount);
  const convertedGoal = parseNum(p.converted_goal_amount);
  const explicitUsd = parseNum(p.usd_pledged);
  const pledgedUsd = convertedPledged > 0 ? convertedPledged : explicitUsd > 0 ? explicitUsd : pledgedLocal;
  const inferredRate = pledgedLocal > 0 && pledgedUsd > 0 ? pledgedUsd / pledgedLocal : parseNum(p.fx_rate);
  const goalUsd = convertedGoal > 0 ? convertedGoal : inferredRate > 0 ? goalLocal * inferredRate : goalLocal;
  return { pledgedUsd, goalUsd };
}

function daysToGo(deadline: number | undefined): number {
  if (!deadline) return 0;
  return Math.max(0, Math.round((deadline * 1000 - Date.now()) / 86_400_000));
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const SERVICE_AGENCY_PATTERNS = [
  { pattern: /longham/i, label: 'Longham - Crowdfunding Expert' },
  { pattern: /global\s*one\s*click|goc/i, label: 'Global OneClick' },
  { pattern: /vinyl/i, label: 'Vinyl - Full Service Crowdfunding Expert' },
];

function detectServiceAgency(name: string, role?: string | null) {
  const haystack = `${name} ${role ?? ''}`;
  return SERVICE_AGENCY_PATTERNS.find(item => item.pattern.test(haystack))?.label ?? null;
}

function normalizeCollaborators(projectId: string, p: KSProject, now: number): ProjectCollaborator[] {
  const raw = [
    ...((p.collaborators ?? []) as KSCollaborator[]),
    ...((p.project_collaborators ?? []) as KSCollaborator[]),
  ];
  const rows = new Map<string, ProjectCollaborator>();
  for (const c of raw) {
    const name = c.name?.trim();
    if (!name) continue;
    const agencyName = detectServiceAgency(name, c.role);
    const key = String(c.id ?? c.slug ?? name.toLowerCase().replace(/\s+/g, '-'));
    if (key === projectId) continue;
    rows.set(key, {
      collaborator_key: key,
      name: agencyName ?? name,
      role: agencyName ? 'Service agency' : c.role ?? null,
      avatar_url: c.avatar?.small ?? c.avatar?.thumb ?? c.photo?.small ?? c.photo?.thumb ?? c.photo?.med ?? c.photo?.full ?? null,
      profile_url: c.urls?.web?.user ?? c.urls?.web?.profile ?? (c.slug ? `https://www.kickstarter.com/profile/${c.slug}` : null),
      is_service_agency: agencyName ? 1 : 0,
      captured_at: now,
    });
  }
  return [...rows.values()];
}

function parseMoney(raw: string | undefined): { amount: number; currency: string | null } {
  if (!raw) return { amount: 0, currency: null };
  const lowered = raw.toLowerCase();
  let multiplier = 1;
  if (lowered.includes('million') || /\bm\b/.test(lowered)) multiplier = 1_000_000;
  if (lowered.includes('thousand') || /\bk\b/.test(lowered)) multiplier = 1_000;
  let currency: string | null = null;
  if (/hk\$/i.test(raw)) currency = 'HKD';
  else if (/us\$/i.test(raw) || /\busd\b/i.test(raw)) currency = 'USD';
  else if (/a\$/i.test(raw)) currency = 'AUD';
  else if (/c\$/i.test(raw)) currency = 'CAD';
  else if (/[\u00a5\uffe5]|jpy/i.test(raw)) currency = 'JPY';
  else if (/[\u00a3]|gbp/i.test(raw)) currency = 'GBP';
  else if (/[\u20ac]|eur/i.test(raw)) currency = 'EUR';
  else if (raw.includes('$')) currency = 'USD';
  return { amount: (parseFloat(raw.replace(/[^\d.-]/g, '')) || 0) * multiplier, currency };
}

function parseKicktraqSummary(html: string): KicktraqSummary | null {
  const details = stripTags(html.match(/<div class="project-details">([\s\S]*?)<\/div>/i)?.[1] ?? html);
  const backers = parseInt(details.match(/Backers:\s*([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? '0') || 0;
  const fundingMatch = details.match(/Funding:\s*([^<]+?)\s+of\s+([^<(]+)\s*\(/i);
  const pledged = parseMoney(fundingMatch?.[1]);
  const goal = parseMoney(fundingMatch?.[2]);
  if (pledged.amount <= 0 && backers <= 0) return null;
  const currency = pledged.currency ?? goal.currency;
  return {
    pledged_usd: currency === 'USD' ? pledged.amount : 0,
    backers_count: backers,
    goal_usd: currency === 'USD' ? goal.amount : 0,
    currency,
  };
}

export async function scrapeKicktraqProjectSummary(creatorSlug: string, projectSlug: string): Promise<KicktraqSummary | null> {
  const pageUrl = 'https://www.kicktraq.com/projects/' + creatorSlug + '/' + projectSlug + '/';
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return parseKicktraqSummary(await res.text());
  } catch {
    return null;
  }
}

export function storeKicktraqSummary(projectId: string, summary: KicktraqSummary) {
  const now = Math.floor(Date.now() / 1000);
  insertSnapshot({
    project_id: projectId,
    captured_at: now,
    pledged_usd: summary.pledged_usd,
    backers_count: summary.backers_count,
    days_to_go: summary.deadline ? daysToGo(summary.deadline) : 0,
    comments_count: 0,
    updates_count: 0,
    state: 'live',
    source: 'kicktraq_summary',
  });
  updateProjectLiveMetadata(projectId, {
    goal_usd: summary.goal_usd > 0 ? summary.goal_usd : null,
    pledged_usd: summary.pledged_usd > 0 ? summary.pledged_usd : null,
    backers_count: summary.backers_count > 0 ? summary.backers_count : null,
  });
  markFetched(projectId);
}

// ─── KS JSON scraper ─────────────────────────────────────────────────────────

function isBlockedKickstarterText(text: string) {
  return text.includes('cf_chl')
    || text.includes('Just a moment')
    || text.includes('Enable JavaScript and cookies')
    || text.includes('Cloudflare');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isKickstarterProject(value: unknown): value is KSProject {
  if (!isRecord(value)) return false;
  const hasIdentity = value.id !== undefined || typeof value.name === 'string';
  const hasProjectFields = 'pledged' in value || 'backers_count' in value || 'state' in value || 'goal' in value;
  return hasIdentity && hasProjectFields;
}

function unwrapKickstarterProject(value: unknown): KSProject | null {
  if (isKickstarterProject(value)) return value;
  if (!isRecord(value)) return null;

  const project = value.project;
  if (isKickstarterProject(project)) return project;

  const body = value.body;
  if (isKickstarterProject(body)) return body;
  if (isRecord(body) && isKickstarterProject(body.project)) return body.project;

  const text = value.text;
  if (typeof text === 'string' && text.trim()) {
    try {
      return unwrapKickstarterProject(JSON.parse(text));
    } catch {
      return null;
    }
  }

  return null;
}

function workerStatus(value: unknown): number | null {
  return isRecord(value) && typeof value.status === 'number' ? value.status : null;
}

function workerOk(value: unknown): boolean | null {
  return isRecord(value) && typeof value.ok === 'boolean' ? value.ok : null;
}

async function fetchViaBrowserProxy(url: string, projectId?: string): Promise<KSProject | null> {
  const proxyUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  if (!proxyUrl) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_json_fallback',
      project_id: projectId ?? null,
      url,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service.',
    });
    return null;
  }
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  try {
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
        source: 'ks_project',
        job_type: 'browser_json_fallback',
        project_id: projectId ?? null,
        url,
        status_code: res.status,
        message: `Browser worker JSON fallback HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
      return null;
    }

    const data = JSON.parse(text) as unknown;
    const project = unwrapKickstarterProject(data);
    if (project) return project;

    const status = workerStatus(data);
    const ok = workerOk(data);
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_json_fallback',
      project_id: projectId ?? null,
      url,
      status_code: status ?? res.status,
      message: `Browser worker did not return Kickstarter project JSON. workerOk=${ok ?? 'unknown'} workerStatus=${status ?? 'unknown'} preview=${text.slice(0, 500)}`,
    });
    return null;
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_json_fallback',
      project_id: projectId ?? null,
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fetchHtmlViaBrowserProxy(url: string, projectId?: string): Promise<string | null> {
  const proxyUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  if (!proxyUrl) return null;
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  try {
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url, expect: 'html' }),
      signal: AbortSignal.timeout(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 60_000)),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      recordCrawlerError({
        source: 'ks_project',
        job_type: 'browser_html_fallback',
        project_id: projectId ?? null,
        url,
        status_code: res.status,
        message: `Browser worker HTML fallback HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
      return null;
    }
    const data = JSON.parse(text) as { ok?: boolean; status?: number; text?: string; error?: string };
    if (data.ok === false || (typeof data.status === 'number' && data.status >= 400)) {
      recordCrawlerError({
        source: 'ks_project',
        job_type: 'browser_html_fallback',
        project_id: projectId ?? null,
        url,
        status_code: data.status ?? res.status,
        message: `Browser worker HTML fallback returned a blocked response. workerOk=${data.ok ?? 'unknown'} workerStatus=${data.status ?? 'unknown'} error=${data.error ?? ''}`,
      });
      return null;
    }
    if (typeof data.text === 'string' && data.text.trim() && !isBlockedKickstarterText(data.text)) return data.text;
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_html_fallback',
      project_id: projectId ?? null,
      url,
      status_code: data.status ?? res.status,
      message: `Browser worker HTML fallback returned no usable page text: ${text.slice(0, 500)}`,
    });
    return null;
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_html_fallback',
      project_id: projectId ?? null,
      url,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function scrapeKSJson(jsonUrl: string, projectId?: string): Promise<KSProject | null> {
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  try {
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': pageUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok || isBlockedKickstarterText(text)) {
      recordCrawlerError({
        source: 'ks_project',
        job_type: 'direct_json',
        project_id: projectId ?? null,
        url: jsonUrl,
        status_code: res.status,
        message: !res.ok
          ? `Kickstarter JSON HTTP ${res.status}.`
          : 'Kickstarter JSON returned a Cloudflare or HTML challenge.',
      });
      const browserJson = await fetchViaBrowserProxy(jsonUrl, projectId);
      if (browserJson) return browserJson;
      return fetchProjectViaHtmlProxy(pageUrl, projectId);
    }
    const data = JSON.parse(text) as KSProject | { project: KSProject };
    return 'project' in data ? data.project : data;
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'direct_json',
      project_id: projectId ?? null,
      url: jsonUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    try {
      const browserJson = await fetchViaBrowserProxy(jsonUrl, projectId);
      if (browserJson) return browserJson;
      return fetchProjectViaHtmlProxy(pageUrl, projectId);
    } catch {
      return null;
    }
  }
}

async function fetchProjectViaHtmlProxy(pageUrl: string, projectId?: string): Promise<KSProject | null> {
  const html = await fetchHtmlViaBrowserProxy(pageUrl, projectId);
  if (!html) return null;
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'browser_html_fallback',
      project_id: projectId ?? null,
      url: pageUrl,
      message: 'Browser worker HTML fallback returned a page without embedded project JSON.',
    });
    return null;
  }
  try {
    const data = JSON.parse(m[1]) as { props?: { pageProps?: { project?: KSProject }; initialProps?: { project?: KSProject } } };
    return data?.props?.pageProps?.project ?? data?.props?.initialProps?.project ?? null;
  } catch {
    return null;
  }
}

async function scrapeKickstarterHtmlFallback(projectId: string, jsonUrl: string): Promise<boolean> {
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  if (!pageUrl.startsWith('https://www.kickstarter.com/projects/')) return false;
  const applyHtml = (html: string) => {
    const image = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1]
      ?? null;
    const title = stripTags(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '');
    const description = stripTags(html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? '');
    if (!image && !title && !description) return false;
    updateProjectLiveMetadata(projectId, {
      name: title || undefined,
      blurb: description || undefined,
      image_url: image,
      image_thumb_url: image,
    });
    markFetched(projectId);
    return true;
  };
  try {
    const res = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(18_000),
      cache: 'no-store',
    });
    if (!res.ok) {
      const browserHtml = await fetchHtmlViaBrowserProxy(pageUrl, projectId);
      return browserHtml ? applyHtml(browserHtml) : false;
    }
    const html = await res.text();
    if (isBlockedKickstarterText(html)) {
      recordCrawlerError({
        source: 'ks_project',
        job_type: 'direct_html',
        project_id: projectId,
        url: pageUrl,
        status_code: res.status,
        message: 'Kickstarter project page returned a Cloudflare or HTML challenge.',
      });
      const browserHtml = await fetchHtmlViaBrowserProxy(pageUrl, projectId);
      return browserHtml ? applyHtml(browserHtml) : false;
    }
    return applyHtml(html);
  } catch {
    const browserHtml = await fetchHtmlViaBrowserProxy(pageUrl, projectId);
    return browserHtml ? applyHtml(browserHtml) : false;
  }
}

export interface ScrapeOptions {
  track_rewards?: number;
  track_comments?: number;
  track_text_diff?: number;
  manual?: boolean;
}

export async function scrapeAndStore(projectId: string, jsonUrl: string, opts: ScrapeOptions = {}): Promise<boolean> {
  const p = await scrapeKSJson(jsonUrl, projectId);
  if (!p) {
    if (await scrapeKickstarterHtmlFallback(projectId, jsonUrl)) return true;
    // Last resort: Kicktraq for live funding data (bypasses Cloudflare entirely)
    const ksUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
    const creatorSlug = extractCreatorSlug(ksUrl);
    const projectSlug = extractProjectSlug(ksUrl);
    if (creatorSlug && projectSlug) {
      const ktSummary = await scrapeKicktraqProjectSummary(creatorSlug, projectSlug);
      if (ktSummary && (ktSummary.pledged_usd > 0 || ktSummary.backers_count > 0)) {
        storeKicktraqSummary(projectId, ktSummary);
        return true;
      }
    }
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const projectState = p.state ?? 'unknown';
  const isLive = projectState === 'live';
  const { pledgedUsd, goalUsd } = resolveUsdAmounts(p);
  const existing = await getProjectById(projectId) as { usd_pledged?: number; backers_count?: number } | null;
  const latestSnapshot = getSnapshots(projectId).at(-1);
  const existingPledged = Number(existing?.usd_pledged ?? 0);
  const existingBackers = Number(existing?.backers_count ?? 0);
  const latestPledged = Number(latestSnapshot?.pledged_usd ?? 0);
  const latestBackers = Number(latestSnapshot?.backers_count ?? 0);
  const baselinePledged = Math.max(existingPledged, latestPledged);
  const baselineBackers = Math.max(existingBackers, latestBackers);
  const fetchedBackers = Number(p.backers_count ?? 0);

  if (pledgedUsd <= 0 && fetchedBackers <= 0 && (baselinePledged > 0 || baselineBackers > 0)) {
    return false;
  }

  const safePledgedUsd = pledgedUsd > 0 ? pledgedUsd : baselinePledged;
  const safeBackers = fetchedBackers > 0 ? fetchedBackers : baselineBackers;

  if (isLive || !opts.manual) {
    insertSnapshot({
      project_id: projectId,
      captured_at: now,
      pledged_usd: safePledgedUsd,
      backers_count: safeBackers,
      days_to_go: daysToGo(p.deadline),
      comments_count: p.comments_count ?? 0,
      updates_count: p.updates_count ?? 0,
      state: projectState,
      source: opts.manual ? 'ks_manual' : 'ks',
    });
  }

  updateProjectLiveMetadata(projectId, {
    name: p.name,
    blurb: p.blurb ?? null,
    state: projectState,
    goal_usd: goalUsd > 0 ? goalUsd : null,
    pledged_usd: safePledgedUsd > 0 ? safePledgedUsd : null,
    backers_count: safeBackers > 0 ? safeBackers : null,
    creator_name: p.creator?.name ?? null,
    creator_slug: p.creator?.slug ?? null,
    creator_url: p.creator?.urls?.web?.user ?? (p.creator?.slug ? `https://www.kickstarter.com/profile/${p.creator.slug}` : null),
    image_url: p.photo?.full ?? p.photo?.['1536x864'] ?? p.photo?.['1024x576'] ?? p.photo?.ed ?? p.photo?.med ?? p.photo?.small ?? null,
    image_thumb_url: p.photo?.little ?? p.photo?.thumb ?? p.photo?.small ?? p.photo?.ed ?? p.photo?.med ?? p.photo?.full ?? null,
  });

  if (opts.track_rewards && p.rewards?.length) {
    const rewards: RewardSnapshot[] = p.rewards.map(r => ({
      reward_id: String(r.id),
      title: r.title ?? '',
      description: r.description ?? '',
      amount_usd: parseNum(r.minimum),
      backers_count: r.backers_count ?? 0,
      limit_count: r.limit ?? null,
      is_limited: r.limited ? 1 : 0,
    }));
    insertRewardSnapshots(projectId, now, rewards);
  }

  upsertProjectCollaborators(projectId, normalizeCollaborators(projectId, p, now));

  if (opts.track_text_diff) {
    if (p.name) insertTextIfChanged(projectId, now, 'name', p.name);
    if (p.blurb) insertTextIfChanged(projectId, now, 'blurb', p.blurb);
  }

  markFetched(projectId);
  return true;
}

// ─── Kicktraq scraper ─────────────────────────────────────────────────────────

export interface KicktraqDay {
  date: string;
  pledged_usd: number;
  backers: number;
  comments?: number;
}

interface DailyChartJson {
  dates?: string[];
  pledged?: number[];
  backers?: number[];
  comments?: number[];
  data?: { dates?: string[]; pledged?: number[]; backers?: number[]; comments?: number[] };
  rows?: Array<[string, number, number, number?]>;
  chart_data?: { pledged?: number[]; backers?: number[]; comments?: number[]; start_date?: string };
}

type KicktraqOcrRow = {
  date?: string;
  pledged_usd?: number | string;
  backers?: number | string;
  comments?: number | string;
};

type KicktraqChartImage = {
  kind: 'pledges' | 'backers' | 'comments';
  url: string;
  base64: string;
  bytes: number;
  contentType: string;
  status: number;
};

export interface KicktraqScrapeDiagnostics {
  pageStatus?: number;
  jsonStatus?: number;
  jsonRows?: number;
  htmlRows?: number;
  imageStatus?: number;
  imageContentType?: string;
  imageBytes?: number;
  ocrProvider?: 'qwen' | 'anthropic' | 'openai';
  ocrStatus?: number;
  ocrRows?: number;
  ocrPreview?: string;
  ocrError?: string;
  ocrEndpoint?: string;
  ocrTimeoutMs?: number;
  ocrFallbackRows?: number;
  zeroRowsRejected?: number;
  debug?: {
    images?: Array<{
      kind: KicktraqChartImage['kind'];
      url: string;
      status: number;
      contentType: string;
      bytes: number;
      dataUrl: string;
    }>;
    modelOutput?: string;
    structuredRows?: KicktraqDay[];
  };
  reason?: string;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractOpenAIErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; type?: string; code?: string } };
    return [parsed.error?.message, parsed.error?.type, parsed.error?.code].filter(Boolean).join(' | ');
  } catch {
    return raw.slice(0, 200);
  }
}

function parseOcrNumber(value: number | string | undefined, integerOnly = false): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = value.trim().toLowerCase();
  if (!raw || raw === '-' || raw === 'n/a') return 0;
  const multiplier = raw.includes('m') ? 1_000_000 : raw.includes('k') ? 1_000 : 1;
  const normalized = raw.replace(/[^0-9.+-]/g, '');
  const parsed = parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  const result = parsed * multiplier;
  return integerOnly ? Math.round(result) : result;
}

function kicktraqVisionPrompt(mode: 'exact' | 'estimate' = 'exact') {
  const base = 'You are reading Kicktraq Daily Data tab chart images for a Kickstarter project. This is a vision chart extraction task, not plain text OCR. The images are provided in this order when available: Pledges Per Day, Backers Per Day, Comments Per Day. ' +
    'Extract the per-day values printed vertically on each bar. Do NOT extract the Funding Progress cumulative line chart. ' +
    'Use the x-axis MM-DD labels to assign dates to bars. Infer missing dates between visible tick labels sequentially and infer the year from the copyright/header context. ' +
    'Normalize money labels such as $6.7m, $469k, $20,249 into numeric USD amounts. ' +
    'Return ONLY a JSON array. Each item must be {"date":"YYYY-MM-DD","pledged_usd":number,"backers":number,"comments":number}. ';
  if (mode === 'estimate') {
    return base +
      'If the tiny vertical bar labels are unreadable, estimate the values from the bar heights, y-axis tick labels, and any visible Average Per Day value. Include approximate values for every visible daily bar. Do not return an empty array when bars are visible. Do not use zero unless a bar visibly has zero height.';
  }
  return base +
    'Only include dates where you can read at least one numeric value from a bar. Omit any unreadable date or unreadable field; do not invent zeros. If no bar values are readable, return [].';
}

async function fetchKicktraqChartImage(url: string, pageUrl: string, cookieStr: string, kind: KicktraqChartImage['kind']): Promise<KicktraqChartImage | null> {
  const imgRes = await fetch(url, {
    headers: {
      'Referer': pageUrl,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'image/png,image/*,*/*',
      ...(cookieStr ? { 'Cookie': cookieStr } : {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const contentType = imgRes.headers.get('content-type') ?? '';
  if (!imgRes.ok || !contentType.includes('image')) return null;
  const imgBuffer = await imgRes.arrayBuffer();
  return {
    kind,
    url,
    base64: Buffer.from(imgBuffer).toString('base64'),
    bytes: imgBuffer.byteLength,
    contentType,
    status: imgRes.status,
  };
}

async function fetchKicktraqDailyImages(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics): Promise<KicktraqChartImage[]> {
  const specs: Array<{ kind: KicktraqChartImage['kind']; file: string }> = [
    { kind: 'pledges', file: 'dailypledges.png' },
    { kind: 'backers', file: 'dailybackers.png' },
    { kind: 'comments', file: 'dailycomments.png' },
  ];
  const images = (await Promise.all(
    specs.map(spec => fetchKicktraqChartImage(pageUrl + spec.file, pageUrl, cookieStr, spec.kind).catch(() => null))
  )).filter(Boolean) as KicktraqChartImage[];

  if (diagnostics && images.length) {
    diagnostics.imageStatus = images.every(img => img.status === 200) ? 200 : images[0].status;
    diagnostics.imageContentType = images.map(img => `${img.kind}:${img.contentType}`).join(',');
    diagnostics.imageBytes = images.reduce((sum, img) => sum + img.bytes, 0);
    diagnostics.debug = {
      ...(diagnostics.debug ?? {}),
      images: images.map(img => ({
        kind: img.kind,
        url: img.url,
        status: img.status,
        contentType: img.contentType,
        bytes: img.bytes,
        dataUrl: `data:${img.contentType};base64,${img.base64}`,
      })),
    };
  }

  return images;
}

function usableKicktraqDays(
  rows: KicktraqOcrRow[],
  diagnostics?: KicktraqScrapeDiagnostics
): KicktraqDay[] {
  const parsed = rows
    .filter(r => r.date)
    .map(r => ({
      date: normalizeDate(r.date!),
      pledged_usd: parseOcrNumber(r.pledged_usd),
      backers: parseOcrNumber(r.backers, true),
      comments: r.comments === undefined || r.comments === null ? undefined : parseOcrNumber(r.comments, true),
    }));

  const usable = parsed.filter(d => d.pledged_usd > 0 || d.backers > 0 || (d.comments ?? 0) > 0);
  const rejected = parsed.length - usable.length;
  if (diagnostics && rejected > 0) {
    diagnostics.zeroRowsRejected = (diagnostics.zeroRowsRejected ?? 0) + rejected;
  }
  return usable;
}

function rowsFromOcrText(text: string): KicktraqOcrRow[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const candidates = [
    cleaned.match(/\[[\s\S]*\]/)?.[0],
    cleaned.match(/\{[\s\S]*\}/)?.[0],
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as
        | KicktraqOcrRow[]
        | { rows?: KicktraqOcrRow[]; data?: KicktraqOcrRow[] };
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.rows)) return parsed.rows;
      if (Array.isArray(parsed.data)) return parsed.data;
    } catch { /* try next candidate */ }
  }
  return [];
}

function parseDailyChartJson(json: DailyChartJson): KicktraqDay[] | null {
  const days: KicktraqDay[] = [];
  const src = json.data ?? json;
  const dates = (src as DailyChartJson).dates;
  const pledged = (src as DailyChartJson).pledged;
  const backers = (src as DailyChartJson).backers;
  const comments = (src as DailyChartJson).comments;

  if (dates?.length && pledged?.length) {
    for (let i = 0; i < dates.length; i++) {
      days.push({ date: normalizeDate(dates[i]), pledged_usd: pledged[i] ?? 0, backers: backers?.[i] ?? 0, comments: comments?.[i] });
    }
    return days.length ? days : null;
  }

  if (json.rows?.length) {
    for (const row of json.rows) {
      days.push({ date: normalizeDate(row[0]), pledged_usd: row[1] ?? 0, backers: row[2] ?? 0, comments: row[3] });
    }
    return days.length ? days : null;
  }

  if (json.chart_data?.pledged?.length && json.chart_data?.start_date) {
    const start = new Date(json.chart_data.start_date);
    const p = json.chart_data.pledged;
    const b = json.chart_data.backers ?? [];
    const c = json.chart_data.comments ?? [];
    for (let i = 0; i < p.length; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10), pledged_usd: p[i] ?? 0, backers: b[i] ?? 0, comments: c[i] });
    }
    return days.length ? days : null;
  }

  return null;
}

export async function scrapeKicktraqDetailed(creatorSlug: string, projectSlug: string): Promise<{ days: KicktraqDay[]; diagnostics: KicktraqScrapeDiagnostics }> {
  const pageUrl = 'https://www.kicktraq.com/projects/' + creatorSlug + '/' + projectSlug + '/';
  const diagnostics: KicktraqScrapeDiagnostics = {};

  // Step 1: fetch main page for session cookie + HTML fallback
  let html = '';
  let cookieStr = '';
  try {
    const pageRes = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    diagnostics.pageStatus = pageRes.status;
    if (pageRes.status === 404) return { days: [], diagnostics: { ...diagnostics, reason: 'Kicktraq project page returned 404.' } };
    if (!pageRes.ok) return { days: [], diagnostics: { ...diagnostics, reason: `Kicktraq project page returned HTTP ${pageRes.status}.` } };
    html = await pageRes.text();
    const setCookie = pageRes.headers.getSetCookie?.() ?? [];
    cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
  } catch (e) {
    return { days: [], diagnostics: { ...diagnostics, reason: `Could not fetch Kicktraq project page: ${String(e)}` } };
  }

  // Step 2: try dailychart.json with session cookie
  const jsonUrl = pageUrl + 'dailychart.json';
  try {
    const jsonRes = await fetch(jsonUrl, {
      headers: {
        'Referer': pageUrl,
        'Origin': 'https://www.kicktraq.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...(cookieStr ? { 'Cookie': cookieStr } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    diagnostics.jsonStatus = jsonRes.status;
    if (jsonRes.ok) {
      const text = await jsonRes.text();
      if (text && !text.trim().startsWith('<') && !text.includes('invalid request')) {
        const json = JSON.parse(text);
        const days = parseDailyChartJson(json);
        diagnostics.jsonRows = days?.length ?? 0;
        if (days?.length) return { days, diagnostics };
      }
    }
  } catch { /* fall through */ }

  // Step 3: HTML embedded chart data (older Kicktraq format)
  const htmlDays = parseKicktraqHtml(html);
  diagnostics.htmlRows = htmlDays.length;
  if (htmlDays.length) return { days: htmlDays, diagnostics };

  // Step 4: OCR the dailychart.png via vision models.
  if (getOptionalEnv('QWEN_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaQwen(pageUrl, cookieStr, diagnostics);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  if (getOptionalEnv('OPENAI_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaOpenAI(pageUrl, cookieStr, diagnostics);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  if (getOptionalEnv('ANTHROPIC_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaOCR(pageUrl, cookieStr, diagnostics);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  return { days: [], diagnostics: { ...diagnostics, reason: 'No daily rows were found in JSON, HTML, or OCR output.' } };
}

export async function scrapeKicktraq(creatorSlug: string, projectSlug: string): Promise<KicktraqDay[]> {
  return (await scrapeKicktraqDetailed(creatorSlug, projectSlug)).days;
}

// ─── OCR fallback via Claude Vision ──────────────────────────────────────────

async function scrapeKicktraqViaOCR(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics): Promise<KicktraqDay[]> {
  const imgUrl = pageUrl + 'dailychart.png';
  const anthropicKey = getOptionalEnv('ANTHROPIC_API_KEY');
  if (diagnostics) diagnostics.ocrProvider = 'anthropic';

  try {
    const imgRes = await fetch(imgUrl, {
      headers: {
        'Referer': pageUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/png,image/*,*/*',
        ...(cookieStr ? { 'Cookie': cookieStr } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    console.log('[OCR] img status=' + imgRes.status + ' content-type=' + imgRes.headers.get('content-type'));
    if (diagnostics) {
      diagnostics.imageStatus = imgRes.status;
      diagnostics.imageContentType = imgRes.headers.get('content-type') ?? '';
    }
    if (!imgRes.ok) return [];
    const contentType = imgRes.headers.get('content-type') ?? '';
    if (!contentType.includes('image')) {
      const preview = await imgRes.text();
      console.log('[OCR] not image, body: ' + preview.slice(0, 100));
      return [];
    }

    const imgBuffer = await imgRes.arrayBuffer();
    console.log('[OCR] img size=' + imgBuffer.byteLength + ' bytes');
    if (diagnostics) diagnostics.imageBytes = imgBuffer.byteLength;
    const base64 = Buffer.from(imgBuffer).toString('base64');

    const ocrPrompt = kicktraqVisionPrompt();

    const claudeBody = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: ocrPrompt },
        ],
      }],
    });

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: claudeBody,
      signal: AbortSignal.timeout(60_000),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text().catch(() => '');
      console.log('[OCR] Claude error status=' + claudeRes.status + ' body=' + errText.slice(0, 200));
      if (diagnostics) {
        diagnostics.ocrStatus = claudeRes.status;
        diagnostics.ocrPreview = errText.slice(0, 200);
      }
      return [];
    }
    if (diagnostics) diagnostics.ocrStatus = claudeRes.status;

    const claudeData = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const text = claudeData.content?.[0]?.text ?? '';
    console.log('[OCR] Claude response length=' + text.length + ' preview=' + text.slice(0, 100));
    if (diagnostics) diagnostics.ocrPreview = text.slice(0, 200);

    const rows = rowsFromOcrText(text);
    console.log('[OCR] parsed rows=' + rows.length);
    if (diagnostics) diagnostics.ocrRows = rows.length;

    return usableKicktraqDays(rows, diagnostics);
  } catch (e) {
    console.log('[OCR] exception: ' + String(e));
    return [];
  }
}

async function scrapeKicktraqViaQwen(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics): Promise<KicktraqDay[]> {
  const qwenKey = getOptionalEnv('QWEN_API_KEY');
  const qwenModel = getOptionalEnv('QWEN_VISION_MODEL') || 'qwen-vl-plus';
  const qwenBaseUrl = (getOptionalEnv('QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const qwenEndpoint = `${qwenBaseUrl}/chat/completions`;
  const qwenTimeoutMs = Math.max(60_000, Number(getOptionalEnv('QWEN_TIMEOUT_MS') || 180_000));
  if (diagnostics) diagnostics.ocrProvider = 'qwen';
  if (diagnostics) diagnostics.ocrEndpoint = qwenEndpoint;
  if (diagnostics) diagnostics.ocrTimeoutMs = qwenTimeoutMs;

  try {
    const images = await fetchKicktraqDailyImages(pageUrl, cookieStr, diagnostics);
    if (!images.length) return [];

    const callQwen = async (prompt: string) => {
      const body = JSON.stringify({
        model: qwenModel,
        temperature: 0,
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.flatMap(image => [
              { type: 'text', text: `Image: ${image.kind}` },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${image.base64}` } },
            ]),
          ],
        }],
      });

      let res: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await fetch(qwenEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${qwenKey}`,
            },
            body,
            signal: AbortSignal.timeout(qwenTimeoutMs),
          });
        } catch (e) {
          if (attempt === 2) throw e;
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (res.status !== 429 || attempt === 2) break;
        const retryAfter = Number(res.headers.get('retry-after') ?? 0);
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
      }

      if (!res) return { ok: false, status: 0, text: '' };
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.log('[Qwen OCR] error status=' + res.status + ' body=' + errText.slice(0, 300));
        return { ok: false, status: res.status, text: errText };
      }

      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      return { ok: true, status: res.status, text: data.choices?.[0]?.message?.content ?? '' };
    };

    const result = await callQwen(kicktraqVisionPrompt('estimate'));
    if (!result.ok) {
    if (diagnostics) {
      diagnostics.ocrStatus = result.status;
      diagnostics.ocrPreview = result.text.slice(0, 200);
      diagnostics.debug = { ...(diagnostics.debug ?? {}), modelOutput: result.text };
      diagnostics.ocrError = extractOpenAIErrorMessage(result.text);
    }
      return [];
    }

    const estimatedRows = rowsFromOcrText(result.text);
    if (diagnostics) {
      diagnostics.ocrStatus = result.status;
      diagnostics.ocrPreview = result.text.slice(0, 200);
      diagnostics.debug = { ...(diagnostics.debug ?? {}), modelOutput: result.text };
      diagnostics.ocrFallbackRows = estimatedRows.length;
      diagnostics.ocrRows = estimatedRows.length;
    }
    const days = usableKicktraqDays(estimatedRows, diagnostics);
    if (diagnostics) diagnostics.debug = { ...(diagnostics.debug ?? {}), structuredRows: days };
    return days;
  } catch (e) {
    console.log('[Qwen OCR] exception: ' + String(e));
    if (diagnostics) {
      diagnostics.ocrError = String(e);
      diagnostics.reason = `Qwen OCR request failed before receiving an HTTP response.`;
    }
    return [];
  }
}

async function scrapeKicktraqViaOpenAI(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics): Promise<KicktraqDay[]> {
  const imgUrl = pageUrl + 'dailychart.png';
  const openAIKey = getOptionalEnv('OPENAI_API_KEY');
  const openAIModel = getOptionalEnv('OPENAI_VISION_MODEL') || 'gpt-4o-mini';
  if (diagnostics) diagnostics.ocrProvider = 'openai';

  try {
    const imgRes = await fetch(imgUrl, {
      headers: {
        'Referer': pageUrl,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/png,image/*,*/*',
        ...(cookieStr ? { 'Cookie': cookieStr } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (diagnostics) {
      diagnostics.imageStatus = imgRes.status;
      diagnostics.imageContentType = imgRes.headers.get('content-type') ?? '';
    }
    if (!imgRes.ok) return [];
    const contentType = imgRes.headers.get('content-type') ?? '';
    if (!contentType.includes('image')) return [];

    const imgBuffer = await imgRes.arrayBuffer();
    if (diagnostics) diagnostics.imageBytes = imgBuffer.byteLength;
    const base64 = Buffer.from(imgBuffer).toString('base64');
    const prompt = kicktraqVisionPrompt();

    const body = JSON.stringify({
      model: openAIModel,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
        ],
      }],
    });

    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openAIKey}`,
        },
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (res.status !== 429 || attempt === 2) break;
      const retryAfter = Number(res.headers.get('retry-after') ?? 0);
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
    }
    if (!res) return [];
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.log('[OpenAI OCR] error status=' + res.status + ' body=' + errText.slice(0, 300));
      if (diagnostics) {
        diagnostics.ocrStatus = res.status;
        diagnostics.ocrPreview = errText.slice(0, 200);
        diagnostics.ocrError = extractOpenAIErrorMessage(errText);
      }
      return [];
    }
    if (diagnostics) diagnostics.ocrStatus = res.status;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (diagnostics) diagnostics.ocrPreview = text.slice(0, 200);
    const rows = rowsFromOcrText(text);
    if (diagnostics) diagnostics.ocrRows = rows.length;
    return usableKicktraqDays(rows, diagnostics);
  } catch (e) {
    console.log('[OpenAI OCR] exception: ' + String(e));
    return [];
  }
}

// ─── HTML chart data parser ───────────────────────────────────────────────────

function parseKicktraqHtml(html: string): KicktraqDay[] {
  const days: KicktraqDay[] = [];

  const rowsMatch = html.match(/addRows\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (rowsMatch) {
    const entries = rowsMatch[1].matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/g);
    for (const m of entries) {
      days.push({ date: normalizeDate(m[1]), pledged_usd: parseFloat(m[2]), backers: parseInt(m[3]), comments: m[4] ? parseInt(m[4]) : undefined });
    }
    if (days.length) return days;
  }

  const pledgeMatch = html.match(/var\s+(?:pledge|pledged?)Data\s*=\s*\[([^\]]+)\]/);
  const backerMatch = html.match(/var\s+(?:backer|backers?)Data\s*=\s*\[([^\]]+)\]/);
  const commentMatch = html.match(/var\s+(?:comment|comments?)Data\s*=\s*\[([^\]]+)\]/);
  const startMatch = html.match(/var\s+startDate\s*=\s*['"]([^'"]+)['"]/);

  if (pledgeMatch && startMatch) {
    const pledged = pledgeMatch[1].split(',').map(s => parseFloat(s.trim()) || 0);
    const backers = backerMatch ? backerMatch[1].split(',').map(s => parseInt(s.trim()) || 0) : [];
    const comments = commentMatch ? commentMatch[1].split(',').map(s => parseInt(s.trim()) || 0) : [];
    const start = new Date(startMatch[1]);
    for (let i = 0; i < pledged.length; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({ date: d.toISOString().slice(0, 10), pledged_usd: pledged[i], backers: backers[i] ?? 0, comments: comments[i] });
    }
    if (days.length) return days;
  }

  const chartMatch = html.match(/"chart_data"\s*:\s*\{([\s\S]*?)\}/);
  if (chartMatch) {
    const pledgedArr = chartMatch[1].match(/"pledged"\s*:\s*\[([^\]]+)\]/);
    const backersArr = chartMatch[1].match(/"backers"\s*:\s*\[([^\]]+)\]/);
    const commentsArr = chartMatch[1].match(/"comments"\s*:\s*\[([^\]]+)\]/);
    const startDateM = html.match(/"start_date"\s*:\s*"([^"]+)"/);
    if (pledgedArr && startDateM) {
      const pledged = pledgedArr[1].split(',').map(Number);
      const backerVals = backersArr ? backersArr[1].split(',').map(Number) : [];
      const commentVals = commentsArr ? commentsArr[1].split(',').map(Number) : [];
      const start = new Date(startDateM[1]);
      for (let i = 0; i < pledged.length; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push({ date: d.toISOString().slice(0, 10), pledged_usd: pledged[i], backers: backerVals[i] ?? 0, comments: commentVals[i] });
      }
    }
  }

  return days;
}

function normalizeDate(raw: string): string {
  try {
    return new Date(raw).toISOString().slice(0, 10);
  } catch {
    return raw;
  }
}

export interface KicktraqWrittenSnapshot {
  date: string;
  captured_at: number;
  pledged_usd: number;
  backers_count: number;
  comments_count: number;
  daily_pledged_usd: number;
  daily_backers: number;
  daily_comments: number;
  source: 'kicktraq';
}

export function storeKicktraqDays(projectId: string, days: KicktraqDay[]): KicktraqWrittenSnapshot[] {
  const validDays = days
    .filter(d => d.pledged_usd > 0 || d.backers > 0 || (d.comments ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!validDays.length) return [];

  deleteKicktraqSnapshots(projectId);

  let pledgedTotal = 0;
  let backersTotal = 0;
  let commentsTotal = 0;
  const written: KicktraqWrittenSnapshot[] = [];

  for (const d of validDays) {
    pledgedTotal += d.pledged_usd;
    backersTotal += d.backers;
    commentsTotal += d.comments ?? 0;
    const capturedAt = Math.floor(new Date(d.date + 'T12:00:00Z').getTime() / 1000);
    insertSnapshot({
      project_id: projectId,
      captured_at: capturedAt,
      pledged_usd: pledgedTotal,
      backers_count: backersTotal,
      days_to_go: 0,
      comments_count: commentsTotal,
      updates_count: 0,
      state: 'historical',
      source: 'kicktraq',
    });
    written.push({
      date: d.date,
      captured_at: capturedAt,
      pledged_usd: pledgedTotal,
      backers_count: backersTotal,
      comments_count: commentsTotal,
      daily_pledged_usd: d.pledged_usd,
      daily_backers: d.backers,
      daily_comments: d.comments ?? 0,
      source: 'kicktraq',
    });
  }

  return written;
}
