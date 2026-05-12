import { NextRequest, NextResponse } from 'next/server';
import { verifyUserByEmail, verifyUser, createSession, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, password, username } = await req.json();
    if (!password) return NextResponse.json({ error: 'Password is required.' }, { status: 400 });

    // Support both email-based (new) and username-based (legacy) login
    const user = email
      ? verifyUserByEmail(email, password)
      : username
      ? verifyUser(username, password)
      : null;

    if (!user) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });

    const token = createSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
