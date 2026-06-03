import { NextRequest, NextResponse } from 'next/server';
import { getLiveIntel } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    // Guests get a short preview (top few per list, no category filter); the
    // detailed blocks are gated in the UI and capped here on the server too.
    const limit = isGuest ? 5 : parseInt(req.nextUrl.searchParams.get('limit') ?? '12');
    const categoryParent = isGuest ? undefined : (req.nextUrl.searchParams.get('categoryParent')?.trim() || undefined);
    return NextResponse.json(getLiveIntel(limit, { categoryParent }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
