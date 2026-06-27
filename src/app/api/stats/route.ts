import { NextRequest, NextResponse } from 'next/server';
import { getLandingData, getStats, getStateDistribution, getProjectCount, getLiveSummary, type DashboardStats } from '@/lib/db';
import { getIndiegogoAnalysisStats } from '@/lib/platformProjects';
import { mergeStats, mergeStateDistribution } from '@/lib/analysisMerge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePlatform(value: string | null) {
  if (value === 'global' || value === 'indiegogo') return value;
  return 'kickstarter';
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filter = {
      dateFrom: sp.get('dateFrom') ? parseInt(sp.get('dateFrom')!) : undefined,
      dateTo: sp.get('dateTo') ? parseInt(sp.get('dateTo')!) : undefined,
    };
    const platform = parsePlatform(sp.get('platform'));
    const total = await getProjectCount();
    if (total === 0) return NextResponse.json({ empty: true });
    // landing + live summary stay Kickstarter-derived (homepage widgets).
    const landing = getLandingData();
    const live = getLiveSummary();

    if (platform === 'indiegogo') {
      const igg = getIndiegogoAnalysisStats(filter);
      return NextResponse.json({ stats: igg.stats, stateDistribution: igg.stateDistribution, landing, liveSummary: live.summary });
    }
    if (platform === 'global') {
      const ksStats = await getStats(filter);
      const ksDist = await getStateDistribution(filter);
      const igg = getIndiegogoAnalysisStats(filter);
      return NextResponse.json({
        stats: mergeStats(ksStats, igg.stats),
        stateDistribution: mergeStateDistribution(ksDist, igg.stateDistribution),
        landing,
        liveSummary: live.summary,
      });
    }
    const stats: DashboardStats = await getStats(filter);
    const stateDistribution = await getStateDistribution(filter);
    return NextResponse.json({ stats, stateDistribution, landing, liveSummary: live.summary });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
