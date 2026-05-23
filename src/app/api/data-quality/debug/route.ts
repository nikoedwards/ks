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

async function browserFetch(url: string, expect: 'json' | 'html', mode?: 'project_detail_debug') {
  const fetchUrl = getOptionalEnv('KICKSTARTER_BROWSER_FETCH_URL');
  const token = getOptionalEnv('BROWSER_WORKER_TOKEN');
  if (!fetchUrl) {
    return {
      ok: false,
      message: 'KICKSTARTER_BROWSER_FETCH_URL is not configured on the main service.',
      diagnostics: { env: { hasFetchUrl: false, hasToken: Boolean(token), tokenLength: token.length } },
    };
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
        url,
        expect,
        mode,
        timeoutMs: 180_000,
        pageTimeoutMs: 45_000,
        settleMs: 1500,
        scrollSteps: 12,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(190_000),
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
        workerDiagnostics: body.diagnostics ?? null,
        analysis: expect === 'html'
          ? analyzeHtml(typeof body.text === 'string' ? body.text : text)
          : analyzeJsonPayload(body.body ?? body, text),
        rawPreview: text.slice(0, 1200),
      },
    };
  } catch (err) {
    return {
      ok: false,
      message: `Main service could not call Browser Worker: ${err instanceof Error ? err.message : String(err)}`,
      diagnostics: {
        workerFetchUrl: fetchUrl,
        error: {
          name: err instanceof Error ? err.name : 'Error',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      },
    };
  }
}

function getWorkerStep(result: unknown, label: string) {
  if (!isRecord(result)) return null;
  const diagnostics = result.diagnostics;
  if (!isRecord(diagnostics)) return null;
  const workerDiagnostics = diagnostics.workerDiagnostics;
  if (!isRecord(workerDiagnostics)) return null;
  const steps = workerDiagnostics.steps;
  if (!Array.isArray(steps)) return null;
  const step = steps.find(item => isRecord(item) && item.label === label);
  return isRecord(step) ? step : null;
}

function detailCount(step: Record<string, unknown> | null, key: 'rewards' | 'collaborators') {
  const counts = isRecord(step?.detailCounts) ? step.detailCounts : null;
  const value = counts?.[key];
  return typeof value === 'number' ? value : 0;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function workerPageSummary(step: Record<string, unknown> | null, kind: 'rewards' | 'creator') {
  if (!step) {
    return { kind, foundStep: false };
  }

  const candidates = isRecord(step.diagnosticCandidates) ? step.diagnosticCandidates : {};
  const detailCounts = isRecord(step.detailCounts) ? step.detailCounts : {};
  const bodyPreview = stringValue(step.bodyPreview);
  return {
    kind,
    foundStep: true,
    ok: booleanValue(step.ok),
    status: numberValue(step.status),
    finalUrl: stringValue(step.finalUrl),
    contentType: stringValue(step.contentType),
    elapsedMs: numberValue(step.elapsedMs),
    title: stringValue(step.title),
    bodyTextLength: numberValue(step.bodyTextLength),
    cookieCount: numberValue(step.cookieCount) ?? 0,
    responseHeaders: isRecord(step.responseHeaders) ? step.responseHeaders : {},
    hasCloudflareText: booleanValue(step.hasCloudflareText),
    hasNextData: booleanValue(step.hasNextData),
    hasAvailableRewardsText: booleanValue(step.hasAvailableRewardsText),
    hasBackersText: booleanValue(step.hasBackersText),
    hasCollaboratorsText: booleanValue(step.hasCollaboratorsText),
    rewardCount: numberValue(detailCounts.rewards) ?? 0,
    collaboratorCount: numberValue(detailCounts.collaborators) ?? 0,
    rewardDomNodeCount: numberValue(candidates.rewardDomNodeCount) ?? 0,
    rewardTextCandidateCount: numberValue(candidates.rewardTextCandidateCount) ?? 0,
    availableRewardNavCandidateCount: numberValue(candidates.availableRewardNavCandidateCount) ?? 0,
    collaboratorDomNodeCount: numberValue(candidates.collaboratorDomNodeCount) ?? 0,
    collaboratorTextCandidateCount: numberValue(candidates.collaboratorTextCandidateCount) ?? 0,
    headings: Array.isArray(step.headings) ? step.headings.slice(0, 12) : [],
    rewardTextPreviews: Array.isArray(candidates.rewardTextPreviews) ? candidates.rewardTextPreviews.slice(0, 4) : [],
    availableRewardNavPreviews: Array.isArray(candidates.availableRewardNavPreviews) ? candidates.availableRewardNavPreviews.slice(0, 4) : [],
    collaboratorTextPreviews: Array.isArray(candidates.collaboratorTextPreviews) ? candidates.collaboratorTextPreviews.slice(0, 4) : [],
    bodyPreview: bodyPreview ? bodyPreview.slice(0, 900) : null,
    screenshot: typeof step.screenshot === 'string' ? step.screenshot : null,
    error: step.error ?? null,
  };
}

function browserResultSummary(result: unknown) {
  if (!isRecord(result)) return null;
  const diagnostics = isRecord(result.diagnostics) ? result.diagnostics : {};
  const workerDiagnostics = isRecord(diagnostics.workerDiagnostics) ? diagnostics.workerDiagnostics : {};
  const detailCounts = isRecord(workerDiagnostics.detailCounts) ? workerDiagnostics.detailCounts : {};
  return {
    ok: booleanValue(result.ok),
    message: stringValue(result.message),
    workerHttpStatus: numberValue(diagnostics.workerHttpStatus),
    workerReturnedOk: booleanValue(diagnostics.workerReturnedOk),
    finalUrl: stringValue(diagnostics.finalUrl),
    elapsedMs: numberValue(diagnostics.elapsedMs),
    jsonPayloadCount: numberValue(workerDiagnostics.jsonPayloadCount) ?? 0,
    rewardCount: numberValue(detailCounts.rewards) ?? 0,
    collaboratorCount: numberValue(detailCounts.collaborators) ?? 0,
    hasRewards: booleanValue(workerDiagnostics.hasRewards),
    hasCollaborators: booleanValue(workerDiagnostics.hasCollaborators),
    storageState: isRecord(workerDiagnostics.storageState) ? workerDiagnostics.storageState : null,
    warmupHomePage: workerPageSummary(getWorkerStep(result, 'warmup_home_page'), 'creator'),
    warmupCampaignPage: workerPageSummary(getWorkerStep(result, 'warmup_campaign_page'), 'creator'),
    campaignPage: workerPageSummary(getWorkerStep(result, 'campaign_page'), 'rewards'),
    rewardsPage: workerPageSummary(getWorkerStep(result, 'rewards_page'), 'rewards'),
    creatorPage: workerPageSummary(getWorkerStep(result, 'creator_page'), 'creator'),
  };
}

function pageFailureMessage(summary: ReturnType<typeof workerPageSummary>, kind: 'rewards' | 'creator') {
  const page = summary as Record<string, unknown>;
  if (!page.foundStep) return `${kind === 'rewards' ? 'Rewards' : 'Creator'} page step was not returned by Browser Worker.`;
  const status = numberValue(page.status);
  const bodyTextLength = numberValue(page.bodyTextLength);
  if (status && status >= 400) return `${kind === 'rewards' ? 'Rewards' : 'Creator'} page returned HTTP ${status}.`;
  if (page.hasCloudflareText === true) return `${kind === 'rewards' ? 'Rewards' : 'Creator'} page appears to be blocked by Cloudflare.`;
  if (!bodyTextLength) return `${kind === 'rewards' ? 'Rewards' : 'Creator'} page returned no visible text.`;
  if (kind === 'rewards') {
    if (!page.hasAvailableRewardsText && !page.hasBackersText && numberValue(page.rewardTextCandidateCount) === 0) {
      return 'Rewards page rendered, but visible reward/backer text was not found.';
    }
    if (numberValue(page.availableRewardNavCandidateCount) === 0) {
      return 'Rewards page rendered, but the left Available Rewards list was not detected.';
    }
    return 'Rewards page rendered target text, but the reward parser returned 0 tiers.';
  }
  if (!page.hasCollaboratorsText && numberValue(page.collaboratorTextCandidateCount) === 0) {
    return 'Creator page rendered, but visible Collaborators text was not found.';
  }
  return 'Creator page rendered target text, but the collaborator parser returned 0 collaborators.';
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
    const result = await browserFetch(jsonUrl, 'json', 'project_detail_debug');
    return json({
      ...result,
      summary: browserResultSummary(result),
    }, result.ok ? 200 : 502);
  }

  if (step === 'browser_rewards') {
    if (!rewardsUrl) return json({ ok: false, message: 'No rewards tab URL could be derived.' }, 422);
    const result = await browserFetch(jsonUrl, 'json', 'project_detail_debug');
    const rewardStep = getWorkerStep(result, 'rewards_page');
    const rewardCount = detailCount(rewardStep, 'rewards');
    const summary = workerPageSummary(rewardStep, 'rewards');
    const ok = Boolean(isRecord(result) && result.ok !== false && rewardStep?.ok && rewardCount > 0);
    return json({
      ok,
      message: ok
        ? `Rewards page parsed ${rewardCount} reward tiers.`
        : pageFailureMessage(summary, 'rewards'),
      summary,
      diagnostics: {
        rewardsUrl,
        rewardCount,
        rewardsPage: rewardStep,
        browserSummary: browserResultSummary(result),
        workerResult: result,
      },
    }, ok ? 200 : 502);
  }

  if (step === 'browser_creator') {
    if (!creatorUrl) return json({ ok: false, message: 'No creator tab URL could be derived.' }, 422);
    const result = await browserFetch(jsonUrl, 'json', 'project_detail_debug');
    const creatorStep = getWorkerStep(result, 'creator_page');
    const collaboratorCount = detailCount(creatorStep, 'collaborators');
    const summary = workerPageSummary(creatorStep, 'creator');
    const ok = Boolean(isRecord(result) && result.ok !== false && creatorStep?.ok && collaboratorCount > 0);
    return json({
      ok,
      message: ok
        ? `Creator page parsed ${collaboratorCount} collaborators.`
        : pageFailureMessage(summary, 'creator'),
      summary,
      diagnostics: {
        creatorUrl,
        collaboratorCount,
        creatorPage: creatorStep,
        browserSummary: browserResultSummary(result),
        workerResult: result,
      },
    }, ok ? 200 : 502);
  }

  if (step === 'write') {
    try {
      const result = await scrapeAndStore(projectId, jsonUrl, {
        track_rewards: 1,
        track_comments: 1,
        track_text_diff: 1,
        manual: true,
        allowKicktraqSummaryFallback: false,
      });
      const recentErrors = result.full ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 8 });
      const ok = result.ok && result.rewardCount > 0 && result.collaboratorCount > 0;
      return json({
        ok,
        message: ok
          ? result.message ?? 'Kickstarter sync finished.'
          : `Kickstarter sync finished but detail data is incomplete. rewards=${result.rewardCount}, collaborators=${result.collaboratorCount}.`,
        diagnostics: { result, recentErrors },
      }, ok ? 200 : 502);
    } catch (err) {
      const recentErrors = getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 8 });
      return json({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        diagnostics: {
          error: {
            name: err instanceof Error ? err.name : 'Error',
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
          recentErrors,
        },
      }, 500);
    }
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
