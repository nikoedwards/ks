import { NextRequest, NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runKickstarterLiveSync, type LiveSyncOptions } from '@/lib/kickstarterLive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as {
    since?: number | string;
    maxPages?: number;
    state?: LiveSyncOptions['state'];
    wait?: boolean;
  };

  const options: LiveSyncOptions = {
    since: typeof body.since === 'string'
      ? Math.floor(new Date(body.since).getTime() / 1000)
      : body.since,
    maxPages: body.maxPages,
    state: body.state,
  };

  if (body.wait) {
    const result = await runKickstarterLiveSync(options);
    return NextResponse.json({ ok: result.stoppedReason !== 'error' && result.stoppedReason !== 'blocked', result });
  }

  runKickstarterLiveSync(options).catch(err => console.error('[Kicksonar] Live sync error:', err));
  return NextResponse.json({ ok: true, message: 'Kickstarter live sync started' });
}
