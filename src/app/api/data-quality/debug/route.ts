import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
  deleteKicktraqSnapshots,
  getProjectById,
  getRecentCrawlerErrors,
} from '@/lib/db';
import {
  buildKSJsonUrl,
  extractCreatorSlug,
  extractProjectSlug,
  getOptionalEnv,
  scrapeAndStore,
  scrapeKicktraqDetailed,
  storeKicktraqDays,
} from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DebugAction = 'official' | 'kicktraq';

type ProjectForDebug = {
  id?: string;
  name?: string;
  source_url?: string | null;
  creator_slug?: string | null;
  slug?: string | null;
};

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function safeJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function buildProjectJsonUrl(project: ProjectForDebug) {
  let jsonUrl = buildKSJsonUrl(project.source_url ?? '');

  if (!jsonUrl && project.creator_slug && project.slug) {
    jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`);
  }

  if (!jsonUrl && project.source_url) {
    const creatorSlug = extractCreatorSlug(project.source_url);
    const projectSlug = extractProjectSlug(project.source_url);
    if (creatorSlug && projectSlug) {
      jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${creatorSlug}/${projectSlug}`);
    }
  }

  return jsonUrl;
}

function buildProjectPageUrl(project: ProjectForDebug) {
  const jsonUrl = buildProjectJsonUrl(project);
  if (jsonUrl) return jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  if (project.source_url?.startsWith('https://www.kickstarter.com/projects/')) return project.source_url;
  if (project.creator_slug && project.slug) return `https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`;
  return null;
}

function sectionUrl(pageUrl: string | null, section: 'rewards' | 'creator') {
  if (!pageUrl) return null;
  try {
    const url = new URL(pageUrl);
    const match = url.pathname.match(/^\/projects\/([^/?#]+)\/([^/?#]+)/);
    if (!match) return null;
    url.hostname = 'www.kickstarter.com';
    url.search = '';
    url.hash = '';
    url.pathname = `/projects/${match[1]}/${match[2].replace(/\.json$/, '')}/${section}`;
    return url.toString();
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

function countNamedArrays(root: unknown) {
  const counts: Record<string, number> = {};
  const examples: Record<string, unknown[]> = {};
  const keys = new Set([
    'rewards',
    'reward_tiers',
    'available_rewards',
    'collaborators',
    'project_collaborators',
    'team_members',
    'project_team',
  ]);
  const seen = new Set<unknown>();
  const queue = [root];

  for (let i = 0; i < queue.length && i < 3000; i++) {
    const value = queue[i];
    if (!isRecord(value) && !Array.isArray(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (keys.has(key) && Array.isArray(child)) {
          counts[key] = Math.max(counts[key] ?? 0, child.length);
          examples[key] = child.slice(0, 3);
        }
        if (isRecord(child) || Array.isArray(child)) queue.push(child);
      }
    } else {
      for (const child of value) {
        if (isRecord(child) || Array.isArray(child)) queue.push(child);
      }
    }
  }

  return { counts, examples };
}

function analyzeJsonPayload(payload: unknown, rawPreview = '') {
  let parsed = payload;
  if (isRecord(payload) && typeof payload.text === 'string') parsed = safeJson(payload.text) ?? payload;
  if (isRecord(payload) && typeof payload.body === 'string') parsed = safeJson(payload.body) ?? payload;
  const body = isRecord(parsed) && isRecord(parsed.body) ? parsed.body : parsed;
  const namedArrays = countNamedArrays(body);
  const root = isRecord(body) ? body : {};
  return {
    topKeys: isRecord(body) ? Object.keys(body).slice(0, 30) : [],
    projectName: typeof root.name === 'string' ? root.name : null,
    state: typeof root.state === 'string' ? root.state : null,
    pledged: root.pledged ?? root.usd_pledged ?? root.converted_pledged_amount ?? null,
    backersCount: root.backers_count ?? root.backers ?? null,
    rewardCount: Math.max(namedArrays.counts.rewards ?? 0, namedArrays.counts.reward_tiers ?? 0, namedArrays.counts.available_rewards ?? 0),
    collaboratorCount: Math.max(
      namedArrays.counts.collaborators ?? 0,
      namedArrays.counts.project_collaborators ?? 0,
      namedArrays.counts.team_members ?? 0,
      namedArrays.counts.project_team ?? 0,
    ),
    namedArrays,
    rawPreview: rawPreview.slice(0, 1200),
  };
}

function analyzeHtml(text: string) {
  const nextData = text.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? null;
  const parsedNextData = nextData ? safeJson(nextData) : null;
  return {
    textLength: text.length,
    title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? null,
    hasNextData: Boolean(parsedNextData),
    hasAvailableRewardsText: /available rewards/i.test(text),
    hasBackersText: /backers?/i.test(text),
    hasCollaboratorsText: /collaborators?/i.test(text),
    hasCloudflareText: /cf_chl|just a moment|enable javascript and cookies|cloudflare/i.test(text),
    nextData: parsedNextData ? analyzeJsonPayload(parsedNextData) : null,
    rawPreview: text.replace(/\s+/g, ' ').slice(0, 1200),
  };
}

async function browserFetch(url: string, expect: 'json' | 'html') {
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  if (!fetchUrl) {
    return {
      ok: false,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service.',
      diagnostics: { env: { hasFetchUrl: false, hasToken: Boolean(token), tokenLength: token.length } },
    };
  }

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      url,
      expect,
      timeoutMs: 120_000,
      settleMs: 1500,
      scrollSteps: 12,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(130_000),
  });
  const text = await res.text();
  const payload = safeJson(text);
  const body = isRecord(payload) ? payload : {};
  return {
    ok: res.ok && body.ok !== false,
    message: res.ok ? 'Browser worker responded.' : `Browser worker HTTP ${res.status}.`,
    diagnostics: {
      workerHttpStatus: res.status,
      workerHttpOk: res.ok,
      workerReturnedOk: typeof body.ok === 'boolean' ? body.ok : null,
      status: body.status ?? null,
      contentType: body.contentType ?? null,
      finalUrl: body.finalUrl ?? null,
      elapsedMs: body.elapsedMs ?? null,
      error: body.error ?? null,
      analysis: expect === 'html'
        ? analyzeHtml(typeof body.text === 'string' ? body.text : text)
        : analyzeJsonPayload(body.body ?? body, text),
      rawPreview: text.slice(0, 1200),
    },
  };
}

async function runOfficialStep(projectId: string, project: ProjectForDebug, step: string) {
  const jsonUrl = buildProjectJsonUrl(project);
  const pageUrl = buildProjectPageUrl(project);
  const rewardsUrl = sectionUrl(pageUrl, 'rewards');
  const creatorUrl = sectionUrl(pageUrl, 'creator');
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');

  if (step === 'prepare') {
    return json({
      ok: Boolean(jsonUrl && pageUrl),
      message: jsonUrl ? 'Project URLs are ready.' : 'No valid Kickstarter project URL could be derived.',
      diagnostics: {
        project: { id: projectId, name: project.name, sourceUrl: project.source_url, creatorSlug: project.creator_slug, slug: project.slug },
        urls: { jsonUrl, pageUrl, rewardsUrl, creatorUrl },
        env: { hasBrowserFetchUrl: Boolean(fetchUrl), browserFetchUrl: fetchUrl || null, hasBrowserToken: Boolean(token), browserTokenLength: token.length },
      },
    }, jsonUrl ? 200 : 422);
  }

  if (!jsonUrl || !pageUrl) {
    return json({ ok: false, message: 'No valid Kickstarter URL for this project.' }, 422);
  }

  if (step === 'direct_json') {
    try {
      const res = await fetch(jsonUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': pageUrl,
          'X-Requested-With': 'XMLHttpRequest',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      const payload = safeJson(text);
      const analysis = payload ? analyzeJsonPayload(payload, text) : analyzeHtml(text);
      return json({
        ok: res.ok && Boolean(payload),
        message: res.ok ? 'Kickstarter direct JSON request completed.' : `Kickstarter direct JSON returned HTTP ${res.status}.`,
        diagnostics: {
          url: jsonUrl,
          status: res.status,
          ok: res.ok,
          contentType: res.headers.get('content-type'),
          isJson: Boolean(payload),
          analysis,
        },
      }, res.ok ? 200 : 502);
    } catch (err) {
      return json({ ok: false, message: err instanceof Error ? err.message : String(err), diagnostics: { url: jsonUrl } }, 502);
    }
  }

  if (step === 'browser_health') {
    if (!fetchUrl) return json({ ok: false, message: 'KICKSTARTER_BROWSER_FETCH_URL is missing.' }, 422);
    const url = healthUrl(fetchUrl);
    if (!url) return json({ ok: false, message: 'KICKSTARTER_BROWSER_FETCH_URL is not a valid URL.' }, 422);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const text = await res.text();
      return json({
        ok: res.ok,
        message: res.ok ? 'Browser worker health check succeeded.' : `Browser worker health returned HTTP ${res.status}.`,
        diagnostics: { url, status: res.status, ok: res.ok, body: safeJson(text) ?? text.slice(0, 1200) },
      }, res.ok ? 200 : 502);
    } catch (err) {
      return json({ ok: false, message: err instanceof Error ? err.message : String(err), diagnostics: { url } }, 502);
    }
  }

  if (step === 'browser_json') {
    const result = await browserFetch(jsonUrl, 'json');
    return json(result, result.ok ? 200 : 502);
  }

  if (step === 'browser_rewards') {
    if (!rewardsUrl) return json({ ok: false, message: 'No rewards tab URL could be derived.' }, 422);
    const result = await browserFetch(rewardsUrl, 'html');
    return json(result, result.ok ? 200 : 502);
  }

  if (step === 'browser_creator') {
    if (!creatorUrl) return json({ ok: false, message: 'No creator tab URL could be derived.' }, 422);
    const result = await browserFetch(creatorUrl, 'html');
    return json(result, result.ok ? 200 : 502);
  }

  if (step === 'write') {
    const result = await scrapeAndStore(projectId, jsonUrl, {
      track_rewards: 1,
      track_comments: 1,
      track_text_diff: 1,
      manual: true,
      allowKicktraqSummaryFallback: false,
    });
    const recentErrors = result.full ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 8 });
    return json({
      ok: result.ok,
      message: result.message ?? 'Kickstarter sync finished.',
      diagnostics: { result, recentErrors },
    }, result.ok ? 200 : 502);
  }

  return json({ ok: false, message: `Unknown official step: ${step}` }, 400);
}

async function runKicktraqStep(projectId: string, project: ProjectForDebug, step: string) {
  const creatorSlug = project.creator_slug || extractCreatorSlug(project.source_url ?? '');
  const projectSlug = project.slug || extractProjectSlug(project.source_url ?? '');
  const pageUrl = creatorSlug && projectSlug ? `https://www.kicktraq.com/projects/${creatorSlug}/${projectSlug}/` : null;

  if (step === 'prepare') {
    return json({
      ok: Boolean(pageUrl),
      message: pageUrl ? 'Kicktraq URLs are ready.' : 'Cannot derive Kicktraq URL for this project.',
      diagnostics: {
        project: { id: projectId, name: project.name, sourceUrl: project.source_url, creatorSlug, projectSlug },
        urls: pageUrl ? { pageUrl, dailyChartJson: `${pageUrl}dailychart.json`, dailyPledgesImage: `${pageUrl}dailypledges.png` } : {},
        env: {
          hasQwen: Boolean(getOptionalEnv('QWEN_API_KEY')),
          hasOpenAI: Boolean(getOptionalEnv('OPENAI_API_KEY')),
          hasAnthropic: Boolean(getOptionalEnv('ANTHROPIC_API_KEY')),
        },
      },
    }, pageUrl ? 200 : 422);
  }

  if (!creatorSlug || !projectSlug || !pageUrl) {
    return json({ ok: false, message: 'Cannot derive Kicktraq URL for this project.' }, 422);
  }

  if (step === 'page') {
    try {
      const res = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(25_000),
      });
      const text = await res.text();
      return json({
        ok: res.ok,
        message: res.ok ? 'Kicktraq project page fetched.' : `Kicktraq project page returned HTTP ${res.status}.`,
        diagnostics: { url: pageUrl, status: res.status, ok: res.ok, contentType: res.headers.get('content-type'), analysis: analyzeHtml(text) },
      }, res.ok ? 200 : 502);
    } catch (err) {
      return json({ ok: false, message: err instanceof Error ? err.message : String(err), diagnostics: { url: pageUrl } }, 502);
    }
  }

  if (step === 'parse') {
    const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    return json({
      ok: days.length > 0,
      message: days.length ? `Parsed ${days.length} Kicktraq daily rows.` : 'No usable Kicktraq daily rows were parsed.',
      diagnostics: { days: days.slice(0, 20), totalDays: days.length, diagnostics },
    }, days.length ? 200 : 422);
  }

  if (step === 'write') {
    const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    if (!days.length) {
      if ((diagnostics.zeroRowsRejected ?? 0) > 0) deleteKicktraqSnapshots(projectId);
      return json({
        ok: false,
        message: 'No usable Kicktraq rows parsed, so nothing was written.',
        diagnostics,
      }, 422);
    }
    const writtenSnapshots = storeKicktraqDays(projectId, days);
    return json({
      ok: true,
      message: `Imported ${days.length} Kicktraq daily rows and wrote ${writtenSnapshots.length} snapshots.`,
      diagnostics: { totalDays: days.length, writtenSnapshots, diagnostics },
    });
  }

  return json({ ok: false, message: `Unknown Kicktraq step: ${step}` }, 400);
}

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return json({ ok: false, message: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({})) as { projectId?: string; action?: DebugAction; step?: string };
  const projectId = body.projectId?.trim();
  const action = body.action;
  const step = body.step?.trim();

  if (!projectId) return json({ ok: false, message: 'projectId is required' }, 400);
  if (action !== 'official' && action !== 'kicktraq') return json({ ok: false, message: 'action must be official or kicktraq' }, 400);
  if (!step) return json({ ok: false, message: 'step is required' }, 400);

  const project = await getProjectById(projectId) as ProjectForDebug | null;
  if (!project) return json({ ok: false, message: 'Project not found' }, 404);

  if (action === 'official') return runOfficialStep(projectId, project, step);
  return runKicktraqStep(projectId, project, step);
}
