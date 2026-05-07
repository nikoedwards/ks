import { NextRequest, NextResponse } from 'next/server';
import { createUser, createSession, usernameExists, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { username, password, email } = await req.json();
    if (!username || !password) return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });
    if (username.length < 2) return NextResponse.json({ error: 'Username must be at least 2 characters.' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    if (usernameExists(username)) return NextResponse.json({ error: 'Username already taken.' }, { status: 409 });

    const user = createUser(username, password, email);
    const token = createSession(user.id);

    const res = NextResponse.json({ user: { id: user.id, username: user.username } });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400,
    });
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
