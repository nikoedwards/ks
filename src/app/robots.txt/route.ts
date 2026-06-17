const SITE_URL = 'https://kicksonar.com';
const INDEXNOW_KEY = '8b7f1f0d4c2a4e7f9d6c3b2a1e0f5d8c';

export const dynamic = 'force-static';

export function GET() {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /admin',
    'Disallow: /data-quality',
    'Disallow: /favorites',
    '',
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    `Host: ${SITE_URL}`,
    `# IndexNow: ${SITE_URL}/${INDEXNOW_KEY}.txt`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
