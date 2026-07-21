export type CoreProxyGroup = 'public' | 'account';

export type CoreProxyMatch = {
  group: CoreProxyGroup;
  corePath: string;
};

const STAGING_WEB_HOSTS = new Set([
  'kicksonar-web-staging-production.up.railway.app',
]);

const PUBLIC_EXACT = new Map<string, string>([
  ['/api/stats', '/api/v1/public/stats'],
  ['/api/meta', '/api/v1/public/meta'],
  ['/api/categories', '/api/v1/public/categories'],
  ['/api/countries', '/api/v1/public/countries'],
  ['/api/trends', '/api/v1/public/trends'],
  ['/api/leaderboard', '/api/v1/public/leaderboard'],
  ['/api/live-intel', '/api/v1/public/live-intel'],
  ['/api/awards', '/api/v1/public/awards'],
  ['/api/nav', '/api/v1/public/nav'],
  ['/api/announcements', '/api/v1/public/announcements'],
  ['/api/analysis/time', '/api/v1/public/analysis/time'],
  ['/api/predict', '/api/v1/public/predict'],
  ['/api/translate', '/api/v1/public/translate'],
  ['/api/events', '/api/v1/public/events'],
  ['/api/projects', '/api/v1/public/projects'],
]);

const ACCOUNT_EXACT = new Map<string, string>([
  ['/api/favorites', '/api/v1/account/favorites'],
  ['/api/keys', '/api/v1/account/keys'],
  ['/api/track', '/api/v1/account/track'],
  ['/api/push', '/api/v1/account/push'],
]);

const PREFIX_ROUTES: Array<{
  group: CoreProxyGroup;
  source: string;
  destination: string;
}> = [
  { group: 'account', source: '/api/auth/', destination: '/api/v1/account/auth/' },
  { group: 'account', source: '/api/favorites/', destination: '/api/v1/account/favorites/' },
  { group: 'account', source: '/api/keys/', destination: '/api/v1/account/keys/' },
  { group: 'account', source: '/api/track/', destination: '/api/v1/account/track/' },
  { group: 'account', source: '/api/kicktraq/', destination: '/api/v1/account/kicktraq/' },
  { group: 'public', source: '/api/projects/', destination: '/api/v1/public/projects/' },
  { group: 'public', source: '/api/snapshots/', destination: '/api/v1/public/snapshots/' },
];

export function matchCoreProxyPath(pathname: string): CoreProxyMatch | null {
  const collaboratorMatch = pathname.match(/^\/api\/projects\/([^/]+)\/collaborators$/);
  if (collaboratorMatch) {
    return {
      group: 'account',
      corePath: `/api/v1/account/projects/${collaboratorMatch[1]}/collaborators`,
    };
  }

  const accountExact = ACCOUNT_EXACT.get(pathname);
  if (accountExact) return { group: 'account', corePath: accountExact };

  const publicExact = PUBLIC_EXACT.get(pathname);
  if (publicExact) return { group: 'public', corePath: publicExact };

  for (const route of PREFIX_ROUTES) {
    if (pathname.startsWith(route.source)) {
      return {
        group: route.group,
        corePath: `${route.destination}${pathname.slice(route.source.length)}`,
      };
    }
  }

  return null;
}

export function configuredCoreProxyGroups(): Set<CoreProxyGroup> {
  const configured = (process.env.KICKSONAR_CORE_PROXY_GROUPS ?? 'public')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is CoreProxyGroup => value === 'public' || value === 'account');
  return new Set(configured);
}

export function isCoreProxyEnabledForHost(hostname: string): boolean {
  return STAGING_WEB_HOSTS.has(hostname.toLowerCase()) || process.env.KICKSONAR_CORE_PROXY_ENABLED === '1';
}
