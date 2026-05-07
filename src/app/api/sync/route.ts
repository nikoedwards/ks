import { NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runSync } from '@/lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }

  // Run sync in the background — do not await
  runSync().catch(err => console.error('[KS Analytics] Sync error:', err));

  return NextResponse.json({ ok: true, message: 'Sync started' });
}
