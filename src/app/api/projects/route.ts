import { NextRequest, NextResponse } from 'next/server';
import { getProjects, getCategoryList, getCountryList, getLeaderboardCategoryOptions } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import {
  listIndiegogoProjects,
  getIndiegogoRawCategories,
  type UnifiedProjectRow,
} from '@/lib/platformProjects';
import {
  UNIFIED_CATEGORIES,
  rawCategoriesForUnified,
  toUnifiedCategory,
  isUnifiedCategory,
  type UnifiedCategory,
} from '@/lib/categoryMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlatformView = 'global' | 'kickstarter' | 'indiegogo';

function parsePlatform(value: string | null): PlatformView {
  if (value === 'global' || value === 'indiegogo') return value;
  return 'kickstarter';
}

// Tag a raw Kickstarter list row with platform metadata so merged/global views
// can branch on it. Keeps the original fields intact.
function tagKsRow(row: Record<string, unknown>): UnifiedProjectRow {
  const tagged = row as unknown as UnifiedProjectRow;
  tagged.platform = 'kickstarter';
  tagged.unified_category = toUnifiedCategory('kickstarter', (row.category_parent as string) ?? null);
  return tagged;
}

// Value used to merge-sort rows across platforms in global mode.
function sortValue(row: UnifiedProjectRow, sort: string): number {
  switch (sort) {
    case 'backers': return Number(row.live_backers_count ?? row.backers_count ?? 0);
    case 'goal': return Number(row.goal ?? 0);
    case 'launched': return Number(row.launched_at ?? 0);
    case 'funding_rate': {
      const pledged = Number(row.live_pledged_usd ?? row.usd_pledged ?? 0);
      const goal = Number(row.goal ?? 0);
      return goal > 0 ? pledged / goal : 0;
    }
    case 'usd_pledged':
    default: return Number(row.live_pledged_usd ?? row.usd_pledged ?? 0);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    const sp = req.nextUrl.searchParams;

    // Guests only get the default first page, or a small capped search teaser
    // (powers the public landing-page search box). Kickstarter-only; no platform
    // switching, category/country/sort/date filters, or deep pagination.
    if (isGuest) {
      const guestSearch = (sp.get('search') ?? '').trim().slice(0, 80);
      const result = await getProjects({
        search: guestSearch || undefined,
        state: guestSearch ? undefined : 'live',
        sort: 'usd_pledged',
        sortDir: 'desc',
        page: 1,
        limit: guestSearch ? 5 : 20,
      });
      const categories = await getCategoryList();
      const countries = await getCountryList();
      const categoryOptions = getLeaderboardCategoryOptions();
      return NextResponse.json({ ...result, platform: 'kickstarter', categories, categoryOptions, countries });
    }

    const platform = parsePlatform(sp.get('platform'));
    const state = sp.get('state') ?? undefined;
    const search = sp.get('search') ?? undefined;
    const sort = sp.get('sort') ?? 'usd_pledged';
    const sortDir = (sp.get('sortDir') as 'asc' | 'desc') || 'desc';
    const page = Math.max(1, parseInt(sp.get('page') ?? '1'));
    const limit = Math.min(parseInt(sp.get('limit') ?? '20'), 100);
    const dateFrom = sp.get('dateFrom') ? parseInt(sp.get('dateFrom')!) : undefined;
    const dateTo = sp.get('dateTo') ? parseInt(sp.get('dateTo')!) : undefined;

    // -------- Kickstarter only (default) --------
    if (platform === 'kickstarter') {
      const result = await getProjects({
        state,
        category: sp.get('category') ?? undefined,
        categoryName: sp.get('categoryName') ?? undefined,
        country: sp.get('country') ?? undefined,
        serviceAgency: sp.get('serviceAgency') ?? undefined,
        search,
        sort,
        sortDir,
        page,
        limit,
        dateFrom,
        dateTo,
      });
      const rows = (result.rows as Record<string, unknown>[]).map(tagKsRow);
      const categories = await getCategoryList();
      const countries = await getCountryList();
      const categoryOptions = getLeaderboardCategoryOptions();
      return NextResponse.json({ ...result, rows, platform, categories, categoryOptions, countries });
    }

    // -------- Indiegogo only --------
    if (platform === 'indiegogo') {
      const result = listIndiegogoProjects({
        state,
        rawCategory: sp.get('category') ?? undefined,
        search,
        sort,
        sortDir,
        page,
        limit,
        dateFrom,
        dateTo,
      });
      const categories = getIndiegogoRawCategories().map(c => c.category);
      return NextResponse.json({
        total: result.total,
        rows: result.rows,
        page,
        limit,
        platform,
        categories,
        categoryOptions: [],
        countries: [],
      });
    }

    // -------- Global (Kickstarter + Indiegogo merged) --------
    const unifiedRaw = sp.get('category') ?? undefined; // in global mode `category` carries a unified parent
    const unified: UnifiedCategory | undefined = isUnifiedCategory(unifiedRaw) ? (unifiedRaw as UnifiedCategory) : undefined;
    const window = page * limit; // fetch enough from each side to paginate correctly after merge

    const ksResult = await getProjects({
      state,
      categoryParents: unified ? rawCategoriesForUnified('kickstarter', unified) : undefined,
      search,
      sort,
      sortDir,
      page: 1,
      limit: window,
      dateFrom,
      dateTo,
    });
    const iggResult = listIndiegogoProjects({
      state,
      unifiedCategory: unified,
      search,
      sort,
      sortDir,
      page: 1,
      limit: window,
      dateFrom,
      dateTo,
    });

    const ksRows = (ksResult.rows as Record<string, unknown>[]).map(tagKsRow);
    const merged = [...ksRows, ...iggResult.rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    merged.sort((a, b) => (sortValue(a, sort) - sortValue(b, sort)) * dir);
    const pageRows = merged.slice((page - 1) * limit, (page - 1) * limit + limit);

    return NextResponse.json({
      total: ksResult.total + iggResult.total,
      rows: pageRows,
      page,
      limit,
      platform,
      unified: true,
      categories: [...UNIFIED_CATEGORIES],
      categoryOptions: [],
      countries: [],
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
