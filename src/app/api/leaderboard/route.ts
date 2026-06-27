import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getLeaderboardCategoryOptions, type LeaderboardProject } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import { getIndiegogoLeaderboard, getIndiegogoRawCategories, type IndiegogoLeaderboardRow } from '@/lib/platformProjects';
import { UNIFIED_CATEGORIES, rawCategoriesForUnified, isUnifiedCategory, type UnifiedCategory } from '@/lib/categoryMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlatformView = 'global' | 'kickstarter' | 'indiegogo';

function parseNumber(value: string | null, fallback?: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePlatform(value: string | null): PlatformView {
  if (value === 'global' || value === 'indiegogo') return value;
  return 'kickstarter';
}

type AnyLbRow = (LeaderboardProject | IndiegogoLeaderboardRow) & { platform?: 'kickstarter' | 'indiegogo' };

const emptyLeaderboardExtras = {
  creatorsByPledged: [], creatorsByCount: [], creatorsByAverage: [],
  agenciesByPledged: [], agenciesByCount: [], agenciesByAverage: [],
};

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    const sp = req.nextUrl.searchParams;
    const dateFrom = parseNumber(sp.get('dateFrom'));
    const dateTo = parseNumber(sp.get('dateTo'));
    const platform = isGuest ? 'kickstarter' : parsePlatform(sp.get('platform'));
    const categoryParent = isGuest ? undefined : (sp.get('categoryParent') || undefined);
    const categoryName = isGuest ? undefined : (sp.get('categoryName') || undefined);
    const limit = isGuest ? 20 : parseNumber(sp.get('limit'), 25);

    // -------- Kickstarter only (default) --------
    if (platform === 'kickstarter') {
      const ranking = getLeaderboard({ dateFrom, dateTo, categoryParent, categoryName, limit });
      const categories = getLeaderboardCategoryOptions({ dateFrom, dateTo });
      const rows = (arr: LeaderboardProject[]) => arr.map(r => ({ ...r, platform: 'kickstarter' as const }));
      return NextResponse.json({
        ...ranking,
        byPledged: rows(ranking.byPledged),
        byBackers: rows(ranking.byBackers),
        categories,
        platform,
        generatedAt: Math.floor(Date.now() / 1000),
      });
    }

    // -------- Indiegogo only --------
    if (platform === 'indiegogo') {
      const board = getIndiegogoLeaderboard({ dateFrom, dateTo, rawCategory: categoryParent, limit: limit ?? 25 });
      const categories = getIndiegogoRawCategories().map(c => ({ category_parent: c.category, category_name: null, total: c.count }));
      return NextResponse.json({
        byPledged: board.byPledged,
        byBackers: board.byBackers,
        ...emptyLeaderboardExtras,
        categories,
        summary: board.summary,
        platform,
        generatedAt: Math.floor(Date.now() / 1000),
      });
    }

    // -------- Global (Kickstarter + Indiegogo merged) --------
    const unified: UnifiedCategory | undefined = isUnifiedCategory(categoryParent) ? (categoryParent as UnifiedCategory) : undefined;
    const ks = getLeaderboard({
      dateFrom,
      dateTo,
      categoryParents: unified ? rawCategoriesForUnified('kickstarter', unified) : undefined,
      limit: limit ?? 25,
    });
    const igg = getIndiegogoLeaderboard({ dateFrom, dateTo, unifiedCategory: unified, limit: limit ?? 25 });

    const ksByPledged: AnyLbRow[] = ks.byPledged.map(r => ({ ...r, platform: 'kickstarter' as const }));
    const ksByBackers: AnyLbRow[] = ks.byBackers.map(r => ({ ...r, platform: 'kickstarter' as const }));
    const take = limit ?? 25;
    const byPledged = [...ksByPledged, ...igg.byPledged]
      .sort((a, b) => Number(b.pledged_usd ?? 0) - Number(a.pledged_usd ?? 0))
      .slice(0, take);
    const byBackers = [...ksByBackers, ...igg.byBackers]
      .sort((a, b) => Number(b.backers_count ?? 0) - Number(a.backers_count ?? 0))
      .slice(0, take);

    const total_projects = ks.summary.total_projects + igg.summary.total_projects;
    const total_pledged_usd = ks.summary.total_pledged_usd + igg.summary.total_pledged_usd;
    const total_backers = ks.summary.total_backers + igg.summary.total_backers;
    const avg_funded_pct = total_projects > 0
      ? Math.round(((ks.summary.avg_funded_pct * ks.summary.total_projects + igg.summary.avg_funded_pct * igg.summary.total_projects) / total_projects) * 10) / 10
      : 0;

    const categories = UNIFIED_CATEGORIES.map(c => ({ category_parent: c, category_name: null, total: 0 }));

    return NextResponse.json({
      byPledged,
      byBackers,
      ...emptyLeaderboardExtras,
      categories,
      summary: { total_projects, total_pledged_usd, total_backers, avg_funded_pct },
      platform,
      generatedAt: Math.floor(Date.now() / 1000),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
