import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { deleteKicktraqSnapshots, getProjectById } from '@/lib/db';
import { extractCreatorSlug, extractProjectSlug, getOptionalEnv, scrapeKicktraqDetailed, storeKicktraqDays } from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type KicktraqDebugCacheEntry = {
  ok: boolean;
  days?: number;
  cachedAt: number;
  diagnostics?: unknown;
  debug?: unknown;
  structuredDays?: unknown;
  message?: string;
};

const kicktraqDebugCache = new Map<string, KicktraqDebugCacheEntry>();

function cacheKicktraqDebug(projectId: string, entry: Omit<KicktraqDebugCacheEntry, 'cachedAt'>) {
  kicktraqDebugCache.set(projectId, { ...entry, cachedAt: Date.now() });
  if (kicktraqDebugCache.size > 50) {
    const oldest = kicktraqDebugCache.keys().next().value;
    if (oldest) kicktraqDebugCache.delete(oldest);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ ok: false, message: 'Please sign in to view debug data.' }, { status: 401 });
  const cached = kicktraqDebugCache.get(id);
  if (!cached) return NextResponse.json({ ok: false, message: 'No Kicktraq debug data cached for this project.' }, { status: 404 });
  return NextResponse.json({ ...cached, cacheHit: true });
}

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
      if ((diagnostics.zeroRowsRejected ?? 0) > 0) {
        deleteKicktraqSnapshots(id);
      }
      const hasOpenAI = !!getOptionalEnv('OPENAI_API_KEY');
      const hasQwen = !!getOptionalEnv('QWEN_API_KEY');
      const hasAnthropic = !!getOptionalEnv('ANTHROPIC_API_KEY');
      const hasOcr = hasQwen || hasOpenAI || hasAnthropic;
      const ocrHint = diagnostics.ocrStatus === 429
        ? `${diagnostics.ocrProvider ?? 'OCR'} returned 429, which means the API key is rate-limited or has insufficient quota/billing. Check provider usage, billing, and project limits, then retry.`
        : '';
      const message = hasOcr
        ? `OCR is enabled, but no usable Daily Data rows were parsed. ${ocrHint} Diagnostics: page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, htmlRows=${diagnostics.htmlRows ?? 0}, image=${diagnostics.imageStatus ?? '-'} ${diagnostics.imageContentType ?? ''}, imageBytes=${diagnostics.imageBytes ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}, endpoint=${diagnostics.ocrEndpoint ?? '-'}, timeoutMs=${diagnostics.ocrTimeoutMs ?? '-'}, ocrRows=${diagnostics.ocrRows ?? 0}, fallbackRows=${diagnostics.ocrFallbackRows ?? 0}, zeroRowsRejected=${diagnostics.zeroRowsRejected ?? 0}. ${diagnostics.ocrError ? `OCR error: ${diagnostics.ocrError}.` : ''}${diagnostics.ocrPreview ? ` OCR preview: ${diagnostics.ocrPreview}.` : ''} ${diagnostics.reason ?? ''}`
        : 'The running Railway service cannot read QWEN_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY. If you already added it in Railway, redeploy or restart this same service/environment, then import again.';
      cacheKicktraqDebug(id, { ok: false, diagnostics, debug: diagnostics.debug, message });
      return NextResponse.json({
        ok: false,
        noData: true,
        _v: 'ocr-v1',
        message,
        diagnostics,
      });
    }

    storeKicktraqDays(id, days);
    cacheKicktraqDebug(id, { ok: true, days: days.length, diagnostics, debug: diagnostics.debug, structuredDays: days });
    return NextResponse.json({ ok: true, days: days.length, diagnostics, debug: diagnostics.debug, structuredDays: days, _v: 'ocr-v1' });
  } catch (err) {
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
