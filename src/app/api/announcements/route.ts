import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getActiveAnnouncementForUser, recordAnnouncementEvent } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function currentUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  return token ? getSessionUser(token) : null;
}

export async function GET(req: NextRequest) {
  const user = currentUser(req);
  return NextResponse.json({ announcement: getActiveAnnouncementForUser(user?.id) });
}

export async function POST(req: NextRequest) {
  const user = currentUser(req);
  const body = await req.json().catch(() => ({})) as {
    announcementId?: number;
    eventType?: 'view' | 'dismiss' | 'click';
    durationMs?: number;
  };
  if (!body.announcementId || !body.eventType) {
    return NextResponse.json({ error: 'announcementId and eventType required' }, { status: 400 });
  }
  recordAnnouncementEvent({
    announcementId: body.announcementId,
    userId: user?.id,
    eventType: body.eventType,
    durationMs: body.durationMs,
  });
  return NextResponse.json({ ok: true });
}
