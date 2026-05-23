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
import { syncKickstarterLiveProject } from '@/lib/kickstarterLive';

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
    name?: string | null;
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
  } | null;
  if (!project) return { response: NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 }) };

  let liveDiscoverMessage: string | null = null;
  const liveResult = await syncKickstarterLiveProject({
    id: projectId,
    name: project.name,
    sourceUrl: project.source_url,
    creatorSlug: project.creator_slug,
    slug: project.slug,
  }, {
    maxPages: Number(process.env.LIVE_DISCOVERY_MANUAL_MAX_PAGES ?? 8),
    state: 'live',
  });
  if (liveResult.ok) {
    return {
      payload: {
        ok: true,
        action,
        source: liveResult.source,
        full: false,
        rewardCount: 0,
        collaboratorCount: 0,
        message: liveResult.message,
        recentErrors: [],
      },
      status: 200,
    };
  }
  liveDiscoverMessage = liveResult.message;

  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) return { response: NextResponse.json({ ok: false, error: 'No valid Kickstarter URL for this project' }, { status: 422 }) };

  const result = await scrapeAndStore(projectId, jsonUrl, {
    track_rewards: 0,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
    allowKicktraqSummaryFallback: false,
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
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
        : [liveDiscoverMessage, result.message].filter(Boolean).join(' | '),
      recentErrors,
    },
    status: result.ok ? 200 : 502,
  };
}

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { projectId?: string; projectIds?: string[]; action?: string };
  const projectIds = Array.isArray(body.projectIds)
    ? Array.from(new Set(body.projectIds.map(id => String(id).trim()).filter(Boolean))).slice(0, 50)
    : [];

  if (body.action === 'delete_projects') {
    if (!projectIds.length) return NextResponse.json({ ok: false, error: 'projectIds is required' }, { status: 400 });
    const deleted = deleteProjectsDeep(projectIds);
    return NextResponse.json({ ok: true, action: body.action, deleted, requested: projectIds.length });
  }

  if (body.action === 'kickstarter_basic_sync' && projectIds.length) {
    const results = [];
    for (const id of projectIds.slice(0, 25)) {
      const result = await runKickstarterBasicSync(id, body.action);
      results.push({
        projectId: id,
        status: result.status ?? 500,
        ...(result.payload ?? { ok: false, error: 'Project sync failed.' }),
      });
    }
    const succeeded = results.filter(result => result.ok).length;
    return NextResponse.json({
      ok: succeeded > 0,
      action: body.action,
      succeeded,
      failed: results.length - succeeded,
      results,
    }, { status: succeeded > 0 ? 200 : 502 });
  }

  const projectId = body.projectId?.trim();
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId is required' }, { status: 400 });

  const project = await getProjectById(projectId) as {
    name?: string | null;
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
  } | null;
  if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });

  if (body.action === 'kickstarter_basic_sync') {
    const result = await runKickstarterBasicSync(projectId, body.action);
    if (result.response) return result.response;
    return NextResponse.json(result.payload, { status: result.status });
  }

  if (body.action === 'kickstarter_sync') {
    const jsonUrl = buildProjectJsonUrl(project);
    if (!jsonUrl) return NextResponse.json({ ok: false, error: 'No valid Kickstarter URL for this project' }, { status: 422 });

    const result = await scrapeAndStore(projectId, jsonUrl, {
      track_rewards: 0,
      track_comments: 1,
      track_text_diff: 1,
      manual: true,
      allowKicktraqSummaryFallback: false,
    });
    const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
    const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
    return NextResponse.json({
      ok: result.ok,
      action: body.action,
      source: result.source,
      full: result.full,
      rewardCount: result.rewardCount,
      collaboratorCount: result.collaboratorCount,
      message: result.message,
      recentErrors,
    }, { status: result.ok ? 200 : 502 });
  }

  if (body.action === 'kicktraq_import') {
    const creatorSlug = project.creator_slug || extractCreatorSlug(project.source_url ?? '');
    const projectSlug = project.slug || extractProjectSlug(project.source_url ?? '');
    if (!creatorSlug || !projectSlug) {
      return NextResponse.json({ ok: false, error: 'Cannot derive Kicktraq URL for this project.' }, { status: 422 });
    }

    const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    if (!days.length) {
      if ((diagnostics.zeroRowsRejected ?? 0) > 0) deleteKicktraqSnapshots(projectId);
      const hasOcr = Boolean(getOptionalEnv('QWEN_API_KEY') || getOptionalEnv('OPENAI_API_KEY') || getOptionalEnv('ANTHROPIC_API_KEY'));
      return NextResponse.json({
        ok: false,
        action: body.action,
        noData: true,
        message: hasOcr
          ? `No usable Kicktraq rows parsed. page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, image=${diagnostics.imageStatus ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}.`
          : 'OCR provider key is not available in this Railway service.',
        diagnostics,
      }, { status: 422 });
    }

    const writtenSnapshots = storeKicktraqDays(projectId, days);
    return NextResponse.json({
      ok: true,
      action: body.action,
      days: days.length,
      writtenSnapshots,
      diagnostics,
    });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
