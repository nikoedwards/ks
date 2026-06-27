import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, listApiKeys, createApiKey, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Key management is intentionally cookie-session only: you must be logged in via
// the browser to mint or list keys (an API key cannot manage other API keys).
export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ keys: listApiKeys(user.id) });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let name: string | undefined;
  try {
    const body = await req.json();
    name = typeof body?.name === 'string' ? body.name.slice(0, 80) : undefined;
  } catch { /* empty body is fine */ }

  // Plaintext key is returned exactly once here; only its hash is stored.
  const { key, info } = createApiKey(user.id, name);
  return NextResponse.json({ key, info });
}
