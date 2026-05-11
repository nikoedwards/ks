import { NextRequest, NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runKicktraqFullScan, abortFullScan, KICKTRAQ_CATEGORIES } from '@/lib/kicktraqFullScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    delayMs?: number;
    maxPagesPerCategory?: number;
    categories?: string[];
    resumeFromIndex?: number;
    wait?: boolean;
    abort?: boolean;
  };

  // Abort a running scan
  if (body.abort) {
    abortFullScan();
    return NextResponse.json({ ok: true, message: 'Abort signal sent' });
  }

  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'A sync is already running' }, { status: 409 });
  }

  const options = {
    delayMs: body.delayMs ?? 350,
    maxPagesPerCategory: body.maxPagesPerCategory,
    categories: body.categories,
    resumeFromIndex: body.resumeFromIndex ?? 0,
  };

  if (body.wait) {
    const result = await runKicktraqFullScan(options);
    return NextResponse.json({ ok: result.stoppedReason !== 'error', result });
  }

  runKicktraqFullScan(options).catch(err =>
    console.error('[Kicksonar] Kicktraq full scan error:', err)
  );

  return NextResponse.json({
    ok: true,
    message: `Kicktraq full scan started (${KICKTRAQ_CATEGORIES.length} categories)`,
    totalCategories: KICKTRAQ_CATEGORIES.length,
  });
}

export async function GET() {
  // Return scan metadata (category count, etc.)
  return NextResponse.json({
    totalCategories: KICKTRAQ_CATEGORIES.length,
    categories: KICKTRAQ_CATEGORIES,
  });
}
