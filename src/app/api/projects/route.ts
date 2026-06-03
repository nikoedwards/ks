import { NextRequest, NextResponse } from 'next/server';
import { getProjects, getCategoryList, getCountryList, getLeaderboardCategoryOptions } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    const sp = req.nextUrl.searchParams;
    // Guests only get the default first page, or a small capped search teaser
    // (powers the public landing-page search box). No category/country/sort/
    // date filters and no deep pagination — the server backstop for the
    // client-side gate so the list can't be scraped or bulk-exported via the API.
    const guestSearch = (sp.get('search') ?? '').trim().slice(0, 80);
    const result = await getProjects(isGuest ? {
      search: guestSearch || undefined,
      state: guestSearch ? undefined : 'live',
      sort: 'usd_pledged',
      sortDir: 'desc',
      page: 1,
      limit: guestSearch ? 5 : 20,
    } : {
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
