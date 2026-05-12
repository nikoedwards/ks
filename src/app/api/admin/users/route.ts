import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getUserAdminDashboard, updateUserRole } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json(getUserAdminDashboard());
}

export async function PATCH(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { userId?: number; role?: 'admin' | 'user' };
  if (!body.userId || !body.role) return NextResponse.json({ error: 'userId and role required' }, { status: 400 });
  if (body.userId === admin.id && body.role !== 'admin') {
    return NextResponse.json({ error: 'You cannot demote yourself.' }, { status: 400 });
  }
  updateUserRole(body.userId, body.role);
  return NextResponse.json({ ok: true });
}
