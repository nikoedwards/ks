import { NextRequest, NextResponse } from 'next/server';
import {
  configuredCoreProxyGroups,
  isCoreProxyEnabledForHost,
  matchCoreProxyPath,
} from '@/lib/coreProxyRoutes';

export function middleware(req: NextRequest) {
  if (!isCoreProxyEnabledForHost(req.nextUrl.hostname)) return NextResponse.next();

  const match = matchCoreProxyPath(req.nextUrl.pathname);
  if (!match || !configuredCoreProxyGroups().has(match.group)) return NextResponse.next();

  const destination = req.nextUrl.clone();
  destination.pathname = '/api/_core-proxy';
  destination.searchParams.set('__ks_original_path', req.nextUrl.pathname);
  return NextResponse.rewrite(destination);
}

export const config = {
  matcher: '/api/:path*',
  runtime: 'nodejs',
};
