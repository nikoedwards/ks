import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
  listAwards, getAwardYears, getAwardsWithWinners,
  setAwardWinner, clearAwardWinner, updateAward, searchProjectsForAward,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const search = req.nextUrl.searchParams.get('search');
  if (search != null) {
    return NextResponse.json({ results: searchProjectsForAward(search) });
  }
  const years = getAwardYears();
  const yearParam = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isFinite(yearParam) && yearParam > 0 ? yearParam : (years[0] ?? new Date().getFullYear());
  return NextResponse.json({
    awards: listAwards(),
    winners: getAwardsWithWinners(year),
    years,
    year,
  });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    action?: 'set_winner' | 'clear_winner' | 'update_award';
    awardKey?: string;
    year?: number;
    projectId?: string;
    citationCn?: string;
    citationEn?: string;
    enabled?: boolean;
    nameCn?: string;
    nameEn?: string;
    taglineCn?: string;
    taglineEn?: string;
    philosophyCn?: string;
    philosophyEn?: string;
  };

  if (!body.awardKey) return NextResponse.json({ error: 'awardKey required' }, { status: 400 });

  if (body.action === 'clear_winner') {
    if (!body.year) return NextResponse.json({ error: 'year required' }, { status: 400 });
    clearAwardWinner(body.awardKey, body.year);
  } else if (body.action === 'update_award') {
    updateAward({
      awardKey: body.awardKey,
      enabled: body.enabled == null ? undefined : (body.enabled ? 1 : 0),
      nameCn: body.nameCn, nameEn: body.nameEn,
      taglineCn: body.taglineCn, taglineEn: body.taglineEn,
      philosophyCn: body.philosophyCn, philosophyEn: body.philosophyEn,
    });
  } else {
    // set_winner (default)
    if (!body.year || !body.projectId) return NextResponse.json({ error: 'year and projectId required' }, { status: 400 });
    setAwardWinner({
      awardKey: body.awardKey,
      year: body.year,
      projectId: body.projectId,
      citationCn: body.citationCn,
      citationEn: body.citationEn,
    });
  }

  const years = getAwardYears();
  const year = body.year ?? (years[0] ?? new Date().getFullYear());
  return NextResponse.json({ ok: true, awards: listAwards(), winners: getAwardsWithWinners(year), years, year });
}
