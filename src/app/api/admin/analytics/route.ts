import { NextRequest, NextResponse } from 'next/server';
import { getAnalyticsOverview } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const daysRaw = Number(req.nextUrl.searchParams.get('days') ?? '30');
  const days = [7, 30, 90].includes(daysRaw) ? daysRaw : 30;
  try {
    return NextResponse.json(getAnalyticsOverview(days));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
