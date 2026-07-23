import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  const proxyEnabled = process.env.KICKSONAR_CORE_PROXY_ENABLED === '1';
  const proxyGroups = (process.env.KICKSONAR_CORE_PROXY_GROUPS ?? 'public')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return NextResponse.json({
    ok: true,
    service: 'kicksonar-web',
    role: 'web',
    coreProxyEnabled: proxyEnabled,
    coreProxyGroups: proxyEnabled ? proxyGroups : [],
    jobsEnabled: process.env.KICKSONAR_JOBS_ENABLED === '1',
    checkedAt: new Date().toISOString(),
  });
}
