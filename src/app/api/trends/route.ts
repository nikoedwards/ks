import { NextRequest, NextResponse } from 'next/server';
import { getTrends } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') ? Number(sp.get('dateFrom')) : undefined;
    const dateTo   = sp.get('dateTo')   ? Number(sp.get('dateTo'))   : undefined;
    const data = await getTrends({ dateFrom, dateTo });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
