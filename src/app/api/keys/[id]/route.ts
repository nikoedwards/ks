import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, revokeApiKey, SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const keyId = Number(id);
  if (!Number.isInteger(keyId)) return NextResponse.json({ error: 'Invalid key id' }, { status: 400 });

  const ok = revokeApiKey(user.id, keyId);
  if (!ok) return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
