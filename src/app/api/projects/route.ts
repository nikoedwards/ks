import { NextRequest, NextResponse } from 'next/server';
import { getProjects, getCategoryList, getCountryList, getLeaderboardCategoryOptions } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const result = await getProjects({
      state: sp.get('state') ?? undefined,
      category: sp.get('category') ?? undefined,
      categoryName: sp.get('categoryName') ?? undefined,
      country: sp.get('country') ?? undefined,
      serviceAgency: sp.get('serviceAgency') ?? undefined,
      search: sp.get('search') ?? undefined,
      sort: sp.get('sort') ?? undefined,
      sortDir: (sp.get('sortDir') as 'asc' | 'desc') || 'desc',
      page: parseInt(sp.get('page') ?? '1'),
      limit: Math.min(parseInt(sp.get('limit') ?? '20'), 100),
      dateFrom: sp.get('dateFrom') ? parseInt(sp.get('dateFrom')!) : undefined,
      dateTo: sp.get('dateTo') ? parseInt(sp.get('dateTo')!) : undefined,
    });
    const categories = await getCategoryList();
    const countries = await getCountryList();
    const categoryOptions = getLeaderboardCategoryOptions();
    return NextResponse.json({ ...result, categories, categoryOptions, countries });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
