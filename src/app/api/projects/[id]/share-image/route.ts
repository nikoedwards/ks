import { NextResponse } from 'next/server';
import { getProjectById } from '@/lib/db';
import { getIndiegogoProjectById, indiegogoSourceId, isIndiegogoId } from '@/lib/platformProjects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = (isIndiegogoId(id)
      ? getIndiegogoProjectById(indiegogoSourceId(id))
      : await getProjectById(id)) as { image_url?: string | null; image_thumb_url?: string | null } | null;
    const source = project?.image_url || project?.image_thumb_url;
    if (!source) return new NextResponse(null, { status: 404 });

    const url = new URL(source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return new NextResponse(null, { status: 400 });
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kicksonar/1.0)' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || !response.body) return new NextResponse(null, { status: 502 });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return new NextResponse(null, { status: 415 });

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
