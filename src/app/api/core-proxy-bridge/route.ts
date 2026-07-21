import { NextRequest, NextResponse } from 'next/server';
import {
  configuredCoreProxyGroups,
  isCoreProxyEnabledForHost,
  matchCoreProxyPath,
} from '@/lib/coreProxyRoutes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INTERNAL_QUERY_KEY = '__ks_original_path';
const HOP_BY_HOP_HEADERS = [
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

function coreBaseUrl(): string | null {
  const raw = process.env.KICKSONAR_CORE_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function forwardedHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  const originalHost = req.headers.get('host');
  if (originalHost) headers.set('x-forwarded-host', originalHost);
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
  return headers;
}

async function proxy(req: NextRequest) {
  if (!isCoreProxyEnabledForHost(req.nextUrl.hostname)) {
    return NextResponse.json({ error: 'Core proxy disabled' }, { status: 404 });
  }

  const originalPath = req.headers.get('x-kicksonar-original-path')
    ?? req.nextUrl.searchParams.get(INTERNAL_QUERY_KEY);
  const match = originalPath ? matchCoreProxyPath(originalPath) : null;
  if (!match || !configuredCoreProxyGroups().has(match.group)) {
    return NextResponse.json({ error: 'Route is not allowed through the Core proxy' }, { status: 404 });
  }

  const baseUrl = coreBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: 'Core proxy is not configured' }, { status: 503 });
  }

  const target = new URL(`${baseUrl}${match.corePath}`);
  for (const [key, value] of req.nextUrl.searchParams) {
    if (key !== INTERNAL_QUERY_KEY) target.searchParams.append(key, value);
  }

  try {
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const response = await fetch(target, {
      method: req.method,
      headers: forwardedHeaders(req),
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });

    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.set('x-kicksonar-web-proxy', 'core-v1');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('[Core proxy] request failed:', error);
    return NextResponse.json({ error: 'Core service unavailable' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
