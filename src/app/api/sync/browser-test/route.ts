import { NextRequest, NextResponse } from 'next/server';
import { workerGateStatus, pickWorkerBase, gatedWorkerFetch, WorkerPriority } from '@/lib/workerGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getOptionalEnv(name: string) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function healthUrl(fetchUrl: string) {
  try {
    const url = new URL(fetchUrl);
    url.pathname = '/health';
    url.search = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  const target = req.nextUrl.searchParams.get('url')?.trim();
  const testUrl = target && target.startsWith('https://www.kickstarter.com/')
    ? target
    : 'https://www.kickstarter.com/discover/advanced?sort=newest&page=1&format=json&state=live';
  const diagnostics: Record<string, unknown> = {
    env: {
      hasFetchUrl: Boolean(fetchUrl),
      fetchUrl,
      hasToken: Boolean(token),
      tokenLength: token.length,
    },
    gate: workerGateStatus(),
    health: null,
    fetch: null,
  };

  if (!fetchUrl) {
    return NextResponse.json({
      ok: false,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is missing on the main service.',
      diagnostics,
    });
  }

  let healthBody: Record<string, unknown> | null = null;
  const workerHealthUrl = healthUrl(fetchUrl);
  if (workerHealthUrl) {
    try {
      const res = await fetch(workerHealthUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      healthBody = safeJson(text);
      diagnostics.health = {
        status: res.status,
        ok: res.ok,
        body: healthBody ?? text.slice(0, 500),
      };
    } catch (err) {
      diagnostics.health = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // If the worker is healthy but its single lane is already busy, DON'T fire the
  // heavy probe — it would just queue, time out after ~150s, and pile more load
  // onto the saturated lane (which is what made the old diagnostic look like a
  // hard failure). Report the busy state truthfully instead.
  const active = Number(healthBody?.activeFetches ?? 0) || 0;
  const queued = Number(healthBody?.queuedFetches ?? 0) || 0;
  const concurrency = Math.max(1, Number(healthBody?.maxConcurrency ?? 1) || 1);
  if (healthBody && (active >= concurrency || queued > 0)) {
    diagnostics.fetch = { skipped: true, reason: 'worker_busy', active, queued, concurrency };
    return NextResponse.json({
      ok: true,
      message: `Browser worker is healthy but its lane is busy (active ${active}/${concurrency}, queued ${queued}). Skipped the live probe to avoid piling onto the queue. Background discovery uses HIGH priority and will be served first; expensive backfill passes auto-defer until a lane frees up.`,
      diagnostics,
    });
  }

  const base = pickWorkerBase();
  if (!base) {
    return NextResponse.json({ ok: false, message: 'No worker base resolved.', diagnostics });
  }
  try {
    // Route through the gate at HIGH priority (like live discovery) with a tight
    // budget, so the probe never becomes a lane hog.
    const res = await gatedWorkerFetch(base, '/fetch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        url: testUrl,
        expect: 'json',
        timeoutMs: 75_000,
        settleMs: 1500,
        scrollSteps: target ? 10 : 1,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(90_000),
    }, WorkerPriority.HIGH);
    const text = await res.text();
    const body = safeJson(text);
    const responseBody = body?.body && typeof body.body === 'object' ? body.body as Record<string, unknown> : null;
    const projects = Array.isArray(responseBody?.projects) ? responseBody.projects : [];
    const rewards = Array.isArray(responseBody?.rewards) ? responseBody.rewards : [];
    const collaborators = [
      ...(Array.isArray(responseBody?.collaborators) ? responseBody.collaborators : []),
      ...(Array.isArray(responseBody?.project_collaborators) ? responseBody.project_collaborators : []),
    ];

    diagnostics.fetch = {
      targetUrl: testUrl,
      workerHttpStatus: res.status,
      workerHttpOk: res.ok,
      workerReturnedOk: typeof body?.ok === 'boolean' ? body.ok : null,
      status: body?.status ?? null,
      contentType: body?.contentType ?? null,
      finalUrl: body?.finalUrl ?? null,
      elapsedMs: body?.elapsedMs ?? null,
      error: body?.error ?? null,
      bodyKeys: responseBody ? Object.keys(responseBody).slice(0, 20) : [],
      projectCount: projects.length,
      rewardCount: rewards.length,
      collaboratorCount: collaborators.length,
      projectName: typeof responseBody?.name === 'string' ? responseBody.name : null,
      hasMoreProjects: responseBody?.has_more_projects ?? null,
      rawPreview: text.slice(0, 1000),
    };

    if (target) {
      return NextResponse.json({
        ok: res.ok && Boolean(responseBody),
        message: rewards.length || collaborators.length
          ? 'Browser worker found Kickstarter project detail data.'
          : 'Browser worker fetched the project, but did not find rewards or collaborators.',
        diagnostics,
      });
    }

    return NextResponse.json({
      ok: res.ok && projects.length > 0,
      message: projects.length > 0
        ? 'Browser worker can fetch Kickstarter Discover JSON.'
        : 'Browser worker responded, but no Kickstarter projects were parsed.',
      diagnostics,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /abort|timeout/i.test(msg);
    diagnostics.fetch = { ok: false, error: msg, classified: timedOut ? 'worker_busy_or_slow' : 'unreachable' };
    return NextResponse.json({
      ok: false,
      message: timedOut
        ? 'Browser worker is reachable (see health) but the probe timed out — the single lane is likely busy with a Cloudflare challenge. This is transient; discovery runs at HIGH priority and backfill auto-defers.'
        : 'Main service could not call the browser worker.',
      diagnostics,
    });
  }
}
