import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getDiagnosticsReport, pruneOldDiagnostics } from '@/lib/db';

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
}

async function probeBrowserWorker(): Promise<WorkerHealthResult> {
  const fetchUrl = process.env.KICKSTARTER_BROWSER_FETCH_URL?.trim();
  if (!fetchUrl) {
    return { ok: false, status: null, latencyMs: null, message: 'KICKSTARTER_BROWSER_FETCH_URL is not set on the main service.', endpoint: null };
  }
  let healthUrl: string;
  try {
    const u = new URL(fetchUrl);
    u.pathname = u.pathname.replace(/\/fetch\/?$/, '/health');
    if (!u.pathname.endsWith('/health')) {
      u.pathname = u.pathname.replace(/\/?$/, '/health');
    }
    healthUrl = u.toString();
  } catch {
    return { ok: false, status: null, latencyMs: null, message: `Invalid KICKSTARTER_BROWSER_FETCH_URL: ${fetchUrl.slice(0, 80)}`, endpoint: null };
  }

  const token = process.env.BROWSER_WORKER_TOKEN?.trim();
  const startedAt = Date.now();
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - startedAt,
      message: res.ok ? text.slice(0, 200) || 'ok' : `HTTP ${res.status}: ${text.slice(0, 200)}`,
      endpoint: healthUrl,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : String(err),
      endpoint: healthUrl,
    };
  }
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const probeWorker = req.nextUrl.searchParams.get('probeWorker') !== '0';
  const diagnostics = getDiagnosticsReport();
  const workerHealth = probeWorker ? await probeBrowserWorker() : null;
  return NextResponse.json({ diagnostics, workerHealth });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    action?: 'prune' | 'vacuum';
    errorAgeDays?: number;
    payloadAgeDays?: number;
    debugAgeDays?: number;
    runAgeDays?: number;
    syncLogAgeDays?: number;
  };
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
