import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
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
    limit: Number(searchParams.get('limit') || 25),
    offset: Number(searchParams.get('offset') || 0),
  }));
}

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { projectId?: string; action?: string };
  const projectId = body.projectId?.trim();
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId is required' }, { status: 400 });

  const project = await getProjectById(projectId) as {
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
  } | null;
  if (!project) return NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 });

  if (body.action === 'kickstarter_basic_sync' || body.action === 'kickstarter_sync') {
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
      message: result.ok ? (result.message ?? 'Synced Kickstarter basic project fields.') : result.message,
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
