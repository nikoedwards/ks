import { NextRequest, NextResponse } from 'next/server';
import { getCountries } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import { getIndiegogoAnalysisCountries, type AnalysisCountryRow } from '@/lib/platformProjects';
import { mergeCountries } from '@/lib/analysisMerge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parsePlatform(value: string | null) {
  if (value === 'global' || value === 'indiegogo') return value;
  return 'kickstarter';
}

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    if (isGuest) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('dateFrom') ? Number(sp.get('dateFrom')) : undefined;
    const dateTo   = sp.get('dateTo')   ? Number(sp.get('dateTo'))   : undefined;
    const platform = parsePlatform(sp.get('platform'));

    if (platform === 'indiegogo') {
      return NextResponse.json({ data: getIndiegogoAnalysisCountries({ dateFrom, dateTo }) });
    }
    if (platform === 'global') {
      const ks = await getCountries({ dateFrom, dateTo }) as AnalysisCountryRow[];
      const igg = getIndiegogoAnalysisCountries({ dateFrom, dateTo });
      return NextResponse.json({ data: mergeCountries(ks, igg) });
    }
    const data = await getCountries({ dateFrom, dateTo });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
