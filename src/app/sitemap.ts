import type { MetadataRoute } from 'next';

const SITE_URL = 'https://kicksonar.com';

const routes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/dashboard', changeFrequency: 'daily', priority: 0.8 },
  { path: '/projects', changeFrequency: 'daily', priority: 0.9 },
  { path: '/leaderboard', changeFrequency: 'daily', priority: 0.8 },
  { path: '/awards', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/live-intel', changeFrequency: 'daily', priority: 0.9 },
  { path: '/analysis', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/predict', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/trends', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/countries', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/categories', changeFrequency: 'weekly', priority: 0.7 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return routes.map((route) => ({
    url: `${SITE_URL}${route.path === '/' ? '' : route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
