import { NextRequest, NextResponse } from 'next/server';
import { getLiveIntel } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '12');
    return NextResponse.json(getLiveIntel(limit));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
