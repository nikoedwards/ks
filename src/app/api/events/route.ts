import { NextRequest, NextResponse } from 'next/server';
import { recordAnalyticsEvent } from '@/lib/db';
import { getRequestUser, getClientIp } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Client-side analytics beacon. Fire-and-forget; only whitelisted event types
// are accepted. project_view is recorded server-side (in /api/projects/[id]),
// not here, so it can't be spoofed from the client.
const ALLOWED = new Set(['pageview', 'click']);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const eventType = String(body.event_type ?? '');
    if (!ALLOWED.has(eventType)) return NextResponse.json({ ok: false }, { status: 400 });
    const user = getRequestUser(req);
    recordAnalyticsEvent({
      event_type: eventType,
      path: typeof body.path === 'string' ? body.path.slice(0, 300) : null,
      project_id: typeof body.project_id === 'string' ? body.project_id.slice(0, 64) : null,
      user_id: user?.id ?? null,
      ip: getClientIp(req),
      session_id: typeof body.session_id === 'string' ? body.session_id.slice(0, 64) : null,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
