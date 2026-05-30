import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
  deleteProjectsDeep,
  deleteKicktraqSnapshots,
  type DataWorkbenchFilter,
  getDataWorkbenchProjects,
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

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

function buildProjectJsonUrl(project: { source_url?: string | null; creator_slug?: string | null; slug?: string | null }) {
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

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  return NextResponse.json(getDataWorkbenchProjects({
    filter: (searchParams.get('filter') || 'all') as DataWorkbenchFilter,
    query: searchParams.get('q') ?? undefined,
    state: searchParams.get('state') ?? undefined,
    minPledged: searchParams.get('minPledged') ? Number(searchParams.get('minPledged')) : undefined,
    maxPledged: searchParams.get('maxPledged') ? Number(searchParams.get('maxPledged')) : undefined,
    limit: Number(searchParams.get('limit') || 25),
    offset: Number(searchParams.get('offset') || 0),
  }));
}

async function runKickstarterBasicSync(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
  } | null;
  if (!project) return { response: NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 }) };

  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) return { response: NextResponse.json({ ok: false, error: 'No valid Kickstarter URL for this project' }, { status: 422 }) };

  const result = await scrapeAndStore(projectId, jsonUrl, {
    track_rewards: 0,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
    allowKicktraqSummaryFallback: false,
    basicOnly: true,
    allowBrowserFallback: true,
    allowHtmlFallback: false,
    directTimeoutMs: Number(process.env.KICKSTARTER_BASIC_DIRECT_TIMEOUT_MS ?? 60_000),
    directAttempts: Number(process.env.KICKSTARTER_BASIC_DIRECT_ATTEMPTS ?? 2),
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
  const recentDetail = recentErrors
    .map(error => error.message)
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
  return {
    payload: {
      ok: result.ok,
      action,
      source: result.source,
      full: result.full,
      rewardCount: result.rewardCount,
      collaboratorCount: result.collaboratorCount,
      message: result.ok
        ? (result.message ?? 'Synced Kickstarter basic project fields.')
        : recentDetail || result.message,
      recentErrors,
    },
    status: result.ok ? 200 : 502,
  };
}

async function runKickstarterFullSync(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null; creator_slug?: string | null; slug?: string | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) return { payload: { ok: false, action, error: 'No valid Kickstarter URL for this project' }, status: 422 };

  const result = await scrapeAndStore(projectId, jsonUrl, {
    track_rewards: 0,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
    allowKicktraqSummaryFallback: false,
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
  const recentDetail = recentErrors.map(e => e.message).filter(Boolean).slice(0, 2).join(' | ');
  return {
    payload: {
      ok: result.ok,
      action,
      source: result.source,
      full: result.full,
      rewardCount: result.rewardCount,
      collaboratorCount: result.collaboratorCount,
      message: result.ok ? result.message : (recentDetail || result.message),
      recentErrors,
    },
    status: result.ok ? 200 : 502,
  };
}

async function runKicktraqImport(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null; creator_slug?: string | null; slug?: string | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const creatorSlug = project.creator_slug || extractCreatorSlug(project.source_url ?? '');
  const projectSlug = project.slug || extractProjectSlug(project.source_url ?? '');
  if (!creatorSlug || !projectSlug) {
    return { payload: { ok: false, action, error: 'Cannot derive Kicktraq URL for this project.' }, status: 422 };
  }

  const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
  if (!days.length) {
    if ((diagnostics.zeroRowsRejected ?? 0) > 0) deleteKicktraqSnapshots(projectId);
    const hasOcr = Boolean(getOptionalEnv('QWEN_API_KEY') || getOptionalEnv('OPENAI_API_KEY') || getOptionalEnv('ANTHROPIC_API_KEY'));
    return {
      payload: {
        ok: false,
        action,
        noData: true,
        message: hasOcr
          ? `No usable Kicktraq rows parsed. page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, image=${diagnostics.imageStatus ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}.`
          : 'OCR provider key is not available in this Railway service.',
        diagnostics,
      },
      status: 422,
    };
  }

  const writtenSnapshots = storeKicktraqDays(projectId, days);
  return { payload: { ok: true, action, days: days.length, writtenSnapshots, diagnostics }, status: 200 };
}

const SCRAPE_RUNNERS: Record<string, (projectId: string, action: string) => Promise<{ payload?: Record<string, unknown>; status?: number; response?: NextResponse }>> = {
  kickstarter_basic_sync: runKickstarterBasicSync,
  kickstarter_sync: runKickstarterFullSync,
  kicktraq_import: runKicktraqImport,
};

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { projectId?: string; projectIds?: string[]; action?: string };
  const action = body.action ?? '';
  const projectIds = Array.isArray(body.projectIds)
    ? Array.from(new Set(body.projectIds.map(id => String(id).trim()).filter(Boolean))).slice(0, 50)
    : [];

  // ─── Batch ────────────────────────────────────────────────────────────────
  if (projectIds.length) {
    if (action === 'delete_projects') {
      const deleted = deleteProjectsDeep(projectIds);
      return NextResponse.json({ ok: true, action, deleted, requested: projectIds.length });
    }
    const runner = SCRAPE_RUNNERS[action];
    if (!runner) return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    const results: Array<{ projectId: string; status: number; ok?: boolean; [k: string]: unknown }> = [];
    for (const id of projectIds.slice(0, 25)) {
      const r = await runner(id, action).catch(() => ({ payload: { ok: false, error: 'Project sync failed.' }, status: 500 }));
      const hasResponse = 'response' in r && r.response;
      const payload: { ok?: boolean; [k: string]: unknown } = hasResponse
        ? { ok: false, error: 'Project sync failed.' }
        : (r.payload ?? { ok: false, error: 'Project sync failed.' });
      results.push({ projectId: id, status: r.status ?? 500, ...payload });
    }
    const succeeded = results.filter(r => r.ok).length;
    return NextResponse.json({
      ok: succeeded > 0,
      action,
      succeeded,
      failed: results.length - succeeded,
      results,
    }, { status: succeeded > 0 ? 200 : 502 });
  }

  // ─── Single project ─────────────────────────────────────────────────────────
  const projectId = body.projectId?.trim();
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId is required' }, { status: 400 });

  const runner = SCRAPE_RUNNERS[action];
  if (!runner) return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  const result = await runner(projectId, action);
  if (result.response) return result.response;
  return NextResponse.json(result.payload, { status: result.status });
}
