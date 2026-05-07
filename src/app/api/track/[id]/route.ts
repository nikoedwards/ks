import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getTrackingSettings, upsertTrackingSettings, getProjectById } from '@/lib/db';
import { buildKSJsonUrl, scrapeAndStore } from '@/lib/scraper';
import { initTracker } from '@/lib/tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

initTracker();

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const settings = getTrackingSettings(id);
  return NextResponse.json({ settings: settings ?? null });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  upsertTrackingSettings({ project_id: id, ...body });
  return NextResponse.json({ ok: true, settings: getTrackingSettings(id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  upsertTrackingSettings({ project_id: id, is_tracking: 0 });
  return NextResponse.json({ ok: true });
}

// POST /api/track/[id] → trigger immediate scrape
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const project = await getProjectById(id) as { source_url?: string } | null;
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const jsonUrl = buildKSJsonUrl(project.source_url ?? '');
  if (!jsonUrl) return NextResponse.json({ error: 'No valid KS URL for this project' }, { status: 422 });

  const settings = getTrackingSettings(id);
  const ok = await scrapeAndStore(id, jsonUrl, {
    track_rewards: settings?.track_rewards ?? 1,
    track_text_diff: settings?.track_text_diff ?? 1,
  });

  return NextResponse.json({ ok, scraped: ok });
}
