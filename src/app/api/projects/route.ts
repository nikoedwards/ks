import { NextRequest, NextResponse } from 'next/server';
import { getProjects, getCategoryList, getCountryList } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const result = await getProjects({
      state: sp.get('state') ?? undefined,
      category: sp.get('category') ?? undefined,
      country: sp.get('country') ?? undefined,
      search: sp.get('search') ?? undefined,
      sort: sp.get('sort') ?? undefined,
      page: parseInt(sp.get('page') ?? '1'),
      limit: Math.min(parseInt(sp.get('limit') ?? '20'), 100),
    });
    const categories = await getCategoryList();
    const countries = await getCountryList();
    return NextResponse.json({ ...result, categories, countries });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
