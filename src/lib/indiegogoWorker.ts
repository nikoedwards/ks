// Client for the isolated Indiegogo Cloudflare-bypass worker(s).
//
// Two roles are deployed as separate instances so the two enumeration pipelines
// never share a single serial browser lane:
//   - 'live' : real-time discovery of new/active projects (must not be missed).
//   - 'bulk' : the backlog catalog sweep (large, resumable, can be restarted).
//
// Each role's env may be a comma-separated list (a fleet); calls route to the
// healthiest base with a lightweight circuit breaker, mirroring workerGate.

export type IndiegogoWorkerRole = 'live' | 'bulk';

export interface IndiegogoSearchParams {
  pageIndex?: number;
  sortType?: number;
  projectPhaseSearchTypes?: number[];
  projectCatalogCategories?: string[];
  projectTags?: number[];
  term?: string;
}

export interface IndiegogoSearchCard {
  projectID?: number | string;
  projectUrlName?: string | null;
  name?: string | null;
  shortDescription?: string | null;
  campaignGoal?: number | null;
  fundsGathered?: number | null;
  backersCount?: number | null;
  followerCount?: number | null;
  campaignStart?: string | null;
  campaignEnd?: string | null;
  campaignOutcome?: number | null;
  phase?: number | null;
  phaseLabel?: string | null;
  type?: number | null;
  originalType?: number | null;
  currencySymbol?: string | null;
  imageUrl?: string | null;
  url?: string | null;
  relativeUrl?: string | null;
  catalogCategory?: { projectCategory?: number; name?: string | null; url?: string | null } | null;
  creator?: { creatorID?: number; name?: string | null; urlName?: string | null; homeUrl?: string | null } | null;
  projectTags?: Array<{ projectTagID?: number; name?: string | null; urlName?: string | null }> | null;
}

export interface IndiegogoSearchResult {
  ok: boolean;
  cleared: boolean;
  status?: number;
  pageIndex?: number;
  total?: number;
  totalPages?: number;
  pageSize?: number;
  capped?: boolean;
  count?: number;
  items?: IndiegogoSearchCard[];
  error?: string;
}

const SEARCH_TIMEOUT_MS = Math.max(10_000, Number(process.env.INDIEGOGO_WORKER_TIMEOUT_MS ?? 60_000));
const BREAKER_FAILS = Math.max(1, Number(process.env.INDIEGOGO_WORKER_BREAKER_FAILS ?? 3));
const BREAKER_COOLDOWN_MS = Math.max(5_000, Number(process.env.INDIEGOGO_WORKER_BREAKER_COOLDOWN_MS ?? 60_000));

function stripEndpoint(u: string): string {
  return u.replace(/\/(search|health)\/?$/i, '').replace(/\/+$/, '');
}

function envRaw(name: string): string {
  return process.env[name]?.trim() ?? '';
}

export function getIndiegogoWorkerBases(role: IndiegogoWorkerRole): string[] {
  const raw =
    role === 'bulk'
      ? envRaw('INDIEGOGO_BULK_WORKER_URL') || envRaw('INDIEGOGO_LIVE_WORKER_URL')
      : envRaw('INDIEGOGO_LIVE_WORKER_URL') || envRaw('INDIEGOGO_BULK_WORKER_URL');
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const base = stripEndpoint(part.trim());
    if (base && !seen.has(base)) {
      seen.add(base);
      out.push(base);
    }
  }
  return out;
}

interface BaseHealth {
  failures: number;
  openUntil: number;
}
const health = new Map<string, BaseHealth>();

function healthOf(base: string): BaseHealth {
  let h = health.get(base);
  if (!h) {
    h = { failures: 0, openUntil: 0 };
    health.set(base, h);
  }
  return h;
}

function reportOutcome(base: string, ok: boolean) {
  const h = healthOf(base);
  if (ok) {
    h.failures = 0;
    h.openUntil = 0;
  } else {
    h.failures += 1;
    if (h.failures >= BREAKER_FAILS) h.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
  }
}

function pickBase(role: IndiegogoWorkerRole): string | null {
  const bases = getIndiegogoWorkerBases(role);
  if (!bases.length) return null;
  const now = Date.now();
  const healthy = bases.filter(b => healthOf(b).openUntil <= now);
  if (healthy.length) {
    healthy.sort((a, b) => healthOf(a).failures - healthOf(b).failures);
    return healthy[0];
  }
  return [...bases].sort((a, b) => healthOf(a).openUntil - healthOf(b).openUntil)[0];
}

function authHeader(): Record<string, string> {
  const token = envRaw('INDIEGOGO_WORKER_TOKEN') || envRaw('BROWSER_WORKER_TOKEN');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function indiegogoWorkerConfigured(role: IndiegogoWorkerRole): boolean {
  return getIndiegogoWorkerBases(role).length > 0;
}

export async function searchIndiegogoViaWorker(
  role: IndiegogoWorkerRole,
  params: IndiegogoSearchParams,
): Promise<IndiegogoSearchResult> {
  const base = pickBase(role);
  if (!base) return { ok: false, cleared: false, error: `no_indiegogo_${role}_worker_configured` };
  try {
    const res = await fetch(`${base}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      body: JSON.stringify(params),
      cache: 'no-store',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    reportOutcome(base, res.status < 500);
    const json = (await res.json().catch(() => null)) as IndiegogoSearchResult | null;
    if (!json) return { ok: false, cleared: false, status: res.status, error: 'invalid_worker_response' };
    return json;
  } catch (err) {
    reportOutcome(base, false);
    return { ok: false, cleared: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface IndiegogoWorkerHealth {
  role: IndiegogoWorkerRole;
  configured: boolean;
  bases: Array<{
    base: string;
    ok: boolean;
    cleared?: boolean;
    activeFetches?: number;
    queuedFetches?: number;
    breakerOpen: boolean;
    error?: string;
  }>;
}

export async function getIndiegogoWorkerHealth(role: IndiegogoWorkerRole): Promise<IndiegogoWorkerHealth> {
  const bases = getIndiegogoWorkerBases(role);
  const now = Date.now();
  const results = await Promise.all(
    bases.map(async base => {
      const breakerOpen = healthOf(base).openUntil > now;
      try {
        const res = await fetch(`${base}/health`, {
          headers: { Accept: 'application/json', ...authHeader() },
          cache: 'no-store',
          signal: AbortSignal.timeout(8_000),
        });
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        return {
          base,
          ok: res.ok,
          cleared: Boolean(body?.cleared),
          activeFetches: Number(body?.activeFetches ?? 0) || 0,
          queuedFetches: Number(body?.queuedFetches ?? 0) || 0,
          breakerOpen,
        };
      } catch (err) {
        return { base, ok: false, breakerOpen, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
  return { role, configured: bases.length > 0, bases: results };
}
