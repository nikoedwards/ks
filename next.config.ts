import type { NextConfig } from 'next';

type CoreRewrite = {
  source: string;
  destination: string;
};

const PUBLIC_CORE_ROUTES: CoreRewrite[] = [
  { source: '/api/stats', destination: '/api/v1/public/stats' },
  { source: '/api/meta', destination: '/api/v1/public/meta' },
  { source: '/api/categories', destination: '/api/v1/public/categories' },
  { source: '/api/countries', destination: '/api/v1/public/countries' },
  { source: '/api/trends', destination: '/api/v1/public/trends' },
  { source: '/api/leaderboard', destination: '/api/v1/public/leaderboard' },
  { source: '/api/live-intel', destination: '/api/v1/public/live-intel' },
  { source: '/api/awards', destination: '/api/v1/public/awards' },
  { source: '/api/nav', destination: '/api/v1/public/nav' },
  { source: '/api/announcements', destination: '/api/v1/public/announcements' },
  { source: '/api/analysis/time', destination: '/api/v1/public/analysis/time' },
  { source: '/api/predict', destination: '/api/v1/public/predict' },
  { source: '/api/translate', destination: '/api/v1/public/translate' },
  { source: '/api/events', destination: '/api/v1/public/events' },
  { source: '/api/projects', destination: '/api/v1/public/projects' },
  { source: '/api/projects/:path*', destination: '/api/v1/public/projects/:path*' },
  { source: '/api/snapshots/:path*', destination: '/api/v1/public/snapshots/:path*' },
];

const ACCOUNT_CORE_ROUTES: CoreRewrite[] = [
  // Keep this ahead of the public projects wildcard.
  { source: '/api/projects/:id/collaborators', destination: '/api/v1/account/projects/:id/collaborators' },
  { source: '/api/auth/:path*', destination: '/api/v1/account/auth/:path*' },
  { source: '/api/favorites', destination: '/api/v1/account/favorites' },
  { source: '/api/favorites/:path*', destination: '/api/v1/account/favorites/:path*' },
  { source: '/api/keys', destination: '/api/v1/account/keys' },
  { source: '/api/keys/:path*', destination: '/api/v1/account/keys/:path*' },
  { source: '/api/track', destination: '/api/v1/account/track' },
  { source: '/api/track/:path*', destination: '/api/v1/account/track/:path*' },
  { source: '/api/push', destination: '/api/v1/account/push' },
  { source: '/api/kicktraq/:path*', destination: '/api/v1/account/kicktraq/:path*' },
];

function coreProxyRewrites(): CoreRewrite[] {
  if (process.env.KICKSONAR_CORE_PROXY_ENABLED !== '1') return [];

  const rawBaseUrl = process.env.KICKSONAR_CORE_BASE_URL?.trim();
  if (!rawBaseUrl) {
    throw new Error('KICKSONAR_CORE_BASE_URL is required when KICKSONAR_CORE_PROXY_ENABLED=1');
  }

  const parsed = new URL(rawBaseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('KICKSONAR_CORE_BASE_URL must use http or https');
  }
  const baseUrl = parsed.toString().replace(/\/$/, '');

  const groups = new Set(
    (process.env.KICKSONAR_CORE_PROXY_GROUPS ?? 'public')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const unknownGroups = [...groups].filter((group) => group !== 'public' && group !== 'account');
  if (unknownGroups.length) {
    throw new Error(`Unsupported KICKSONAR_CORE_PROXY_GROUPS: ${unknownGroups.join(', ')}`);
  }

  const selected = [
    ...(groups.has('account') ? ACCOUNT_CORE_ROUTES : []),
    ...(groups.has('public') ? PUBLIC_CORE_ROUTES : []),
  ];

  return selected.map((route) => ({
    source: route.source,
    destination: `${baseUrl}${route.destination}`,
  }));
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3', 'unzipper', 'csv-parse', 'node-cron'],
  async rewrites() {
    return {
      beforeFiles: coreProxyRewrites(),
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    const contentSecurityPolicy = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
