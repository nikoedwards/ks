import { NextRequest, NextResponse } from 'next/server';
import { getTimeAnalysis } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const { yearly, monthly } = getTimeAnalysis({
      categoryParent: sp.get('categoryParent') || undefined,
      categoryName: sp.get('categoryName') || undefined,
      country: sp.get('country') || undefined,
    });
    return NextResponse.json({ data: yearly, monthly });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
