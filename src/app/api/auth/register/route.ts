import { NextRequest, NextResponse } from 'next/server';
import { createUserByEmail, emailExists, createOtp } from '@/lib/auth';
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

    createUserByEmail(email, password);
    const code = createOtp(email);
    await sendOtpEmail(email, code);

    return NextResponse.json({ ok: true, needsOtp: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
