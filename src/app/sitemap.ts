import type { MetadataRoute } from 'next';
import {
  getIndexableProjectCount,
  getIndexableProjectsPage,
  getCategoryList,
  getCountryList,
  getMaxProjectTimestamp,
} from '@/lib/db';
import { absoluteUrl, slugify } from '@/lib/seo';

// Read from SQLite per-request; never prerender at build time.
export const dynamic = 'force-dynamic';

// Stay well under the 50k-URL / 50MB per-sitemap limit.
export const SITEMAP_CHUNK = 45_000;
const CHUNK = SITEMAP_CHUNK;

const STATIC_ROUTES = [
  '/',
  '/about',
  '/projects',
  '/leaderboard',
  '/awards',
  '/live-intel',
  '/analysis',
  '/predict',
  '/trends',
  '/countries',
  '/categories',
  '/trust',
] as const;

// Sitemap id 0 = static + category/country insight pages; ids 1..N = project chunks.
export async function generateSitemaps(): Promise<{ id: number }[]> {
  let chunks = 0;
  try {
    chunks = Math.ceil(getIndexableProjectCount() / CHUNK);
  } catch {
    chunks = 0;
  }
  return Array.from({ length: chunks + 1 }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // Next passes the route segment, so `id` arrives as a string at runtime.
  const n = Number(id) || 0;
  if (n === 0) {
    const lastModified = await safeMaxTimestamp();
    const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
      url: absoluteUrl(path),
      lastModified,
      changeFrequency: 'daily',
    }));

    try {
      const categories = await getCategoryList();
      for (const c of categories) {
        entries.push({
          url: absoluteUrl(`/categories/${slugify(c)}`),
          lastModified,
          changeFrequency: 'weekly',
        });
      }
    } catch {}

    try {
      const countries = await getCountryList();
      for (const c of countries) {
        entries.push({
          url: absoluteUrl(`/countries/${c.country.toLowerCase()}`),
          lastModified,
          changeFrequency: 'weekly',
        });
      }
    } catch {}

    return entries;
  }

  // Project detail chunk.
  try {
    const offset = (n - 1) * CHUNK;
    const rows = getIndexableProjectsPage(CHUNK, offset);
    return rows.map((r) => ({
      url: absoluteUrl(`/projects/${r.id}`),
      lastModified: r.lastmod ? new Date(r.lastmod * 1000) : undefined,
      changeFrequency: 'weekly',
    }));
  } catch {
    return [];
  }
}

async function safeMaxTimestamp(): Promise<Date | undefined> {
  try {
    const ts = getMaxProjectTimestamp();
    return ts ? new Date(ts * 1000) : undefined;
  } catch {
    return undefined;
  }
}
