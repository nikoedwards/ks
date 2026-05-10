import { NextRequest, NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runKicktraqActiveSync } from '@/lib/kicktraqActive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as {
    maxPages?: number;
    since?: number | string;
    until?: number | string;
    onlyCurrentlyLive?: boolean;
    wait?: boolean;
  };
  const options = {
    maxPages: body.maxPages,
    since: typeof body.since === 'string'
      ? Math.floor(new Date(body.since).getTime() / 1000)
      : body.since,
    until: typeof body.until === 'string'
      ? Math.floor(new Date(body.until).getTime() / 1000)
      : body.until,
    onlyCurrentlyLive: body.onlyCurrentlyLive,
  };

  if (body.wait) {
    const result = await runKicktraqActiveSync(options);
    return NextResponse.json({ ok: result.stoppedReason !== 'error', result });
  }

  runKicktraqActiveSync(options).catch(err => console.error('[Kicksonar] Kicktraq active sync error:', err));
  return NextResponse.json({ ok: true, message: 'Kicktraq active sync started' });
}
