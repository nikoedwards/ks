import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, getFavoriteIds, addFavorite, SESSION_COOKIE } from '@/lib/auth';
import { getProjectById } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ids = getFavoriteIds(user.id);
  const projects = ids.map(id => getProjectById(id)).filter(Boolean);
  return NextResponse.json({ data: projects, ids });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { projectId } = await req.json();
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  addFavorite(user.id, projectId);
  return NextResponse.json({ ok: true });
}
