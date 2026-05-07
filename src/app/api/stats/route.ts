import { NextResponse } from 'next/server';
import { getStats, getStateDistribution, getProjectCount } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const total = await getProjectCount();
    if (total === 0) return NextResponse.json({ empty: true });
    const stats = await getStats();
    const stateDistribution = await getStateDistribution();
    return NextResponse.json({ stats, stateDistribution });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
