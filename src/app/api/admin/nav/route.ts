import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getAllNavSettings, updateNavSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ items: getAllNavSettings() });
}

export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { items?: { nav_key: string; sort_order: number; admin_visible: number; user_visible: number }[] };
  updateNavSettings(body.items ?? []);
  return NextResponse.json({ ok: true, items: getAllNavSettings() });
}
