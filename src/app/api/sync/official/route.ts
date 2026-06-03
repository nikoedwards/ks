import { NextRequest, NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runOfficialPipelineOnce } from '@/lib/tracker';
import { requireAdmin } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as {
    wait?: boolean;
    maxPages?: number;
    lookbackDays?: number;
    scrapeDue?: boolean;
  };

  const options = {
    maxPages: body.maxPages,
    lookbackDays: body.lookbackDays,
    scrapeDue: body.scrapeDue,
  };

  if (body.wait) {
    const result = await runOfficialPipelineOnce(options);
    return NextResponse.json({ ok: result.live.stoppedReason !== 'error' && result.live.stoppedReason !== 'blocked', result });
  }

  runOfficialPipelineOnce(options).catch(err => console.error('[Kicksonar] Official pipeline error:', err));
  return NextResponse.json({
    ok: true,
    message: 'Official Kickstarter discovery and live tracking started',
  });
}
