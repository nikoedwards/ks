import { NextRequest, NextResponse } from 'next/server';
import { completePendingRegistration, verifyOtp, getUserByEmail, createSession, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json();
    if (!email || !code) return NextResponse.json({ error: 'Email and code are required.' }, { status: 400 });

    const user = completePendingRegistration(email, code);
    if (!user) {
      const legacyValid = verifyOtp(email, code);
      if (!legacyValid) return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 401 });
    }

    const verifiedUser = user ?? getUserByEmail(email);
    if (!verifiedUser) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });

    const token = createSession(verifiedUser.id);
    const res = NextResponse.json({ user: { id: verifiedUser.id, username: verifiedUser.username, email: verifiedUser.email, role: verifiedUser.role } });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400 });
    return res;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
