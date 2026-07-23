export type CoreProjectRow = Record<string, unknown>;

export interface CoreSeoSegmentStats {
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  avg_pledged: number;
  total_pledged_m: number;
  total_backers: number;
}

export interface CoreSeoFundingStats {
  median_pledged_successful: number;
  avg_pledged_successful: number;
  successful_with_pledge: number;
}

export interface CoreSeoTopProject {
  id: string;
  name: string;
  blurb: string | null;
  state: string;
  usd_pledged: number;
  backers_count: number;
  goal: number;
  slug: string | null;
  creator_name: string | null;
  category_name: string | null;
  country_name: string | null;
  launched_at: number | null;
}

export interface CoreCategorySeo {
  category: string;
  stats: CoreSeoSegmentStats;
  funding: CoreSeoFundingStats | null;
  overall: number;
  top: CoreSeoTopProject[];
  others: string[];
  maxProjectTimestamp: number | null;
}

export interface CoreCountrySeo {
  code: string;
  name: string;
  stats: CoreSeoSegmentStats;
  funding: CoreSeoFundingStats | null;
  overall: number;
  top: CoreSeoTopProject[];
  others: { country: string; country_name: string }[];
  maxProjectTimestamp: number | null;
}

export interface CoreSitemapMeta {
  projectCount: number;
  maxProjectTimestamp: number | null;
  categories: string[];
  countries: { country: string; country_name: string }[];
}

export interface CoreSitemapProject {
  id: string;
  lastmod: number | null;
}

function coreBaseUrl(): string {
  const raw = process.env.KICKSONAR_CORE_BASE_URL?.trim();
  if (!raw) throw new Error('KICKSONAR_CORE_BASE_URL is not configured');
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('KICKSONAR_CORE_BASE_URL must use http or https');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function fetchCoreJson<T>(path: string, timeoutMs = 20_000): Promise<T | null> {
  const response = await fetch(`${coreBaseUrl()}${path}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Core request failed (${response.status}) for ${path}`);
  return response.json() as Promise<T>;
}

export async function loadCoreSeoProject(id: string): Promise<CoreProjectRow | null> {
  const data = await fetchCoreJson<{ project: CoreProjectRow }>(
    `/api/v1/public/seo/projects/${encodeURIComponent(id)}`,
  );
  return data?.project ?? null;
}

export function loadCoreCategorySeo(slug: string): Promise<CoreCategorySeo | null> {
  return fetchCoreJson<CoreCategorySeo>(
    `/api/v1/public/seo/categories/${encodeURIComponent(slug)}`,
  );
}

export function loadCoreCountrySeo(slug: string): Promise<CoreCountrySeo | null> {
  return fetchCoreJson<CoreCountrySeo>(
    `/api/v1/public/seo/countries/${encodeURIComponent(slug)}`,
  );
}

export function loadCoreSitemapMeta(): Promise<CoreSitemapMeta | null> {
  return fetchCoreJson<CoreSitemapMeta>('/api/v1/public/seo/sitemap');
}

export async function loadCoreSitemapProjects(
  limit: number,
  offset: number,
): Promise<CoreSitemapProject[]> {
  const data = await fetchCoreJson<{ rows: CoreSitemapProject[] }>(
    `/api/v1/public/seo/sitemap?limit=${limit}&offset=${offset}`,
    60_000,
  );
  return data?.rows ?? [];
}
