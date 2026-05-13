import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getProjectById } from '@/lib/db';
import { extractCreatorSlug, extractProjectSlug, getOptionalEnv, scrapeKicktraqDetailed, storeKicktraqDays } from '@/lib/scraper';

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

    const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    if (!days.length) {
      const hasOpenAI = !!getOptionalEnv('OPENAI_API_KEY');
      const hasAnthropic = !!getOptionalEnv('ANTHROPIC_API_KEY');
      const hasOcr = hasOpenAI || hasAnthropic;
      return NextResponse.json({
        ok: false,
        noData: true,
        _v: 'ocr-v1',
        message: hasOcr
          ? `OCR is enabled, but no usable Daily Data rows were parsed. Diagnostics: page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, htmlRows=${diagnostics.htmlRows ?? 0}, image=${diagnostics.imageStatus ?? '-'} ${diagnostics.imageContentType ?? ''}, imageBytes=${diagnostics.imageBytes ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}, ocrRows=${diagnostics.ocrRows ?? 0}. ${diagnostics.reason ?? ''}`
          : 'The running Railway service cannot read OPENAI_API_KEY or ANTHROPIC_API_KEY. If you already added it in Railway, redeploy or restart this same service/environment, then import again.',
        diagnostics,
      });
    }

    storeKicktraqDays(id, days);
    return NextResponse.json({ ok: true, days: days.length, _v: 'ocr-v1' });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
