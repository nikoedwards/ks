import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getOptionalEnv(name: string) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { texts?: string[]; target?: string };
    const texts = (body.texts ?? []).filter(t => typeof t === 'string').slice(0, 30);
    if (!texts.length) return NextResponse.json({ translations: [] });
    if (body.target !== 'zh-CN') return NextResponse.json({ translations: texts });

    const qwenKey = getOptionalEnv('QWEN_API_KEY');
    if (qwenKey) {
      const endpoint = `${getOptionalEnv('QWEN_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${qwenKey}`,
        },
        body: JSON.stringify({
          model: getOptionalEnv('QWEN_TEXT_MODEL') || getOptionalEnv('QWEN_VISION_MODEL') || 'qwen-plus',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content: '把 Kickstarter 项目标题翻译成简体中文。品牌名、型号名、专有产品名和技术缩写尽量保留原文。只返回同顺序 JSON 字符串数组，不要解释。',
            },
            { role: 'user', content: JSON.stringify(texts) },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? '[]';
        const match = content.match(/\[[\s\S]*\]/);
        const translations = match ? JSON.parse(match[0]) : texts;
        return NextResponse.json({
          translations: Array.isArray(translations) && translations.length === texts.length ? translations : texts,
        });
      }
    }

    const openAIKey = getOptionalEnv('OPENAI_API_KEY');
    if (!openAIKey) return NextResponse.json({ translations: texts });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openAIKey}`,
      },
      body: JSON.stringify({
        model: getOptionalEnv('OPENAI_TEXT_MODEL') || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'Translate Kickstarter project titles into Simplified Chinese. Keep brand names, product model names, and technical terms unchanged where appropriate. Return only a JSON array of strings in the same order.',
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
