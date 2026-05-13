import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { deleteAnnouncement, listAnnouncements, saveAnnouncement, type AnnouncementInput } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ data: listAnnouncements() });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as AnnouncementInput;
  if (!body.title?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: 'title and body required' }, { status: 400 });
  }
  const id = saveAnnouncement(body);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  deleteAnnouncement(id);
  return NextResponse.json({ ok: true });
}
