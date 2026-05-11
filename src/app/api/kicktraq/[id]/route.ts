import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getProjectById } from '@/lib/db';
import { extractCreatorSlug, extractProjectSlug, scrapeKicktraq, storeKicktraqDays } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const user = token ? getSessionUser(token) : null;
    if (!user) return NextResponse.json({ ok: false, message: 'Please sign in to import data.' }, { status: 401 });

    const project = await getProjectById(id) as { source_url?: string; slug?: string; creator_slug?: string } | null;
    if (!project) return NextResponse.json({ ok: false, message: 'Project not found.' }, { status: 404 });

    const sourceUrl = project.source_url ?? '';
    const creatorSlug = project.creator_slug || extractCreatorSlug(sourceUrl);
    const projectSlug = project.slug || extractProjectSlug(sourceUrl);

    if (!creatorSlug || !projectSlug) {
      return NextResponse.json({
        ok: false,
        message: `Cannot derive Kicktraq URL — creator slug: "${creatorSlug || '(missing)'}", project slug: "${projectSlug || '(missing)'}". Re-sync data to fix.`
      }, { status: 422 });
    }

    const days = await scrapeKicktraq(creatorSlug, projectSlug);
    if (!days.length) {
      return NextResponse.json({
        ok: false,
        noData: true,
        message: `No chart data found on Kicktraq for this project.`,
      });
    }

    storeKicktraqDays(id, days);
    return NextResponse.json({ ok: true, days: days.length });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
