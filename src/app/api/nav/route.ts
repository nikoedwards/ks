import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getNavSettings } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  const role = user?.role === 'admin' ? 'admin' : 'user';
  return NextResponse.json({ role, items: getNavSettings(role) });
}
