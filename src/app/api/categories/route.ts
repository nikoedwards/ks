import { NextRequest, NextResponse } from 'next/server';
import { getCategories } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import { getIndiegogoAnalysisCategories, type AnalysisCategoryRow } from '@/lib/platformProjects';
import { mergeCategoriesUnified } from '@/lib/analysisMerge';

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
      return NextResponse.json({ data: getIndiegogoAnalysisCategories({ dateFrom, dateTo }) });
    }
    if (platform === 'global') {
      const ks = await getCategories({ dateFrom, dateTo }) as AnalysisCategoryRow[];
      const igg = getIndiegogoAnalysisCategories({ dateFrom, dateTo });
      return NextResponse.json({ data: mergeCategoriesUnified(ks, igg) });
    }
    const data = await getCategories({ dateFrom, dateTo });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
