import { NextRequest, NextResponse } from 'next/server';

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

  const workerHealthUrl = healthUrl(fetchUrl);
  if (workerHealthUrl) {
    try {
      const res = await fetch(workerHealthUrl, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      diagnostics.health = {
        status: res.status,
        ok: res.ok,
        body: safeJson(text) ?? text.slice(0, 500),
      };
    } catch (err) {
      diagnostics.health = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        url: testUrl,
        expect: 'json',
        timeoutMs: 90_000,
        settleMs: 1500,
        scrollSteps: target ? 10 : 1,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(100_000),
    });
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
    diagnostics.fetch = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    return NextResponse.json({
      ok: false,
      message: 'Main service could not call the browser worker.',
      diagnostics,
    });
  }
}
