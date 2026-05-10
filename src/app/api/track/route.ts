import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { getTrackingList, upsertUserProjectSubscription } from '@/lib/db';
import { initTracker } from '@/lib/tracker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

initTracker();

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ projects: getTrackingList() });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? getSessionUser(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as {
    projectId?: string;
    priority?: number;
    track_rewards?: number;
    track_comments?: number;
    analyze_comments?: number;
    track_text_diff?: number;
  };
  if (!body.projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  upsertUserProjectSubscription(user.id, body.projectId, {
    is_tracking: 1,
    priority: body.priority ?? 1,
    track_rewards: body.track_rewards,
    track_comments: body.track_comments,
    analyze_comments: body.analyze_comments,
    track_text_diff: body.track_text_diff,
  });
  return NextResponse.json({ ok: true });
}
