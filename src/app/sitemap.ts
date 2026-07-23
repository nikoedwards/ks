import type { MetadataRoute } from 'next';
import {
  loadCoreSitemapMeta,
  loadCoreSitemapProjects,
} from '@/lib/coreSeo';
import { absoluteUrl, slugify } from '@/lib/seo';

// Read from Core per-request; never resolve private networking at build time.
export const dynamic = 'force-dynamic';

// Stay well under the 50k-URL / 50MB per-sitemap limit.
export const SITEMAP_CHUNK = 45_000;
const CHUNK = SITEMAP_CHUNK;
const MAX_PROJECT_SITEMAP_CHUNKS = 100;

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
  // Railway private DNS is unavailable during image builds. Pre-register a
  // generous fixed route range, while sitemap_index.xml references only the
  // chunks that Core reports at runtime.
  return Array.from({ length: MAX_PROJECT_SITEMAP_CHUNKS + 1 }, (_, i) => ({ id: i }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  // Next passes the route segment, so `id` arrives as a string at runtime.
  const n = Number(id) || 0;
  if (n === 0) {
    let meta = null;
    try {
      meta = await loadCoreSitemapMeta();
    } catch {}
    const lastModified = meta?.maxProjectTimestamp
      ? new Date(meta.maxProjectTimestamp * 1000)
      : undefined;
    const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
      url: absoluteUrl(path),
      lastModified,
      changeFrequency: 'daily',
    }));

    if (meta) {
      for (const c of meta.categories) {
        entries.push({
          url: absoluteUrl(`/categories/${slugify(c)}`),
          lastModified,
          changeFrequency: 'weekly',
        });
      }

      for (const c of meta.countries) {
        entries.push({
          url: absoluteUrl(`/countries/${c.country.toLowerCase()}`),
          lastModified,
          changeFrequency: 'weekly',
        });
      }
    }

    return entries;
  }

  // Project detail chunk.
  try {
    const offset = (n - 1) * CHUNK;
    const rows = await loadCoreSitemapProjects(CHUNK, offset);
    return rows.map((r) => ({
      url: absoluteUrl(`/projects/${r.id}`),
      lastModified: r.lastmod ? new Date(r.lastmod * 1000) : undefined,
      changeFrequency: 'weekly',
    }));
  } catch {
    return [];
  }
}
