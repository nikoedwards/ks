import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/apiAuth';

const MODEL = 'claude-sonnet-4-6';

function extractMeta(html: string, prop: string): string {
  const patterns = [
    new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${prop}"`, 'i'),
    new RegExp(`<meta[^>]+name="${prop}"[^>]+content="([^"]*)"`, 'i'),
    new RegExp(`<meta[^>]+content="([^"]*)"[^>]+name="${prop}"`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return '';
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: NextRequest) {
  // This endpoint calls a paid LLM + scrapes Kickstarter — require login and
  // apply a tight per-user budget to prevent cost abuse.
  const { isGuest, limited } = guardApi(req, { bucket: 'predict', perMin: 6, perHour: 60 });
  if (limited) return limited;
  if (isGuest) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { url, lang = 'cn' } = body as { url?: string; lang?: string };

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (data: object) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      try {
        // Validate URL
        if (!url || !url.includes('kickstarter.com')) {
          send({ type: 'error', message: lang === 'cn' ? '请输入有效的 Kickstarter 链接' : 'Please enter a valid Kickstarter URL' });
          controller.close();
          return;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          send({ type: 'error', message: 'ANTHROPIC_API_KEY is not configured. Add it to .env.local.' });
          controller.close();
          return;
        }

        // Step 1: Fetch page
        send({ type: 'step', label: lang === 'cn' ? '正在获取页面内容...' : 'Fetching page content...', done: false });

        let html = '';
        try {
          const pageRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
              'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(12000),
          });
          if (pageRes.ok) html = await pageRes.text();
        } catch {
          // proceed with empty html — Claude will note the lack of page data
        }

        // Extract content
        const ogTitle = extractMeta(html, 'og:title')
          || html.match(/<title>([^<]*)<\/title>/i)?.[1]
          || '';
        const ogDesc = extractMeta(html, 'og:description') || '';
        const creatorSlug = url.match(/kickstarter\.com\/projects\/([^/?#]+)/)?.[1]?.replace(/-/g, ' ') || '';
        const bodyText = htmlToText(html).slice(0, 2500);

        const title = ogTitle.replace(/\s*[|–—-]\s*Kickstarter.*$/i, '').trim() || url;
        const description = ogDesc.slice(0, 400);

        send({ type: 'project', title, creator: creatorSlug, description });
        send({ type: 'step', label: lang === 'cn' ? '页面内容获取完成' : 'Page content retrieved', done: true });

        // Step 2: AI analysis
        send({ type: 'step', label: lang === 'cn' ? 'AI 正在深度分析中...' : 'AI deep analysis in progress...', done: false });

        const isCn = lang === 'cn';
        const prompt = `You are a Kickstarter crowdfunding expert analyst. Analyze the following pre-launch campaign page and provide a structured scoring.

URL: ${url}
Title: ${title || '(not extracted)'}
Creator/Brand: ${creatorSlug || '(not extracted)'}
Page description: ${description || '(not extracted)'}
Page content excerpt: ${bodyText ? bodyText.slice(0, 1800) : '(page could not be fetched)'}

Score this campaign on exactly 5 dimensions (0–20 each). Be specific and evidence-based. If page content is limited, note that and score conservatively.

${isCn ? 'Write the "reasoning" field in Chinese (中文). Write the "verdict" field in Chinese.' : 'Write all text fields in English.'}

Respond with ONLY valid JSON, no extra text:
{
  "dimensions": [
    {"key":"brand","label_cn":"品牌背景","label_en":"Brand Credibility","score":0,"max":20,"reasoning":"..."},
    {"key":"concept","label_cn":"产品清晰度","label_en":"Concept Clarity","score":0,"max":20,"reasoning":"..."},
    {"key":"market","label_cn":"市场契合度","label_en":"Market Fit","score":0,"max":20,"reasoning":"..."},
    {"key":"prelaunch","label_cn":"预热质量","label_en":"Pre-launch Quality","score":0,"max":20,"reasoning":"..."},
    {"key":"risk","label_cn":"风险评估","label_en":"Risk Assessment","score":0,"max":20,"reasoning":"..."}
  ],
  "total": 0,
  "prediction": "uncertain",
  "verdict": "...",
  "highlights": ["...","..."],
  "concerns": ["...","..."]
}

Scoring guide:
- brand (0-20): established brand vs new creator, prior Kickstarter history, creator credibility signals
- concept (0-20): product description clarity, innovation, unique value proposition
- market (0-20): category fit with Kickstarter successful patterns, target audience definition, pricing signals
- prelaunch (0-20): page quality, content completeness, any visible traction (followers/community)
- risk (0-20): technical feasibility, execution complexity, red flags (higher = lower risk)
- total: sum of all 5 dimension scores
- prediction: "likely_success" (>=65), "uncertain" (40-64), or "likely_fail" (<40)
- highlights: 2-3 positive points
- concerns: 2-3 risk factors`;

        const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1200,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(90000),
        });

        if (!claudeRes.ok) {
          const errText = await claudeRes.text().catch(() => '');
          send({ type: 'error', message: `Claude API error ${claudeRes.status}: ${errText.slice(0, 200)}` });
          controller.close();
          return;
        }

        const claudeData = await claudeRes.json();
        const responseText: string = claudeData.content?.[0]?.text ?? '';

        // Parse JSON from Claude response
        interface AnalysisResult {
          dimensions: Array<{
            key: string;
            label_cn: string;
            label_en: string;
            score: number;
            max: number;
            reasoning: string;
          }>;
          total: number;
          prediction: string;
          verdict: string;
          highlights: string[];
          concerns: string[];
        }
        let result: AnalysisResult;
        try {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          result = JSON.parse(jsonMatch?.[0] ?? responseText);
        } catch {
          send({ type: 'error', message: 'Failed to parse analysis result. Raw: ' + responseText.slice(0, 300) });
          controller.close();
          return;
        }

        send({ type: 'step', label: lang === 'cn' ? '分析完成' : 'Analysis complete', done: true });

        // Send each dimension with a small delay for animation
        for (const dim of (result.dimensions ?? [])) {
          send({ type: 'dimension', ...dim });
          await new Promise(r => setTimeout(r, 250));
        }

        // Compute total from dimensions if not present
        const computedTotal = result.dimensions?.reduce((s: number, d: { score: number }) => s + (d.score ?? 0), 0) ?? result.total ?? 0;

        send({
          type: 'final',
          total: result.total ?? computedTotal,
          prediction: result.prediction ?? 'uncertain',
          verdict: result.verdict ?? '',
          highlights: result.highlights ?? [],
          concerns: result.concerns ?? [],
        });

        controller.close();
      } catch (e: unknown) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
