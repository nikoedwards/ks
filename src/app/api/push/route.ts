import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { recordPushEvent, type PushSegment } from '@/lib/db';
import { resolvePushForUser } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  return token ? getSessionUser(token) : null;
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  return NextResponse.json({ push: resolvePushForUser(user) });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  const body = await req.json().catch(() => ({})) as {
    segment?: PushSegment;
    eventType?: 'view' | 'dismiss' | 'click';
    durationMs?: number;
  };
  if (!body.segment || !body.eventType) {
    return NextResponse.json({ error: 'segment and eventType required' }, { status: 400 });
  }
  recordPushEvent({
    segment: body.segment,
    userId: user?.id,
    eventType: body.eventType,
    durationMs: body.durationMs,
  });
  return NextResponse.json({ ok: true });
}
