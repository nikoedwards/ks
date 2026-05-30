import { NextResponse } from 'next/server';
import { getOptionalEnv } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function diagUrl(fetchUrl: string): string | null {
  try {
    const url = new URL(fetchUrl);
    url.pathname = '/diag';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Verdict buckets so the UI can tell at a glance WHY KS Live is blocked:
 *  - unconfigured: the main service has no worker URL
 *  - unreachable:  worker URL set but /diag didn't respond
 *  - browser_down: worker up but chromium won't launch/connect
 *  - ip_blocked:   browser fine but Kickstarter returns 403 (Cloudflare/datacenter IP)
 *  - healthy:      browser up and warmup succeeded
 *  - degraded:     up but warmup state unknown/other
 */
type Verdict = 'unconfigured' | 'unreachable' | 'browser_down' | 'ip_blocked' | 'degraded' | 'healthy';

export async function GET() {
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  if (!fetchUrl) {
    return NextResponse.json({
      configured: false,
      reachable: false,
      verdict: 'unconfigured' as Verdict,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service.',
      checkedAt: Math.floor(Date.now() / 1000),
    });
  }

  const url = diagUrl(fetchUrl);
  if (!url) {
    return NextResponse.json({
      configured: true,
      reachable: false,
      verdict: 'unconfigured' as Verdict,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not a valid URL.',
      checkedAt: Math.floor(Date.now() / 1000),
    });
  }

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return NextResponse.json({
        configured: true,
        reachable: false,
        verdict: 'unreachable' as Verdict,
        message: `Worker /diag returned HTTP ${res.status}.`,
        httpStatus: res.status,
        checkedAt: Math.floor(Date.now() / 1000),
      });
    }

    const body = (await res.json().catch(() => null)) as unknown;
    const root = isRecord(body) ? body : {};
    const runningBrowser = isRecord(root.runningBrowser) ? root.runningBrowser : {};
    const launchTest = isRecord(root.launchTest) ? root.launchTest : {};
    const warmup = isRecord(root.warmup) ? root.warmup : {};
    const env = isRecord(root.env) ? root.env : {};
    const proxy = isRecord(env.proxy) ? env.proxy : {};
    const memoryMB = isRecord(env.memoryMB) ? env.memoryMB : {};

    const browserConnected = bool(runningBrowser.connected) ?? bool(launchTest.ok) ?? null;
    const proxyConfigured = bool(proxy.configured) ?? false;
    const warmupOk = bool(warmup.ok);
    const warmupLastError = str(warmup.lastError);
    const lastLaunchError = root.lastLaunchError ?? env.lastLaunchError ?? null;

    const warmupBlocked = warmupOk === false && /\b403\b|status=403|cloudflare|just a moment/i.test(warmupLastError ?? '');

    let verdict: Verdict;
    if (browserConnected === false) verdict = 'browser_down';
    else if (warmupBlocked) verdict = 'ip_blocked';
    else if (warmupOk === true) verdict = 'healthy';
    else verdict = 'degraded';

    return NextResponse.json({
      configured: true,
      reachable: true,
      verdict,
      browserConnected,
      browserVersion: str(runningBrowser.version),
      proxyConfigured,
      proxyServer: str(proxy.server),
      warmupOk,
      warmupAttempts: num(warmup.attempts),
      warmupLastError,
      warmupLastAt: str(warmup.lastAt),
      lastLaunchError: typeof lastLaunchError === 'string' ? lastLaunchError : (isRecord(lastLaunchError) ? lastLaunchError : null),
      memoryRssMb: num(memoryMB.rss),
      uptimeSec: num(env.uptimeSec),
      checkedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      reachable: false,
      verdict: 'unreachable' as Verdict,
      message: `Could not reach worker /diag: ${err instanceof Error ? err.message : String(err)}`,
      checkedAt: Math.floor(Date.now() / 1000),
    });
  }
}
