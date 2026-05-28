import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getDiagnosticsReport, pruneOldDiagnostics, purgeKsLiveErrors } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

interface WorkerHealthResult {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  message: string | null;
  endpoint: string | null;
  body?: unknown;
}

function deriveWorkerUrl(fetchUrl: string, suffix: string): string | null {
  try {
    const u = new URL(fetchUrl);
    u.pathname = u.pathname.replace(/\/fetch\/?$/, suffix);
    if (!u.pathname.endsWith(suffix)) {
      u.pathname = u.pathname.replace(/\/?$/, suffix);
    }
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

async function probeWorkerEndpoint(targetUrl: string, timeoutMs = 25_000): Promise<WorkerHealthResult> {
  const token = process.env.BROWSER_WORKER_TOKEN?.trim();
  const startedAt = Date.now();
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const text = await res.text();
    let body: unknown = undefined;
    try { body = JSON.parse(text); } catch { body = text.slice(0, 800); }
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      message: res.ok ? 'ok' : `HTTP ${res.status}`,
      endpoint: targetUrl,
      body,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
      endpoint: targetUrl,
    };
  }
}

async function probeBrowserWorker(): Promise<{ health: WorkerHealthResult; diag: WorkerHealthResult | null }> {
  const fetchUrl = process.env.KICKSTARTER_BROWSER_FETCH_URL?.trim();
  if (!fetchUrl) {
    return {
      health: { ok: false, status: null, latencyMs: null, message: 'KICKSTARTER_BROWSER_FETCH_URL is not set on the main service.', endpoint: null },
      diag: null,
    };
  }
  const healthUrl = deriveWorkerUrl(fetchUrl, '/health');
  const diagUrl = deriveWorkerUrl(fetchUrl, '/diag');
  if (!healthUrl) {
    return {
      health: { ok: false, status: null, latencyMs: null, message: `Invalid KICKSTARTER_BROWSER_FETCH_URL: ${fetchUrl.slice(0, 80)}`, endpoint: null },
      diag: null,
    };
  }
  const health = await probeWorkerEndpoint(healthUrl, 10_000);
  const diag = diagUrl ? await probeWorkerEndpoint(diagUrl, 40_000) : null;
  return { health, diag };
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const probeWorker = req.nextUrl.searchParams.get('probeWorker') !== '0';
  const diagnostics = getDiagnosticsReport();
  const worker = probeWorker ? await probeBrowserWorker() : { health: null, diag: null };
  return NextResponse.json({ diagnostics, workerHealth: worker.health, workerDiag: worker.diag });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    action?: 'prune' | 'vacuum' | 'purge_ks_live_errors';
    errorAgeDays?: number;
    payloadAgeDays?: number;
    debugAgeDays?: number;
    runAgeDays?: number;
    syncLogAgeDays?: number;
    keepRecent?: number;
  };
  if (body.action === 'purge_ks_live_errors') {
    const purge = purgeKsLiveErrors({ keepRecent: body.keepRecent ?? 20 });
    const summary = pruneOldDiagnostics({
      errorAgeDays: body.errorAgeDays ?? 7,
      payloadAgeDays: body.payloadAgeDays ?? 7,
      debugAgeDays: body.debugAgeDays ?? 7,
      runAgeDays: body.runAgeDays ?? 30,
      syncLogAgeDays: body.syncLogAgeDays ?? 30,
      vacuum: true,
    });
    return NextResponse.json({ ok: true, purge, summary });
  }
  if (body.action === 'vacuum') {
    const summary = pruneOldDiagnostics({
      errorAgeDays: body.errorAgeDays ?? 7,
      payloadAgeDays: body.payloadAgeDays ?? 7,
      debugAgeDays: body.debugAgeDays ?? 7,
      runAgeDays: body.runAgeDays ?? 30,
      syncLogAgeDays: body.syncLogAgeDays ?? 30,
      vacuum: true,
    });
    return NextResponse.json({ ok: true, summary });
  }
  if (body.action === 'prune' || !body.action) {
    const summary = pruneOldDiagnostics({
      errorAgeDays: body.errorAgeDays ?? 7,
      payloadAgeDays: body.payloadAgeDays ?? 7,
      debugAgeDays: body.debugAgeDays ?? 7,
      runAgeDays: body.runAgeDays ?? 30,
      syncLogAgeDays: body.syncLogAgeDays ?? 30,
    });
    return NextResponse.json({ ok: true, summary });
  }
  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
}
