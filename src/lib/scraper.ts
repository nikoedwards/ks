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
  recordScrapeFailure,
  recordCrawlerError,
  updateProjectLiveMetadata,
  type ProjectCollaborator,
  type RewardSnapshot,
} from './db';
import { resolveUsdAmounts as resolveUsdAmountsShared } from './money';
import { resolveProjectState } from './projectState';

export function getOptionalEnv(name: string) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

// ─── KS JSON API types ────────────────────────────────────────────────────────

interface KSReward {
  id?: number | string;
  reward_id?: number | string;
  title?: string;
  description?: string;
  minimum?: number | string;
  amount?: number | string;
  pledge_amount?: number | string;
  converted_minimum?: number | string;
  backers_count?: number;
  backers?: number;
  limit?: number | null;
  limit_count?: number | null;
  quantity?: number | null;
  limited?: boolean;
  is_limited?: boolean | number;
  remaining?: number | null;
  [key: string]: unknown;
}

interface KSProject {
  id: number;
  name: string;
  blurb?: string;
  state?: string;
  slug?: string;
  pledged?: number | string;
  pledged_amount?: number | string;
  pledge_amount?: number | string;
  usd_pledged?: string | number;
  usd_pledged_amount?: string | number;
  converted_pledged_amount?: number;
  converted_goal_amount?: number;
  fx_rate?: number | string;
  goal?: number | string;
  goal_amount?: number | string;
  backers_count?: number;
  backers?: number;
  backer_count?: number;
  comments_count?: number;
  updates_count?: number;
  created_at?: number;
  launched_at?: number;
  deadline?: number;
  rewards?: KSReward[];
  creator?: { name?: string; slug?: string; urls?: { web?: { user?: string } } };
  collaborators?: KSCollaborator[];
  project_collaborators?: KSCollaborator[];
  [key: string]: unknown;
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
  user?: KSCollaborator;
  [key: string]: unknown;
}

export interface KicktraqSummary {
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
    const match = url.pathname.match(/^\/projects\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    url.hostname = 'www.kickstarter.com';
    url.search = '';
    url.hash = '';
    const creatorSlug = match[1];
    const projectSlug = match[2].replace(/\.json$/, '');
    url.pathname = `/projects/${creatorSlug}/${projectSlug}.json`;
    return url.toString();
  } catch {
    return null;
  }
}

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function parseUnknownNum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return parseFloat(value.replace(/[^\d.-]/g, '')) || 0;
  if (isRecord(value)) return parseUnknownNum(value.amount ?? value.value);
  return 0;
}

function firstPositiveNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = parseUnknownNum(source[key]);
    if (value > 0) return value;
  }
  return 0;
}

function resolveUsdAmounts(p: KSProject): { pledgedUsd: number; goalUsd: number } {
  const currency = typeof p.currency === 'string' ? p.currency : null;
  const { pledgedUsd, goalUsd } = resolveUsdAmountsShared({
    pledgedLocal: firstPositiveNumber(p, ['pledged', 'pledged_amount', 'pledge_amount', 'amount_pledged']),
    goalLocal: firstPositiveNumber(p, ['goal', 'goal_amount', 'funding_goal']),
    convertedPledged: firstPositiveNumber(p, ['converted_pledged_amount', 'converted_pledged', 'usd_pledged_amount']),
    convertedGoal: firstPositiveNumber(p, ['converted_goal_amount', 'converted_goal']),
    explicitUsdPledged: parseNum(p.usd_pledged),
    fxRate: parseNum(p.fx_rate),
    staticUsdRate: firstPositiveNumber(p, ['static_usd_rate', 'usd_exchange_rate']),
    currency,
  });
  return { pledgedUsd, goalUsd };
}

function resolveBackersCount(p: KSProject): number {
  return firstPositiveNumber(p, ['backers_count', 'backers', 'backer_count']);
}

function daysToGo(deadline: number | undefined): number {
  if (!deadline) return 0;
  return Math.max(0, Math.round((deadline * 1000 - Date.now()) / 86_400_000));
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (isRecord(value)) return Object.values(value).filter(isRecord) as T[];
  return [];
}

const SERVICE_AGENCY_PATTERNS = [
  { pattern: /longham/i, label: 'Longham - Crowdfunding Expert' },
  { pattern: /global\s*one\s*click|goc/i, label: 'Global OneClick' },
  { pattern: /\bk[\s-]*lab\b|\bklab\b/i, label: 'K-Lab' },
  { pattern: /vinyl/i, label: 'Vinyl - Full Service Crowdfunding Expert' },
];

function detectServiceAgency(name: string, role?: string | null) {
  const haystack = `${name} ${role ?? ''}`;
  return SERVICE_AGENCY_PATTERNS.find(item => item.pattern.test(haystack))?.label ?? null;
}

function normalizeCollaborators(projectId: string, p: KSProject, now: number): ProjectCollaborator[] {
  const raw = [
    ...normalizeArray<KSCollaborator>(p.collaborators),
    ...normalizeArray<KSCollaborator>(p.project_collaborators),
  ];
  const rows = new Map<string, ProjectCollaborator>();
  for (const c of raw) {
    const user = isRecord(c.user) ? c.user as KSCollaborator : null;
    const name = (c.name ?? user?.name)?.trim();
    if (!name) continue;
    const role = c.role ?? user?.role ?? null;
    const agencyName = detectServiceAgency(name, role);
    const key = String(c.id ?? user?.id ?? c.slug ?? user?.slug ?? name.toLowerCase().replace(/\s+/g, '-'));
    if (key === projectId) continue;
    rows.set(key, {
      collaborator_key: key,
      name: agencyName ?? name,
      role: agencyName ? 'Service agency' : role,
      avatar_url: c.avatar?.small ?? c.avatar?.thumb ?? c.photo?.small ?? c.photo?.thumb ?? c.photo?.med ?? c.photo?.full
        ?? user?.avatar?.small ?? user?.avatar?.thumb ?? user?.photo?.small ?? user?.photo?.thumb ?? user?.photo?.med ?? user?.photo?.full ?? null,
      profile_url: c.urls?.web?.user ?? c.urls?.web?.profile ?? user?.urls?.web?.user ?? user?.urls?.web?.profile
        ?? (c.slug ? `https://www.kickstarter.com/profile/${c.slug}` : user?.slug ? `https://www.kickstarter.com/profile/${user.slug}` : null),
      is_service_agency: agencyName ? 1 : 0,
      captured_at: now,
    });
  }
  return [...rows.values()];
}

function normalizeRewards(p: KSProject): RewardSnapshot[] {
  return normalizeArray<KSReward>(p.rewards)
    .map((r, index) => {
      const amount = parseNum(r.minimum ?? r.amount ?? r.pledge_amount ?? r.converted_minimum);
      const rewardId = r.id ?? r.reward_id ?? `${amount}-${index}`;
      const limit = r.limit ?? r.limit_count ?? r.quantity ?? null;
      return {
        reward_id: String(rewardId),
        title: r.title ?? '',
        description: r.description ?? '',
        amount_usd: amount,
        backers_count: Number(r.backers_count ?? r.backers ?? 0) || 0,
        limit_count: typeof limit === 'number' ? limit : null,
        is_limited: r.limited || r.is_limited || limit ? 1 : 0,
      };
    })
    .filter(r => r.reward_id && (r.title || r.description || r.amount_usd > 0 || r.backers_count > 0));
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
  // Kicktraq's infobox line is "Funded: $X of $Y" on current pages (older pages used
  // "Funding: $X of $Y (NN%)"). Capture both amounts as tight currency tokens so the
  // trailing "Dates:" text can never bleed into the goal value. Works with/without the
  // trailing percentage paren.
  const MONEY = String.raw`(?:US|HK|A|C|CA|NZ|S|R)?[$£€¥]\s?\d[\d.,]*\s?(?:million|thousand|billion|m|k|bn)?`;
  const fundingMatch = details.match(new RegExp(`Fund(?:ed|ing):\\s*(${MONEY})\\s+of\\s+(${MONEY})`, 'i'));
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

function looksLikeReward(value: unknown) {
  if (!isRecord(value)) return false;
  return 'minimum' in value || 'amount' in value || 'pledge_amount' in value || 'backers_count' in value || 'reward_id' in value;
}

function looksLikeCollaborator(value: unknown) {
  if (!isRecord(value)) return false;
  return 'role' in value || 'avatar' in value || 'photo' in value || 'user' in value || 'profile_url' in value;
}

function detailArray(source: Record<string, unknown>, keys: string[], predicate: (value: unknown) => boolean) {
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value) && value.some(predicate)) return value;
  }
  return null;
}

function mergeProjectDetails(project: KSProject, source: Record<string, unknown>): KSProject {
  const merged = { ...project };
  const rewards = detailArray(source, ['rewards', 'reward_tiers', 'available_rewards'], looksLikeReward);
  const collaborators = detailArray(source, ['collaborators', 'project_collaborators', 'team_members', 'project_team'], looksLikeCollaborator);
  if (!merged.rewards?.length && rewards) merged.rewards = rewards as KSReward[];
  if (!merged.collaborators?.length && collaborators) merged.collaborators = collaborators as KSCollaborator[];
  return merged;
}

function projectScore(project: KSProject) {
  let score = 10;
  if (project.rewards?.length) score += 40 + project.rewards.length;
  if (project.collaborators?.length || project.project_collaborators?.length) {
    score += 30 + (project.collaborators?.length ?? 0) + (project.project_collaborators?.length ?? 0);
  }
  if (project.blurb) score += 2;
  if (project.photo) score += 2;
  return score;
}

function hasProjectDetails(project: KSProject) {
  return Boolean(project.rewards?.length || project.collaborators?.length || project.project_collaborators?.length);
}

function unwrapKickstarterProject(value: unknown): KSProject | null {
  if (isKickstarterProject(value)) return mergeProjectDetails(value, value);
  if (!isRecord(value)) return null;

  const project = value.project;
  if (isKickstarterProject(project)) return mergeProjectDetails(project, value);

  const body = value.body;
  if (isKickstarterProject(body)) return mergeProjectDetails(body, value);
  if (isRecord(body) && isKickstarterProject(body.project)) return mergeProjectDetails(body.project, body);

  const text = value.text;
  if (typeof text === 'string' && text.trim()) {
    try {
      return unwrapKickstarterProject(JSON.parse(text));
    } catch {
      return null;
    }
  }

  let best: KSProject | null = null;
  let bestScore = -1;
  const seen = new Set<unknown>();
  const queue: Array<{ value: unknown; parent: Record<string, unknown> | null }> = [{ value, parent: null }];
  for (let index = 0; index < queue.length && index < 2000; index++) {
    const item = queue[index];
    if (!isRecord(item.value) || seen.has(item.value)) continue;
    seen.add(item.value);
    if (isKickstarterProject(item.value)) {
      const candidate = mergeProjectDetails(item.value, item.parent ?? item.value);
      const score = projectScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    for (const child of Object.values(item.value)) {
      if (isRecord(child) || Array.isArray(child)) queue.push({ value: child, parent: item.value });
    }
  }
  return best;
}

function workerStatus(value: unknown): number | null {
  return isRecord(value) && typeof value.status === 'number' ? value.status : null;
}

function workerOk(value: unknown): boolean | null {
  return isRecord(value) && typeof value.ok === 'boolean' ? value.ok : null;
}

async function fetchViaBrowserProxy(url: string, projectId?: string, options: { basicOnly?: boolean } = {}): Promise<KSProject | null> {
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
      body: JSON.stringify({
        url,
        expect: 'json',
        mode: !options.basicOnly && url.includes('kickstarter.com/projects/') ? 'project_detail_debug' : undefined,
        basicOnly: options.basicOnly,
        pageTimeoutMs: Number(getOptionalEnv('KICKSTARTER_BROWSER_PAGE_TIMEOUT_MS') || 45_000),
        settleMs: 1500,
        scrollSteps: 10,
      }),
      signal: AbortSignal.timeout(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000)),
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

// ─── New rich worker endpoints (/project, /core) ──────────────────────────────
// The browser worker exposes /project (rich: core stats + per-tier rewards +
// creator via in-page GraphQL) and /core (batch core stats). They live on the
// same service as /fetch, so derive the base URL from KICKSTARTER_BROWSER_FETCH_URL
// (strip the trailing /fetch) unless KICKSTARTER_BROWSER_WORKER_URL is set.
export function getWorkerBaseUrl(): string {
  const explicit = getOptionalEnv('KICKSTARTER_BROWSER_WORKER_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  if (!fetchUrl) return '';
  return fetchUrl.replace(/\/fetch\/?$/i, '').replace(/\/+$/, '');
}

interface WorkerReward {
  id?: string;
  title?: string | null;
  description?: string | null;
  amount?: number | null;
  currency?: string | null;
  backers_count?: number | null;
  limit?: number | null;
  remaining?: number | null;
  available?: boolean | null;
  estimated_delivery?: string | null;
  items?: { name: string | null; quantity: number | null }[];
}

interface WorkerProjectBody {
  url?: string;
  creator_segment?: string | null;
  name?: string | null;
  blurb?: string | null;
  image?: string | null;
  state?: string | null;
  currency?: string | null;
  backers_count?: number | null;
  pledged?: number | null;
  goal?: number | null;
  percent_funded?: number | null;
  deadline_at?: number | null;
  launched_at?: number | null;
  category?: string | null;
  parent_category?: string | null;
  location?: string | null;
  comments_count?: number | null;
  rewards?: WorkerReward[];
  creator?: {
    slug?: string | null;
    profileUrl?: string | null;
    name?: string | null;
    biography?: string | null;
    launched_count?: number | null;
    backings_count?: number | null;
  } | null;
  collaborators?: { name?: string | null; slug?: string | null; role?: string | null }[];
}

// Map the worker /project body into the KSProject shape so the existing
// scrapeAndStore persistence (snapshot, metadata, rewards, collaborators) works
// unchanged.
function mapWorkerProjectToKS(body: WorkerProjectBody, pageUrl: string): KSProject {
  const slug = extractProjectSlug(pageUrl) ?? undefined;
  const rewards: KSReward[] = Array.isArray(body.rewards)
    ? body.rewards.map((r, i) => ({
        id: r.id ?? `${r.amount ?? 0}-${i}`,
        title: r.title ?? '',
        description: r.description ?? '',
        minimum: r.amount ?? undefined,
        amount: r.amount ?? undefined,
        backers_count: Number(r.backers_count ?? 0) || 0,
        limit: r.limit ?? null,
        remaining: r.remaining ?? null,
        is_limited: r.limit != null ? 1 : 0,
      }))
    : [];
  const creator = body.creator
    ? {
        name: body.creator.name ?? undefined,
        slug: body.creator.slug ?? body.creator_segment ?? undefined,
        urls: { web: { user: body.creator.profileUrl ?? undefined } },
      }
    : undefined;
  const collaborators: KSCollaborator[] = Array.isArray(body.collaborators)
    ? body.collaborators
        .filter((c) => c && typeof c.name === 'string' && c.name.trim())
        .map((c) => ({
          name: c.name!.trim(),
          slug: c.slug ?? undefined,
          role: c.role ?? 'Collaborator',
        }))
    : [];
  return {
    id: 0,
    name: body.name ?? '',
    blurb: body.blurb ?? undefined,
    state: typeof body.state === 'string' ? body.state.toLowerCase() : undefined,
    slug,
    currency: body.currency ?? undefined,
    pledged: body.pledged ?? undefined,
    goal: body.goal ?? undefined,
    backers_count: body.backers_count ?? undefined,
    comments_count: body.comments_count ?? undefined,
    launched_at: typeof body.launched_at === 'number' ? body.launched_at : undefined,
    deadline: typeof body.deadline_at === 'number' ? body.deadline_at : undefined,
    rewards,
    creator,
    collaborators,
    photo: body.image ? { full: body.image } : undefined,
  } as KSProject;
}

// Fetch rich project data (core + rewards + creator) via the worker /project
// endpoint. Returns a KSProject or null on failure / Cloudflare block.
export async function fetchProjectViaWorker(pageUrl: string, projectId?: string): Promise<KSProject | null> {
  const base = getWorkerBaseUrl();
  if (!base) return null;
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  try {
    const res = await fetch(`${base}/project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url: pageUrl }),
      signal: AbortSignal.timeout(Math.max(60_000, Math.min(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000), 300_000))),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_project', project_id: projectId ?? null, url: pageUrl,
        status_code: res.status, message: `Worker /project HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
      return null;
    }
    const data = JSON.parse(text) as { ok?: boolean; status?: number; reason?: string; body?: WorkerProjectBody; error?: string };
    if (!data.ok || !data.body) {
      // A /login redirect means KS took the project down (suspended) or it's no
      // longer public. Demote it out of the live set so it stops being queued;
      // KS discovery re-promotes it to 'live' if it ever comes back.
      if (data.reason === 'login_redirect' && projectId) {
        updateProjectLiveMetadata(projectId, { state: 'suspended' });
        recordCrawlerError({
          source: 'ks_project', job_type: 'worker_project', project_id: projectId, url: pageUrl,
          status_code: data.status ?? 451,
          message: 'Project redirects to /login (suspended/unavailable); demoted out of live set.',
        });
        return null;
      }
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_project', project_id: projectId ?? null, url: pageUrl,
        status_code: data.status ?? res.status,
        message: `Worker /project not ok. status=${data.status ?? 'unknown'} error=${data.error ?? ''}`,
      });
      return null;
    }
    return mapWorkerProjectToKS(data.body, pageUrl);
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project', job_type: 'worker_project', project_id: projectId ?? null, url: pageUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export interface WorkerCollaborator {
  name?: string | null;
  slug?: string | null;
  role?: string | null;
  profileUrl?: string | null;
  avatarUrl?: string | null;
}

// ── ISOLATED collaborator backfill plumbing (worker /collab) ────────────────
// Calls the isolated worker endpoint that probes a project's collaborators via
// GraphQL + main-page DOM. Returns the raw collaborator list (+ debug) so the
// flag-gated backfill pass can store them. Does not touch the stable /project
// path. `debug` is surfaced for the first isolated validation runs.
export async function fetchCollaboratorsViaWorker(
  pageUrl: string,
  projectId?: string,
): Promise<{ collaborators: WorkerCollaborator[]; debug?: unknown } | null> {
  const base = getWorkerBaseUrl();
  if (!base) return null;
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  try {
    const res = await fetch(`${base}/collab`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ url: pageUrl }),
      signal: AbortSignal.timeout(Math.max(60_000, Math.min(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000), 300_000))),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_collab', project_id: projectId ?? null, url: pageUrl,
        status_code: res.status, message: `Worker /collab HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
      return null;
    }
    const data = JSON.parse(text) as {
      ok?: boolean; status?: number; reason?: string; error?: string;
      body?: { collaborators?: WorkerCollaborator[]; debug?: unknown };
    };
    if (!data.ok || !data.body) {
      if (data.reason === 'login_redirect' && projectId) {
        updateProjectLiveMetadata(projectId, { state: 'suspended' });
        return null;
      }
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_collab', project_id: projectId ?? null, url: pageUrl,
        status_code: data.status ?? res.status,
        message: `Worker /collab not ok. status=${data.status ?? 'unknown'} error=${data.error ?? ''}`,
      });
      return null;
    }
    return {
      collaborators: Array.isArray(data.body.collaborators) ? data.body.collaborators : [],
      debug: data.body.debug,
    };
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project', job_type: 'worker_collab', project_id: projectId ?? null, url: pageUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Normalize worker collaborators into the stored shape and upsert them. Reuses
// the same dedup/service-agency logic as the main ingest path.
export function storeCollaboratorsFromWorker(
  projectId: string,
  collaborators: WorkerCollaborator[],
  now: number = Math.floor(Date.now() / 1000),
): number {
  const ksCollabs: KSCollaborator[] = collaborators
    .filter((c) => c && c.name)
    .map((c) => ({
      name: c.name as string,
      slug: c.slug ?? undefined,
      role: c.role ?? undefined,
      urls: c.profileUrl ? { web: { user: c.profileUrl } } : undefined,
      photo: c.avatarUrl ? { small: c.avatarUrl } : undefined,
    }));
  const normalized = normalizeCollaborators(projectId, { collaborators: ksCollabs } as KSProject, now);
  if (normalized.length) upsertProjectCollaborators(projectId, normalized);
  return normalized.length;
}

export interface WorkerCoreResult {
  url: string;
  ok: boolean;
  state?: string | null;
  backers_count?: number | null;
  pledged?: number | null;
  goal?: number | null;
  currency?: string | null;
  comments_count?: number | null;
  error?: string;
}

// Batch-fetch core live stats for many project URLs in one warm worker session.
export async function fetchCoreBatchViaWorker(pageUrls: string[]): Promise<WorkerCoreResult[]> {
  const base = getWorkerBaseUrl();
  if (!base || !pageUrls.length) return [];
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  try {
    const res = await fetch(`${base}/core`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ urls: pageUrls }),
      signal: AbortSignal.timeout(Math.max(60_000, Math.min(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000), 300_000))),
      cache: 'no-store',
    });
    const text = await res.text();
    if (!res.ok) {
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_core', project_id: null, url: pageUrls[0],
        status_code: res.status, message: `Worker /core HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
      return [];
    }
    const data = JSON.parse(text) as { ok?: boolean; results?: WorkerCoreResult[]; error?: string };
    if (!data.ok || !Array.isArray(data.results)) {
      recordCrawlerError({
        source: 'ks_project', job_type: 'worker_core', project_id: null, url: pageUrls[0],
        message: `Worker /core not ok. error=${data.error ?? ''}`,
      });
      return [];
    }
    return data.results;
  } catch (err) {
    recordCrawlerError({
      source: 'ks_project', job_type: 'worker_core', project_id: null, url: pageUrls[0],
      message: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Persist a single /core batch result for a project. This is the cheap,
 * high-frequency funding refresh: it updates pledged/backers/state and writes a
 * snapshot, but does NOT touch rewards/creator (those come from the rich
 * /project pass). Returns true on success, false (and records a failure) on a
 * not-ok result so the tracker can back off.
 */
export async function storeWorkerCoreResult(projectId: string, result: WorkerCoreResult): Promise<boolean> {
  if (!result || !result.ok) {
    recordScrapeFailure(projectId);
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  const existing = await getProjectById(projectId) as {
    state?: string | null;
    deadline?: number | null;
    goal?: number | null;
    currency?: string | null;
    usd_pledged?: number;
    backers_count?: number;
  } | null;

  const currency = result.currency ?? existing?.currency ?? null;
  const pledgedLocal = Number(result.pledged ?? 0);
  const goalLocal = Number(result.goal ?? 0);
  const { pledgedUsd, goalUsd } = resolveUsdAmountsShared({
    pledgedLocal: pledgedLocal > 0 ? pledgedLocal : 0,
    goalLocal: goalLocal > 0 ? goalLocal : 0,
    currency,
  });

  const deadline = existing?.deadline ?? null;
  const projectState = resolveProjectState({
    raw: result.state ?? existing?.state,
    deadline,
    goal: goalUsd,
    pledged: pledgedUsd,
    now,
  });

  const latestSnapshot = getSnapshots(projectId).at(-1);
  const baselinePledged = Math.max(Number(existing?.usd_pledged ?? 0), Number(latestSnapshot?.pledged_usd ?? 0));
  const baselineBackers = Math.max(Number(existing?.backers_count ?? 0), Number(latestSnapshot?.backers_count ?? 0));
  const fetchedBackers = Number(result.backers_count ?? 0);
  const safePledgedUsd = pledgedUsd > 0 ? pledgedUsd : baselinePledged;
  const safeBackers = fetchedBackers > 0 ? fetchedBackers : baselineBackers;

  // Guard against a degraded scrape that returns zeros for a project that
  // already has funding/backers — don't overwrite good data with nothing.
  if (pledgedUsd <= 0 && fetchedBackers <= 0 && (baselinePledged > 0 || baselineBackers > 0)) {
    recordScrapeFailure(projectId);
    return false;
  }

  insertSnapshot({
    project_id: projectId,
    captured_at: now,
    pledged_usd: safePledgedUsd,
    backers_count: safeBackers,
    days_to_go: daysToGo(deadline ?? undefined),
    comments_count: result.comments_count ?? 0,
    updates_count: 0,
    state: projectState,
    source: 'ks',
  });

  updateProjectLiveMetadata(projectId, {
    state: projectState,
    goal_usd: goalUsd > 0 ? goalUsd : existing?.goal ?? null,
    pledged_usd: safePledgedUsd > 0 ? safePledgedUsd : null,
    backers_count: safeBackers > 0 ? safeBackers : null,
  });

  markFetched(projectId);
  return true;
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
      // Match the discover-path timeout: Cloudflare's challenge wait alone is
      // ~45s, so a 60s cap aborts before the worker can recover.
      body: JSON.stringify({ url, expect: 'html', timeoutMs: 170_000, settleMs: 1500 }),
      signal: AbortSignal.timeout(Math.max(60_000, Math.min(Number(getOptionalEnv('KICKSTARTER_BROWSER_TIMEOUT_MS') || 180_000), 300_000))),
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

export async function scrapeKSJson(
  jsonUrl: string,
  projectId?: string,
  options: Pick<ScrapeOptions, 'basicOnly' | 'allowBrowserFallback' | 'directTimeoutMs' | 'directAttempts'> = {},
): Promise<KSProject | null> {
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const timeoutMs = options.directTimeoutMs ?? Number(getOptionalEnv('KICKSTARTER_DIRECT_TIMEOUT_MS') || 45_000);
  const attempts = Math.max(1, Math.min(options.directAttempts ?? Number(getOptionalEnv('KICKSTARTER_DIRECT_ATTEMPTS') || 2), 4));
  let lastError: unknown = null;

  // KS-direct primary: the browser worker's /project endpoint is the most
  // reliable + richest source (clears Cloudflare, returns core + per-tier
  // rewards + creator in one call). Prefer it over the increasingly-blocked
  // direct .json / HTML paths. Skip for basicOnly (discover enrich) since
  // /project is heavy. Falls through to the legacy chain if it fails.
  if (
    process.env.KS_DIRECT_PRIMARY === '1' &&
    !options.basicOnly &&
    options.allowBrowserFallback !== false &&
    pageUrl.includes('kickstarter.com/projects/')
  ) {
    const rich = await fetchProjectViaWorker(pageUrl, projectId);
    if (rich) return rich;
    // /project failed (often a 503 when the single-lane worker queue is full).
    // Do NOT fall through to the worker-based /fetch json+html fallbacks — that
    // turns one failed project into three more worker calls and saturates the
    // queue. Disable browser fallback so the remainder only tries direct .json
    // (which doesn't touch the worker) before giving up.
    options = { ...options, allowBrowserFallback: false };
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': pageUrl,
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(timeoutMs),
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
      if (options.allowBrowserFallback === false) return null;
      const browserJson = await fetchViaBrowserProxy(jsonUrl, projectId, { basicOnly: options.basicOnly });
      if (browserJson) return browserJson;
      if (options.basicOnly) return null;
      return fetchProjectViaHtmlProxy(pageUrl, projectId);
    }
    const directProject = unwrapKickstarterProject(JSON.parse(text));
    if (options.basicOnly) return directProject;
    if (!directProject || hasProjectDetails(directProject)) return directProject;

    recordCrawlerError({
      source: 'ks_project',
      job_type: 'direct_json',
      project_id: projectId ?? null,
      url: jsonUrl,
      status_code: res.status,
      message: 'Kickstarter JSON returned only basic project fields; trying browser worker for reward and collaborator details.',
    });
    if (options.allowBrowserFallback === false) return directProject;
    const browserJson = await fetchViaBrowserProxy(jsonUrl, projectId);
    if (browserJson && projectScore(browserJson) > projectScore(directProject)) return browserJson;
    const browserPageProject = await fetchProjectViaHtmlProxy(pageUrl, projectId);
    if (browserPageProject && projectScore(browserPageProject) > projectScore(directProject)) return browserPageProject;
    return directProject;
  } catch (err) {
    lastError = err;
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'direct_json',
      project_id: projectId ?? null,
      url: jsonUrl,
      message: `${err instanceof Error ? err.message : String(err)}${attempt < attempts ? `; retrying ${attempt}/${attempts}` : ''}`,
    });
    if (attempt < attempts) {
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      continue;
    }
    if (options.allowBrowserFallback === false) return null;
    try {
      const browserJson = await fetchViaBrowserProxy(jsonUrl, projectId, { basicOnly: options.basicOnly });
      if (browserJson) return browserJson;
      if (options.basicOnly) return null;
      return fetchProjectViaHtmlProxy(pageUrl, projectId);
    } catch {
      return null;
    }
  }
  }
  if (lastError) return null;
  return null;
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
    return unwrapKickstarterProject(JSON.parse(m[1]));
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
  allowKicktraqSummaryFallback?: boolean;
  basicOnly?: boolean;
  allowBrowserFallback?: boolean;
  allowHtmlFallback?: boolean;
  directTimeoutMs?: number;
  directAttempts?: number;
}

export interface ScrapeResult {
  ok: boolean;
  full: boolean;
  source: 'ks_project_json' | 'ks_html_fallback' | 'kicktraq_summary' | 'failed';
  rewardCount: number;
  collaboratorCount: number;
  message?: string;
}

// Read-only Kickstarter summary for the import preview: fetches + parses the KS
// project JSON via scrapeKSJson WITHOUT writing anything, so the workbench can show
// "current vs incoming" before the user confirms a full (writing) sync.
export async function previewKickstarterSummary(
  jsonUrl: string,
  projectId?: string,
): Promise<{ pledged_usd: number; backers_count: number; goal_usd: number; state: string | null; currency: string | null } | null> {
  const p = await scrapeKSJson(jsonUrl, projectId, {
    allowBrowserFallback: true,
    directTimeoutMs: Number(getOptionalEnv('KICKSTARTER_PREVIEW_TIMEOUT_MS') || 45_000),
    directAttempts: 2,
  });
  if (!p) return null;
  const { pledgedUsd, goalUsd } = resolveUsdAmounts(p);
  const cur = (p as { currency?: unknown }).currency;
  return {
    pledged_usd: Math.max(0, Math.round(pledgedUsd)),
    backers_count: Math.max(0, Number(p.backers_count ?? p.backers ?? p.backer_count ?? 0) || 0),
    goal_usd: Math.max(0, Math.round(goalUsd)),
    state: typeof p.state === 'string' ? p.state : null,
    currency: typeof cur === 'string' ? cur : null,
  };
}

async function scrapeBasicFallback(projectId: string, jsonUrl: string, opts: ScrapeOptions = {}): Promise<ScrapeResult | null> {
  if (opts.allowHtmlFallback !== false && await scrapeKickstarterHtmlFallback(projectId, jsonUrl)) {
    return {
      ok: true,
      full: false,
      source: 'ks_html_fallback',
      rewardCount: 0,
      collaboratorCount: 0,
      message: 'Synced basic Kickstarter page metadata only; full project JSON was unavailable.',
    };
  }

  if (opts.allowKicktraqSummaryFallback === false) return null;

  const ksUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const creatorSlug = extractCreatorSlug(ksUrl);
  const projectSlug = extractProjectSlug(ksUrl);
  if (!creatorSlug || !projectSlug) return null;

  const ktSummary = await scrapeKicktraqProjectSummary(creatorSlug, projectSlug);
  if (!ktSummary || (ktSummary.pledged_usd <= 0 && ktSummary.backers_count <= 0)) return null;

  storeKicktraqSummary(projectId, ktSummary);
  return {
    ok: true,
    full: false,
    source: 'kicktraq_summary',
    rewardCount: 0,
    collaboratorCount: 0,
    message: 'Synced live funding basics from Kicktraq; rewards and collaborators require Kickstarter detail JSON.',
  };
}

function shouldSkipKsDirectScrape(opts: ScrapeOptions): boolean {
  // Manual user-triggered refreshes always try KS direct first.
  if (opts.manual) return false;
  // KS-direct primary mode: never short-circuit to Kicktraq; the worker
  // /project path (in scrapeKSJson) is the intended source.
  if (process.env.KS_DIRECT_PRIMARY === '1') return false;
  // Default ON: per-project tracker scrapes go straight to the Kicktraq summary
  // and never touch the browser worker. There is a SINGLE browser worker and
  // letting the tracker fire a KS-direct browser fetch for every due project
  // saturates its queue (observed 3-5 requests queued continuously), which
  // starves the low-frequency KS Live *discover* enrich and the startup
  // warm-up. The discover path (runKickstarterLiveSync, gated by
  // LIVE_DISCOVERY_KS_DIRECT) still uses the worker — that's the intended,
  // bounded consumer. Opt back into per-project KS-direct with
  // SKIP_KS_DIRECT_SCRAPE=0 once the worker has spare capacity.
  return process.env.SKIP_KS_DIRECT_SCRAPE !== '0';
}

export async function scrapeAndStore(projectId: string, jsonUrl: string, opts: ScrapeOptions = {}): Promise<ScrapeResult> {
  // When KS direct paths are known to be Cloudflare-blocked, skip the long
  // KS JSON / HTML fetch attempts (each can stall 18-60s while Cloudflare
  // serves a challenge page) and go straight to the Kicktraq summary path.
  if (shouldSkipKsDirectScrape(opts)) {
    const fallback = await scrapeBasicFallback(projectId, jsonUrl, {
      ...opts,
      allowHtmlFallback: false,
    });
    if (fallback) return fallback;
    return {
      ok: false,
      full: false,
      source: 'failed',
      rewardCount: 0,
      collaboratorCount: 0,
      message: 'Kickstarter project sync failed (KS direct skipped, Kicktraq summary unavailable).',
    };
  }

  const p = await scrapeKSJson(jsonUrl, projectId, opts);
  if (!p) {
    const fallback = await scrapeBasicFallback(projectId, jsonUrl, opts);
    if (fallback) return fallback;
    return {
      ok: false,
      full: false,
      source: 'failed',
      rewardCount: 0,
      collaboratorCount: 0,
      message: 'Kickstarter project sync failed.',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const { pledgedUsd, goalUsd } = resolveUsdAmounts(p);
  const existing = await getProjectById(projectId) as {
    state?: string | null;
    deadline?: number | null;
    goal?: number | null;
    usd_pledged?: number;
    backers_count?: number;
  } | null;
  const latestSnapshot = getSnapshots(projectId).at(-1);
  const projectState = resolveProjectState({
    raw: p.state ?? existing?.state,
    deadline: p.deadline ?? existing?.deadline ?? null,
    goal: goalUsd,
    pledged: pledgedUsd,
    now,
  });
  const isLive = projectState === 'live';
  const rewards = normalizeRewards(p);
  const collaborators = normalizeCollaborators(projectId, p, now);
  const existingPledged = Number(existing?.usd_pledged ?? 0);
  const existingBackers = Number(existing?.backers_count ?? 0);
  const latestPledged = Number(latestSnapshot?.pledged_usd ?? 0);
  const latestBackers = Number(latestSnapshot?.backers_count ?? 0);
  const baselinePledged = Math.max(existingPledged, latestPledged);
  const baselineBackers = Math.max(existingBackers, latestBackers);
  const fetchedBackers = resolveBackersCount(p);

  if (pledgedUsd <= 0 && fetchedBackers <= 0 && !rewards.length && !collaborators.length && (baselinePledged > 0 || baselineBackers > 0)) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'project_json',
      project_id: projectId,
      url: jsonUrl,
      message: 'Kickstarter project JSON did not include usable funding, backer totals, rewards, or collaborators.',
    });
    const fallback = await scrapeBasicFallback(projectId, jsonUrl, opts);
    if (fallback) return fallback;
    return {
      ok: false,
      full: false,
      source: 'failed',
      rewardCount: 0,
      collaboratorCount: 0,
      message: 'Rejected project JSON because it did not include usable funding or backer totals.',
    };
  }

  const safePledgedUsd = pledgedUsd > 0 ? pledgedUsd : baselinePledged;
  const safeBackers = fetchedBackers > 0 ? fetchedBackers : baselineBackers;
  const safeDeadline = p.deadline ?? existing?.deadline ?? undefined;

  if (isLive || !opts.manual) {
    insertSnapshot({
      project_id: projectId,
      captured_at: now,
      pledged_usd: safePledgedUsd,
      backers_count: safeBackers,
      days_to_go: daysToGo(safeDeadline),
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
    created_at: typeof p.created_at === 'number' ? p.created_at : null,
    launched_at: typeof p.launched_at === 'number' ? p.launched_at : null,
    deadline: typeof p.deadline === 'number' ? p.deadline : null,
    goal_usd: goalUsd > 0 ? goalUsd : existing?.goal ?? null,
    pledged_usd: safePledgedUsd > 0 ? safePledgedUsd : null,
    backers_count: safeBackers > 0 ? safeBackers : null,
    creator_name: p.creator?.name ?? null,
    creator_slug: p.creator?.slug ?? null,
    creator_url: p.creator?.urls?.web?.user ?? (p.creator?.slug ? `https://www.kickstarter.com/profile/${p.creator.slug}` : null),
    image_url: p.photo?.full ?? p.photo?.['1536x864'] ?? p.photo?.['1024x576'] ?? p.photo?.ed ?? p.photo?.med ?? p.photo?.small ?? null,
    image_thumb_url: p.photo?.little ?? p.photo?.thumb ?? p.photo?.small ?? p.photo?.ed ?? p.photo?.med ?? p.photo?.full ?? null,
  });

  if (opts.track_rewards && rewards.length) {
    insertRewardSnapshots(projectId, now, rewards);
  }

  if (collaborators.length) {
    upsertProjectCollaborators(projectId, collaborators);
  }

  if (opts.track_rewards && !rewards.length) {
    recordCrawlerError({
      source: 'ks_project',
      job_type: 'project_details',
      project_id: projectId,
      url: jsonUrl,
      message: 'Kickstarter project JSON did not include reward tiers.',
    });
  }
  if (opts.track_text_diff) {
    if (p.name) insertTextIfChanged(projectId, now, 'name', p.name);
    if (p.blurb) insertTextIfChanged(projectId, now, 'blurb', p.blurb);
  }

  markFetched(projectId);
  const hasRewards = rewards.length > 0;
  const hasCollaborators = collaborators.length > 0;
  return {
    ok: true,
    full: hasRewards && hasCollaborators,
    source: 'ks_project_json',
    rewardCount: rewards.length,
    collaboratorCount: collaborators.length,
    message: rewards.length || collaborators.length
      ? `Synced full Kickstarter project data. rewards=${rewards.length}, collaborators=${collaborators.length}.`
      : 'Synced Kickstarter basic project fields.',
  };
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

// Known facts pulled from Kickstarter, fed into the OCR prompt so the model does
// not have to *guess* the date axis. The launch date pins the first bar; the final
// totals are used only as a sanity bound. This is the single biggest lever on
// Kicktraq OCR accuracy — see scrapeKicktraqViaShuidi / kicktraqChartPrompt.
export type OcrAnchor = {
  launchDate?: string;       // YYYY-MM-DD — the first (leftmost) bar
  endDate?: string;          // YYYY-MM-DD — the last possible bar
  finalPledgedUsd?: number;  // in-campaign cumulative, sanity bound only
  finalBackers?: number;     // in-campaign cumulative, sanity bound only
};

// Build an OcrAnchor from raw project fields (unix seconds + final totals).
export function buildOcrAnchor(input: {
  launchedAt?: number | null;
  deadline?: number | null;
  finalPledgedUsd?: number | null;
  finalBackers?: number | null;
}): OcrAnchor | undefined {
  const toDate = (sec?: number | null) =>
    sec && Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 10) : undefined;
  const anchor: OcrAnchor = {
    launchDate: toDate(input.launchedAt),
    endDate: toDate(input.deadline),
    finalPledgedUsd: input.finalPledgedUsd && input.finalPledgedUsd > 0 ? input.finalPledgedUsd : undefined,
    finalBackers: input.finalBackers && input.finalBackers > 0 ? input.finalBackers : undefined,
  };
  return anchor.launchDate || anchor.endDate || anchor.finalPledgedUsd || anchor.finalBackers ? anchor : undefined;
}

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
  ocrProvider?: 'qwen' | 'anthropic' | 'openai' | 'shuidi'; // #shuidi
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
    ocrElapsedMs?: number;
    perChart?: Record<string, string>;          // raw model text per chart (per-chart OCR)
    barCounts?: Record<string, number | null>;  // bars the model claims to have counted
    xTicks?: Record<string, string[]>;           // x-axis tick labels the model read per chart
    anchor?: OcrAnchor;                           // anchor facts fed to the model
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

// Shared, explicit date-alignment instructions. The three numbered steps mirror how
// a human reads these charts: (1) anchor on the sparse x-axis labels, (2) one bar =
// one consecutive day, (3) each bar's value is printed vertically on the bar.
function dateAlignmentSteps(anchor?: OcrAnchor): string[] {
  const lines = [
    'STEP 1 (dates are ON the image): The printed MM-DD labels on the x-axis are the AUTHORITATIVE source of dates. Read EVERY visible tick label precisely (left to right) and pin each one to the bar directly above it. Note how many bars sit between two consecutive labeled ticks.',
    'STEP 2 (one bar = one day): Each bar is exactly one consecutive calendar day, left to right, with NO skipped days. Fill in the dates of the unlabeled bars by counting one day per bar between the labeled ticks.',
    'STEP 3 (values): Every bar has its value printed VERTICALLY (text rotated 90°) on or just above the bar. Read that printed number for each bar. These are PER-DAY values (the new amount that day), NOT cumulative running totals.',
  ];
  if (anchor?.launchDate) {
    lines.push(
      `CONTEXT (use for the YEAR and as a sanity range ONLY, not as a hard date): this campaign ran from ${anchor.launchDate}` +
      (anchor.endDate ? ` to ${anchor.endDate}` : '') +
      `, so every bar's date falls inside that window and the year is ${anchor.launchDate.slice(0, 4)}. ` +
      'Do NOT force the first bar to the launch date — Kicktraq often starts tracking a few days AFTER launch, so the leftmost bar may be later than the launch date. Always trust the printed x-axis tick labels over this context if they disagree.',
    );
  } else {
    lines.push('Infer the year from the copyright/header text on the image.');
  }
  return lines;
}

// Multi-image prompt (one call, all charts). Used by the qwen/openai/anthropic
// fallbacks. Old output schema (one row per date with all three metrics).
function kicktraqVisionPrompt(mode: 'exact' | 'estimate' = 'exact', anchor?: OcrAnchor) {
  const lines = [
    'You are reading Kicktraq "Per Day" bar-chart images for a Kickstarter project (provided in order: Pledges Per Day, Backers Per Day, Comments Per Day when available). This is a vision chart-extraction task, not plain-text OCR. Do NOT read the cumulative Funding Progress line chart.',
    ...dateAlignmentSteps(anchor),
    'All charts share the SAME date axis, so align them by date.',
    'Normalize money labels such as $6.7m, $469k, $20,249 into numeric USD amounts.',
    'Return ONLY a JSON array. Each item must be {"date":"YYYY-MM-DD","pledged_usd":number,"backers":number,"comments":number}.',
  ];
  if (mode === 'estimate') {
    lines.push('If the tiny vertical labels are unreadable, estimate from bar heights and y-axis ticks; include every visible bar; do not return an empty array when bars are visible; never use zero unless a bar visibly has zero height.');
  } else {
    lines.push('Only include dates where you can read at least one numeric value from a bar. Omit any unreadable field; do not invent zeros. If no bar values are readable, return [].');
  }
  return lines.join(' ');
}

// Single-chart prompt (one call per metric). Lets the model focus on one chart so
// the vertical labels read cleanly; we align the charts by date ourselves afterward.
function kicktraqChartPrompt(metric: 'pledged' | 'backers' | 'comments', anchor?: OcrAnchor, mode: 'exact' | 'estimate' = 'estimate') {
  const label = metric === 'pledged' ? 'Pledges Per Day (daily new USD pledged)'
    : metric === 'backers' ? 'Backers Per Day (daily new backer count)'
    : 'Comments Per Day (daily new comment count)';
  const lines = [
    `You are reading ONE Kicktraq "${label}" bar chart for a Kickstarter campaign. This is a vision chart-extraction task, not plain-text OCR.`,
    ...dateAlignmentSteps(anchor),
  ];
  if (metric === 'pledged') {
    lines.push('Normalize money labels such as $6.7m, $469k, $20,249 into plain integer USD (6700000, 469000, 20249).');
  }
  const finalVal = metric === 'pledged' ? anchor?.finalPledgedUsd : metric === 'backers' ? anchor?.finalBackers : undefined;
  if (finalVal && finalVal > 0) {
    lines.push(`SANITY CHECK only (do NOT force it): the per-day values should sum to roughly ${Math.round(finalVal)}. Use this to catch gross mis-reads, not to fabricate numbers.`);
  }
  lines.push('Return ONLY JSON: {"bar_count": <total bars you counted>, "x_ticks": ["MM-DD", ... the x-axis tick labels you actually read, left to right ...], "rows": [{"date":"YYYY-MM-DD","value": <number>}]} with exactly one entry per bar, in ascending date order.');
  if (mode === 'estimate') {
    lines.push('If a printed label is genuinely illegible, estimate that bar from its height relative to the y-axis ticks rather than dropping it. Never output 0 for a bar that clearly has height.');
  }
  return lines.join(' ');
}

// Parse the single-chart JSON ({bar_count, x_ticks, rows:[{date,value}]} or a bare array).
function singleChartResult(text: string): { barCount: number | null; xTicks: string[]; rows: Array<{ date: string; value: number | string }> } {
  const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const tryParse = (s?: string): unknown => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
  const normRows = (arr: unknown): Array<{ date: string; value: number | string }> =>
    Array.isArray(arr)
      ? arr
          .filter((r): r is { date: string; value?: number | string } => !!r && typeof r === 'object' && typeof (r as { date?: unknown }).date === 'string')
          .map(r => ({ date: r.date, value: (r as { value?: number | string }).value ?? 0 }))
      : [];
  const normTicks = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string').slice(0, 60) : [];

  const obj = tryParse(cleaned.match(/\{[\s\S]*\}/)?.[0]) as { bar_count?: unknown; x_ticks?: unknown; rows?: unknown } | null;
  if (obj && Array.isArray(obj.rows)) {
    return {
      barCount: Number.isFinite(Number(obj.bar_count)) ? Number(obj.bar_count) : null,
      xTicks: normTicks(obj.x_ticks),
      rows: normRows(obj.rows),
    };
  }
  const arr = tryParse(cleaned.match(/\[[\s\S]*\]/)?.[0]);
  if (Array.isArray(arr)) return { barCount: null, xTicks: [], rows: normRows(arr) };
  return { barCount: null, xTicks: [], rows: [] };
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
  // We OCR pledges/backers/comments by default so the daily curve is complete.
  // The comments image adds vision workload (~1.5x), so set KICKTRAQ_OCR_COMMENTS=0
  // to skip it and only OCR the pledges/backers charts.
  const includeComments = getOptionalEnv('KICKTRAQ_OCR_COMMENTS') !== '0';
  const specs: Array<{ kind: KicktraqChartImage['kind']; file: string }> = [
    { kind: 'pledges', file: 'dailypledges.png' },
    { kind: 'backers', file: 'dailybackers.png' },
    ...(includeComments ? [{ kind: 'comments' as const, file: 'dailycomments.png' }] : []),
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

export async function scrapeKicktraqDetailed(creatorSlug: string, projectSlug: string, anchor?: OcrAnchor): Promise<{ days: KicktraqDay[]; diagnostics: KicktraqScrapeDiagnostics }> {
  const pageUrl = 'https://www.kicktraq.com/projects/' + creatorSlug + '/' + projectSlug + '/';
  const diagnostics: KicktraqScrapeDiagnostics = {};
  if (anchor && diagnostics.debug !== undefined) diagnostics.debug.anchor = anchor;
  else if (anchor) diagnostics.debug = { anchor };

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
  // #shuidi — preferred provider: Claude via Shuidi's OpenAI-compatible relay.
  if (getOptionalEnv('SHUIDI_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaShuidi(pageUrl, cookieStr, diagnostics, anchor);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  if (getOptionalEnv('QWEN_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaQwen(pageUrl, cookieStr, diagnostics, anchor);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  if (getOptionalEnv('OPENAI_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaOpenAI(pageUrl, cookieStr, diagnostics, anchor);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  if (getOptionalEnv('ANTHROPIC_API_KEY')) {
    const ocrDays = await scrapeKicktraqViaOCR(pageUrl, cookieStr, diagnostics, anchor);
    if (ocrDays.length) return { days: ocrDays, diagnostics };
  }

  return { days: [], diagnostics: { ...diagnostics, reason: 'No daily rows were found in JSON, HTML, or OCR output.' } };
}

export async function scrapeKicktraq(creatorSlug: string, projectSlug: string): Promise<KicktraqDay[]> {
  return (await scrapeKicktraqDetailed(creatorSlug, projectSlug)).days;
}

export interface KicktraqPreviewResult {
  summary: KicktraqSummary | null;
  days: KicktraqDay[];
  diagnostics: KicktraqScrapeDiagnostics;
}

/**
 * Read-only Kicktraq fetch used by the data-quality workbench preview step.
 * Pulls the textual summary layer (HTML, reliable) and the daily curve layer
 * (JSON/HTML/OCR, best-effort) WITHOUT writing anything to the database.
 * Committing is a separate, user-confirmed step (storeKicktraqSummary /
 * storeKicktraqDays). Kept isolated from the KS Live discovery pipeline.
 */
export async function previewKicktraqImport(creatorSlug: string, projectSlug: string): Promise<KicktraqPreviewResult> {
  // The two layers are fetched independently and each is allowed to fail on its own:
  // the reliable summary layer must still surface even if the best-effort daily/OCR
  // scrape throws, so the preview modal never collapses to a bare error.
  let summary: KicktraqSummary | null = null;
  try {
    summary = await scrapeKicktraqProjectSummary(creatorSlug, projectSlug);
  } catch {
    summary = null;
  }

  let days: KicktraqDay[] = [];
  let diagnostics: KicktraqScrapeDiagnostics = {};
  try {
    const detailed = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    days = detailed.days;
    diagnostics = detailed.diagnostics;
  } catch (e) {
    diagnostics = { reason: `Daily scrape failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` };
  }

  return { summary, days, diagnostics };
}

// ─── OCR fallback via Claude Vision ──────────────────────────────────────────

async function scrapeKicktraqViaOCR(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics, anchor?: OcrAnchor): Promise<KicktraqDay[]> {
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

    const ocrPrompt = kicktraqVisionPrompt('exact', anchor);

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

// #shuidi — OCR via Claude (claude-sonnet-4.6) behind Shuidi's OpenAI-compatible
// relay. Same chat/completions + image_url shape as the Qwen path, but the relay
// additionally requires the X-WP-Title header. Key/model/base are env-driven
// (SHUIDI_API_KEY is the only required one); never hardcode the key in source.
async function scrapeKicktraqViaShuidi(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics, anchor?: OcrAnchor): Promise<KicktraqDay[]> {
  const apiKey = getOptionalEnv('SHUIDI_API_KEY');
  const model = getOptionalEnv('SHUIDI_VISION_MODEL') || 'claude-sonnet-4.6-wangsu';
  const baseUrl = (getOptionalEnv('SHUIDI_BASE_URL') || 'https://agent-api.shuiditech.com/api/v1').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/chat/completions`;
  const wpTitle = getOptionalEnv('SHUIDI_WP_TITLE') || 'kicksonar';
  const timeoutMs = Math.max(60_000, Number(getOptionalEnv('SHUIDI_TIMEOUT_MS') || 120_000));
  if (diagnostics) {
    diagnostics.ocrProvider = 'shuidi';
    diagnostics.ocrEndpoint = endpoint;
    diagnostics.ocrTimeoutMs = timeoutMs;
  }

  // One image -> one model call, with retry on transient errors / 429. #shuidi relay
  // requires the X-WP-Title header.
  const callOnce = async (prompt: string, base64: string): Promise<{ ok: boolean; status: number; text: string }> => {
    const body = JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 8192,
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
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'X-WP-Title': wpTitle, // #shuidi — relay requires this header
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
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
    if (!res.ok) { const t = await res.text().catch(() => ''); return { ok: false, status: res.status, text: t }; }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { ok: true, status: res.status, text: data.choices?.[0]?.message?.content ?? '' };
  };

  try {
    const images = await fetchKicktraqDailyImages(pageUrl, cookieStr, diagnostics);
    if (!images.length) return [];

    // P1: OCR each chart in its own call so the model can focus on a single set of
    // vertical bar labels, then align the charts by date ourselves (the launch-date
    // anchor keeps every chart on the same calendar). This avoids the cross-chart
    // date drift that happens when one call has to juggle all three images at once.
    const results = await Promise.all(images.map(async (image) => {
      const metric = image.kind === 'pledges' ? 'pledged' as const : image.kind === 'backers' ? 'backers' as const : 'comments' as const;
      try {
        const r = await callOnce(kicktraqChartPrompt(metric, anchor, 'estimate'), image.base64);
        return { image, metric, ...r };
      } catch (e) {
        return { image, metric, ok: false, status: 0, text: String(e) };
      }
    }));

    const byDate = new Map<string, KicktraqDay>();
    const perChart: Record<string, string> = {};
    const barCounts: Record<string, number | null> = {};
    const xTicks: Record<string, string[]> = {};
    let lastStatus = 0;
    let anyOk = false;
    let lastError = '';

    for (const { image, metric, ok, status, text } of results) {
      lastStatus = status || lastStatus;
      perChart[image.kind] = text.slice(0, 500);
      if (!ok) { lastError = extractOpenAIErrorMessage(text) || lastError; continue; }
      anyOk = true;
      const parsed = singleChartResult(text);
      barCounts[image.kind] = parsed.barCount;
      xTicks[image.kind] = parsed.xTicks;
      for (const row of parsed.rows) {
        const date = normalizeDate(row.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        const entry = byDate.get(date) ?? { date, pledged_usd: 0, backers: 0, comments: 0 };
        const val = parseOcrNumber(row.value, metric !== 'pledged');
        if (metric === 'pledged') entry.pledged_usd = val;
        else if (metric === 'backers') entry.backers = val;
        else entry.comments = val;
        byDate.set(date, entry);
      }
    }

    const ocrRows: KicktraqOcrRow[] = [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({ date: d.date, pledged_usd: d.pledged_usd, backers: d.backers, comments: d.comments }));

    if (diagnostics) {
      diagnostics.ocrStatus = lastStatus;
      diagnostics.ocrRows = ocrRows.length;
      diagnostics.debug = { ...(diagnostics.debug ?? {}), perChart, barCounts, xTicks };
      if (!anyOk) diagnostics.ocrError = lastError || 'Shuidi OCR returned no usable response.';
    }
    return usableKicktraqDays(ocrRows, diagnostics);
  } catch (e) {
    console.log('[Shuidi OCR] exception: ' + String(e));
    if (diagnostics) diagnostics.ocrError = String(e);
    return [];
  }
}

async function scrapeKicktraqViaQwen(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics, anchor?: OcrAnchor): Promise<KicktraqDay[]> {
  const qwenKey = getOptionalEnv('QWEN_API_KEY');
  const qwenModel = getOptionalEnv('QWEN_VISION_MODEL') || 'qwen-vl-plus';
  const qwenBaseUrl = (getOptionalEnv('QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
  const qwenEndpoint = `${qwenBaseUrl}/chat/completions`;
  const qwenTimeoutMs = Math.max(30_000, Number(getOptionalEnv('QWEN_TIMEOUT_MS') || 110_000));
  const qwenStartedAt = Date.now();
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
        max_tokens: 4096,
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
      // Only 2 attempts, and never retry a timeout: a single Qwen call that already
      // blew past the timeout will only blow past it again, so retrying just makes the
      // whole request hang well past the client's abort window. Retry only transient
      // network errors and 429s.
      for (let attempt = 0; attempt < 2; attempt++) {
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
          const name = e instanceof Error ? e.name : '';
          const isTimeout = name === 'TimeoutError' || name === 'AbortError';
          if (attempt === 1 || isTimeout) throw e;
          await sleep(1500 * (attempt + 1));
          continue;
        }
        if (res.status !== 429 || attempt === 1) break;
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

    const result = await callQwen(kicktraqVisionPrompt('estimate', anchor));
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
    const elapsedMs = Date.now() - qwenStartedAt;
    console.log('[Qwen OCR] completed in ' + elapsedMs + 'ms, status=' + result.status + ', rows=' + estimatedRows.length);
    if (diagnostics) {
      diagnostics.ocrStatus = result.status;
      diagnostics.ocrPreview = result.text.slice(0, 200);
      diagnostics.debug = { ...(diagnostics.debug ?? {}), modelOutput: result.text, ocrElapsedMs: elapsedMs };
      diagnostics.ocrFallbackRows = estimatedRows.length;
      diagnostics.ocrRows = estimatedRows.length;
      if (estimatedRows.length === 0) {
        diagnostics.ocrError = `Qwen returned status ${result.status} in ${Math.round(elapsedMs / 1000)}s but no parseable rows.`;
      }
    }
    const days = usableKicktraqDays(estimatedRows, diagnostics);
    if (diagnostics) diagnostics.debug = { ...(diagnostics.debug ?? {}), structuredRows: days };
    return days;
  } catch (e) {
    const elapsedMs = Date.now() - qwenStartedAt;
    const name = e instanceof Error ? e.name : '';
    const isTimeout = name === 'TimeoutError' || name === 'AbortError';
    console.log('[Qwen OCR] exception after ' + elapsedMs + 'ms: ' + String(e));
    if (diagnostics) {
      diagnostics.ocrError = `${String(e)} (after ${Math.round(elapsedMs / 1000)}s)`;
      diagnostics.reason = isTimeout
        ? `Qwen OCR timed out after ${Math.round(elapsedMs / 1000)}s (limit ${Math.round(qwenTimeoutMs / 1000)}s). The DashScope endpoint may be slow/blocked from this server region — try QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1 or an OpenAI key.`
        : `Qwen OCR request failed before receiving an HTTP response (after ${Math.round(elapsedMs / 1000)}s).`;
    }
    return [];
  }
}

async function scrapeKicktraqViaOpenAI(pageUrl: string, cookieStr: string, diagnostics?: KicktraqScrapeDiagnostics, anchor?: OcrAnchor): Promise<KicktraqDay[]> {
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
    const prompt = kicktraqVisionPrompt('exact', anchor);

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
    if (Number.isNaN(start.getTime())) return days;
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
      if (Number.isNaN(start.getTime())) return days;
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

export function storeKicktraqDays(
  projectId: string,
  days: KicktraqDay[],
  opts?: { mode?: 'overwrite' | 'merge' },
): KicktraqWrittenSnapshot[] {
  // mode='overwrite' (default, legacy behaviour): wipe existing kicktraq snapshots then
  // re-insert the full curve. mode='merge': keep existing rows and only fill in dates that
  // are not already stored (insertSnapshot uses INSERT OR IGNORE on the unique date key).
  const mode = opts?.mode ?? 'overwrite';
  const validDays = days
    .filter(d => d.pledged_usd > 0 || d.backers > 0 || (d.comments ?? 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!validDays.length) return [];

  if (mode === 'overwrite') deleteKicktraqSnapshots(projectId);

  let pledgedTotal = 0;
  let backersTotal = 0;
  let commentsTotal = 0;
  const written: KicktraqWrittenSnapshot[] = [];

  const nowSec = Math.floor(Date.now() / 1000);
  for (const d of validDays) {
    pledgedTotal += d.pledged_usd;
    backersTotal += d.backers;
    commentsTotal += d.comments ?? 0;
    const capturedAt = Math.floor(new Date(d.date + 'T12:00:00Z').getTime() / 1000);
    // Kicktraq charts can include campaign days that haven't happened yet
    // (up to the deadline). Never record a "history" point in the future.
    if (!Number.isFinite(capturedAt) || capturedAt > nowSec) continue;
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
