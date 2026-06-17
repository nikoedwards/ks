import type { MetadataRoute } from 'next';

const SITE_URL = 'https://kicksonar.com';

const routes = [
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
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
  }));
}
