import { NextRequest, NextResponse } from 'next/server';
import { verifyUser, createSession, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    if (!username || !password) return NextResponse.json({ error: 'Username and password are required.' }, { status: 400 });

    const user = verifyUser(username, password);
    if (!user) return NextResponse.json({ error: 'Invalid username or password.' }, { status: 401 });

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
