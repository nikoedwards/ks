import { NextRequest, NextResponse } from 'next/server';
import { getStats, getStateDistribution, getProjectCount } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filter = {
      dateFrom: sp.get('dateFrom') ? parseInt(sp.get('dateFrom')!) : undefined,
      dateTo: sp.get('dateTo') ? parseInt(sp.get('dateTo')!) : undefined,
    };
    const total = await getProjectCount();
    if (total === 0) return NextResponse.json({ empty: true });
    const stats = await getStats(filter);
    const stateDistribution = await getStateDistribution(filter);
    return NextResponse.json({ stats, stateDistribution });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
