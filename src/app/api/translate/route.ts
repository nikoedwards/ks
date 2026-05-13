import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { texts?: string[]; target?: string };
    const texts = (body.texts ?? []).filter(t => typeof t === 'string').slice(0, 30);
    const target = body.target === 'zh-CN' ? 'Simplified Chinese' : 'English';
    if (!texts.length) return NextResponse.json({ translations: [] });
    if (!process.env.OPENAI_API_KEY?.trim()) return NextResponse.json({ translations: texts });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TEXT_MODEL ?? 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `Translate Kickstarter project titles into ${target}. Keep brand names and product model names unchanged. Return only a JSON array of strings in the same order.`,
          },
          { role: 'user', content: JSON.stringify(texts) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return NextResponse.json({ translations: texts });
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '[]';
    const match = content.match(/\[[\s\S]*\]/);
    const translations = match ? JSON.parse(match[0]) : texts;
    return NextResponse.json({
      translations: Array.isArray(translations) && translations.length === texts.length ? translations : texts,
    });
  } catch {
    return NextResponse.json({ translations: [] });
  }
}
