import { NextRequest, NextResponse } from 'next/server';
import { createPendingRegistration, deletePendingRegistration, emailExists } from '@/lib/auth';
import { sendOtpEmail } from '@/lib/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    if (emailExists(email)) return NextResponse.json({ error: 'This email is already registered.' }, { status: 409 });

    const normalizedEmail = email.trim().toLowerCase();
    const code = createPendingRegistration(normalizedEmail, password);
    try {
      await sendOtpEmail(normalizedEmail, code);
    } catch (err) {
      deletePendingRegistration(normalizedEmail);
      console.error('[auth/register] Could not send verification email:', err);
      return NextResponse.json({
        error: 'Could not send verification email. Please check the email address or try again later.',
      }, { status: 502 });
    }

    return NextResponse.json({ ok: true, needsOtp: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
