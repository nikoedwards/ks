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
  destination.pathname = '/api/core-proxy-bridge';
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-kicksonar-original-path', req.nextUrl.pathname);
  return NextResponse.rewrite(destination, {
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: '/api/:path*',
  runtime: 'nodejs',
};
