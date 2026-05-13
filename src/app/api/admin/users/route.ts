import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { adminCreateUser, adminDeleteUser, adminUpdateUser, getUserAdminDashboard, updateUserRole } from '@/lib/db';

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
  const body = await req.json().catch(() => ({})) as {
    userId?: number;
    username?: string;
    email?: string | null;
    password?: string;
    role?: 'admin' | 'user';
    email_verified?: number;
  };
  if (!body.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  if (body.userId === admin.id && body.role && body.role !== 'admin') {
    return NextResponse.json({ error: 'You cannot demote yourself.' }, { status: 400 });
  }
  if (body.role && !body.username && body.email === undefined && !body.password && body.email_verified === undefined) {
    updateUserRole(body.userId, body.role);
  } else {
    adminUpdateUser({ id: body.userId, username: body.username, email: body.email, password: body.password, role: body.role, email_verified: body.email_verified });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    username?: string;
    email?: string;
    password?: string;
    role?: 'admin' | 'user';
    email_verified?: number;
  };
  if (!body.username?.trim() || !body.password?.trim()) {
    return NextResponse.json({ error: 'username and password required' }, { status: 400 });
  }
  const id = adminCreateUser({
    username: body.username,
    email: body.email,
    password: body.password,
    role: body.role,
    email_verified: body.email_verified ?? 1,
  });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const id = Number(req.nextUrl.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });
  if (id === admin.id) return NextResponse.json({ error: 'You cannot delete yourself.' }, { status: 400 });
  adminDeleteUser(id);
  return NextResponse.json({ ok: true });
}
