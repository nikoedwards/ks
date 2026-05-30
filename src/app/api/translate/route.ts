import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Translate short strings (Kickstarter project titles) using Google's public,
 * key-free machine-translation endpoint. This replaces the previous LLM-based
 * approach (Qwen/OpenAI), which was unstable: it could mangle brand/product
 * names, return a wrong-length array, time out, or require a paid key. Plain MT
 * is fast, deterministic enough, and keeps most brand names intact.
 */
async function googleTranslate(text: string, target: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(trimmed)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return text;
    // Response shape: [[["译文","original",...], ...], ...]
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return text;
    const segments = data[0] as unknown[];
    const out = segments
      .map(seg => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : ''))
      .join('');
    return out.trim() || text;
  } catch {
    return text;
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { texts?: string[]; target?: string };
    const texts = (body.texts ?? []).filter(t => typeof t === 'string').slice(0, 30);
    if (!texts.length) return NextResponse.json({ translations: [] });

    const target = body.target === 'zh-CN' ? 'zh-CN' : body.target;
    // Only Chinese is requested by the UI today; for anything else return as-is.
    if (target !== 'zh-CN') return NextResponse.json({ translations: texts });

    const translations = await mapWithConcurrency(texts, 8, t => googleTranslate(t, 'zh-CN'));
    return NextResponse.json({ translations });
  } catch {
    return NextResponse.json({ translations: [] });
  }
}
