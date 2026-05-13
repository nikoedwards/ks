import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboard, getLeaderboardCategoryOptions } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseNumber(value: string | null, fallback?: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateFrom = parseNumber(sp.get('dateFrom'));
    const dateTo = parseNumber(sp.get('dateTo'));
    const categoryParent = sp.get('categoryParent') || undefined;
    const categoryName = sp.get('categoryName') || undefined;
    const limit = parseNumber(sp.get('limit'), 25);
    const filters = { dateFrom, dateTo, categoryParent, categoryName, limit };
    const ranking = getLeaderboard(filters);
    const categories = getLeaderboardCategoryOptions({ dateFrom, dateTo });
    return NextResponse.json({ ...ranking, categories, generatedAt: Math.floor(Date.now() / 1000) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
