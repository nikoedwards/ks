import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
  getProjectById,
  getRecentCrawlerErrors,
  getTrackingSettings,
  getUserProjectSubscription,
  removeUserProjectSubscription,
  upsertUserProjectSubscription,
} from '@/lib/db';
import { buildKSJsonUrl, extractCreatorSlug, extractProjectSlug, scrapeAndStore } from '@/lib/scraper';
import { initTracker } from '@/lib/tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

initTracker();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  const platformSettings = getTrackingSettings(id);
  const userSubscription = user ? getUserProjectSubscription(user.id, id) : null;
  const settings = userSubscription
    ? { ...(platformSettings ?? {}), ...userSubscription }
    : user && platformSettings
      ? { ...platformSettings, is_tracking: 0 }
      : platformSettings;
  return NextResponse.json({ settings: settings ?? null, platformSettings, userSubscription });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  upsertUserProjectSubscription(user.id, id, {
    is_tracking: typeof body.is_tracking === 'number' ? body.is_tracking : 1,
    track_rewards: typeof body.track_rewards === 'number' ? body.track_rewards : undefined,
    track_comments: typeof body.track_comments === 'number' ? body.track_comments : undefined,
    analyze_comments: typeof body.analyze_comments === 'number' ? body.analyze_comments : undefined,
    track_text_diff: typeof body.track_text_diff === 'number' ? body.track_text_diff : undefined,
    priority: typeof body.priority === 'number' ? body.priority : undefined,
  });
  return NextResponse.json({
    ok: true,
    settings: getUserProjectSubscription(user.id, id),
    platformSettings: getTrackingSettings(id),
  });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  removeUserProjectSubscription(user.id, id);
  return NextResponse.json({ ok: true });
}

// POST /api/track/[id] ? trigger immediate scrape
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const project = await getProjectById(id) as { source_url?: string; creator_slug?: string; slug?: string } | null;
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

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
  if (!jsonUrl) return NextResponse.json({ error: 'No valid KS URL for this project' }, { status: 422 });

  const result = await scrapeAndStore(id, jsonUrl, {
    track_rewards: 1,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok && result.full ? [] : getRecentCrawlerErrors({
    projectId: id,
    urls: [jsonUrl, pageUrl],
    limit: 4,
  });
  const latestDetail = result.message ?? recentErrors[0]?.message;

  return NextResponse.json({
    ok: result.ok,
    scraped: result.ok,
    full: result.full,
    source: result.source,
    rewardCount: result.rewardCount,
    collaboratorCount: result.collaboratorCount,
    message: result.ok
      ? result.full
        ? 'Synced from Kickstarter.'
        : 'Synced basic project fields only.'
      : 'Kickstarter project sync failed.',
    detail: latestDetail ?? null,
    recentErrors,
  });
}
