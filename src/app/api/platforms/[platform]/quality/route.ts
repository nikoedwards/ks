import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { isPlatformViewId } from '@/lib/platforms';
import { getPlatformQualityForResponse } from '@/lib/platformDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { platform } = await params;
    if (!isPlatformViewId(platform)) {
      return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 404 });
    }
    return NextResponse.json(await getPlatformQualityForResponse(platform));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
