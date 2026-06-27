import { NextRequest, NextResponse } from 'next/server';
import { getLiveIntel } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import { getIndiegogoLiveIntel, type LiveIntelProject } from '@/lib/platformProjects';
import { UNIFIED_CATEGORIES, isUnifiedCategory, type UnifiedCategory } from '@/lib/categoryMap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PlatformView = 'global' | 'kickstarter' | 'indiegogo';

function parsePlatform(value: string | null): PlatformView {
  if (value === 'global' || value === 'indiegogo') return value;
  return 'kickstarter';
}

type AnyLive = (LiveIntelProject | Record<string, unknown>) & { id: string; pledged_usd?: number; live_backers_count?: number; launched_at?: number | null; deadline?: number | null; funded_pct?: number; platform?: string };

function tagKs<T extends Record<string, unknown>>(rows: T[]): (T & { platform: 'kickstarter' })[] {
  return rows.map(r => ({ ...r, platform: 'kickstarter' as const }));
}

export async function GET(req: NextRequest) {
  try {
    const { isGuest, limited } = guardApi(req);
    if (limited) return limited;
    const sp = req.nextUrl.searchParams;
    const limit = isGuest ? 5 : parseInt(sp.get('limit') ?? '12');
    const platform = isGuest ? 'kickstarter' : parsePlatform(sp.get('platform'));
    const categoryParent = isGuest ? undefined : (sp.get('categoryParent')?.trim() || undefined);

    if (platform === 'kickstarter') {
      const intel = getLiveIntel(limit, { categoryParent });
      return NextResponse.json({
        ...intel,
        fastestFunding: tagKs(intel.fastestFunding as Record<string, unknown>[]),
        fastestBackers: tagKs(intel.fastestBackers as Record<string, unknown>[]),
        newlyLaunched: tagKs(intel.newlyLaunched as Record<string, unknown>[]),
        endingSoon: tagKs(intel.endingSoon as Record<string, unknown>[]),
        overfunded: tagKs(intel.overfunded as Record<string, unknown>[]),
        platform,
      });
    }

    if (platform === 'indiegogo') {
      const intel = getIndiegogoLiveIntel(limit, { rawCategory: categoryParent });
      return NextResponse.json({ ...intel, platform });
    }

    // Global: merge KS + IGG live lists.
    const unified: UnifiedCategory | undefined = isUnifiedCategory(categoryParent) ? (categoryParent as UnifiedCategory) : undefined;
    const ks = getLiveIntel(limit, { categoryParent: undefined });
    const ksSummary = ks.summary as { live_projects: number; pledged_delta_24h: number; backers_delta_24h: number; launched_24h: number; ending_24h: number; overfunded_projects: number };
    const igg = getIndiegogoLiveIntel(limit, { unifiedCategory: unified });

    const ksT = {
      fastestFunding: tagKs(ks.fastestFunding as Record<string, unknown>[]),
      fastestBackers: tagKs(ks.fastestBackers as Record<string, unknown>[]),
      newlyLaunched: tagKs(ks.newlyLaunched as Record<string, unknown>[]),
      endingSoon: tagKs(ks.endingSoon as Record<string, unknown>[]),
      overfunded: tagKs(ks.overfunded as Record<string, unknown>[]),
    };
    const merge = (a: AnyLive[], b: AnyLive[], cmp: (x: AnyLive, y: AnyLive) => number) => [...a, ...b].sort(cmp).slice(0, limit);
    const byPledged = (x: AnyLive, y: AnyLive) => Number(y.pledged_usd ?? 0) - Number(x.pledged_usd ?? 0);
    const byBackers = (x: AnyLive, y: AnyLive) => Number(y.live_backers_count ?? 0) - Number(x.live_backers_count ?? 0);
    const byLaunched = (x: AnyLive, y: AnyLive) => Number(y.launched_at ?? 0) - Number(x.launched_at ?? 0);
    const byDeadline = (x: AnyLive, y: AnyLive) => Number(x.deadline ?? Infinity) - Number(y.deadline ?? Infinity);
    const byFunded = (x: AnyLive, y: AnyLive) => Number(y.funded_pct ?? 0) - Number(x.funded_pct ?? 0);

    return NextResponse.json({
      generatedAt: Math.floor(Date.now() / 1000),
      summary: {
        live_projects: ksSummary.live_projects + igg.summary.live_projects,
        pledged_delta_24h: ksSummary.pledged_delta_24h,
        backers_delta_24h: ksSummary.backers_delta_24h,
        launched_24h: ksSummary.launched_24h + igg.summary.launched_24h,
        ending_24h: ksSummary.ending_24h + igg.summary.ending_24h,
        overfunded_projects: ksSummary.overfunded_projects + igg.summary.overfunded_projects,
      },
      fastestFunding: merge(ksT.fastestFunding as AnyLive[], igg.fastestFunding as AnyLive[], byPledged),
      fastestBackers: merge(ksT.fastestBackers as AnyLive[], igg.fastestBackers as AnyLive[], byBackers),
      newlyLaunched: merge(ksT.newlyLaunched as AnyLive[], igg.newlyLaunched as AnyLive[], byLaunched),
      endingSoon: merge(ksT.endingSoon as AnyLive[], igg.endingSoon as AnyLive[], byDeadline),
      overfunded: merge(ksT.overfunded as AnyLive[], igg.overfunded as AnyLive[], byFunded),
      categories: [],
      allCategories: UNIFIED_CATEGORIES.map(c => ({ category: c })),
      platform,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
