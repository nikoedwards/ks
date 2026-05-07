import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getProjectById } from '@/lib/db';
import { extractCreatorSlug, scrapeKicktraq, storeKicktraqDays } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const project = await getProjectById(id) as { source_url?: string; slug?: string } | null;
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const creatorSlug = extractCreatorSlug(project.source_url ?? '');
  const projectSlug = project.slug;
  if (!creatorSlug || !projectSlug) {
    return NextResponse.json({ error: 'Cannot derive Kicktraq URL from this project' }, { status: 422 });
  }

  const days = await scrapeKicktraq(creatorSlug, projectSlug);
  if (!days.length) {
    return NextResponse.json({ ok: false, message: 'No data found on Kicktraq for this project' });
  }

  storeKicktraqDays(id, days);
  return NextResponse.json({ ok: true, days: days.length });
}
