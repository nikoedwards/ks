import { NextRequest, NextResponse } from 'next/server';
import { verifyOtp, getUserByEmail, createSession, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 });

    const valid = verifyOtp(email, code);
    if (!valid) return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 401 });

    const user = getUserByEmail(email);
    if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

    const token = createSession(user.id);
    const res = NextResponse.json({ user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
