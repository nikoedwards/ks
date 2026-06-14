import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { PLATFORMS, PLATFORM_VIEWS } from '@/lib/platforms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({
    platforms: PLATFORMS,
    views: PLATFORM_VIEWS,
  });
}
