import { NextRequest, NextResponse } from 'next/server';
import { getLiveIntel } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '12');
    const categoryParent = req.nextUrl.searchParams.get('categoryParent')?.trim() || undefined;
    return NextResponse.json(getLiveIntel(limit, { categoryParent }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
