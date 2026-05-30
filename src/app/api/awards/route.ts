import { NextRequest, NextResponse } from 'next/server';
import { getAwardsWithWinners, getAwardYears } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const years = getAwardYears();
  const yearParam = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearParam) && yearParam > 0
    ? yearParam
    : (years[0] ?? new Date().getFullYear());
  return NextResponse.json({ year, years, awards: getAwardsWithWinners(year) });
}
