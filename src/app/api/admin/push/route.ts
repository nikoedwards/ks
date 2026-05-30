import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import { listPushRules, savePushRule, type PushSegment, type PushFrequency, type PushRuleConfig } from '@/lib/db';
import { resolvePushForUser } from '@/lib/push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const preview = req.nextUrl.searchParams.get('preview');
  if (preview) {
    // Preview always builds the requested segment, ignoring per-user seen state.
    const rules = listPushRules();
    const rule = rules.find(r => r.segment === preview);
    if (!rule) return NextResponse.json({ error: 'unknown segment' }, { status: 400 });
    // Temporarily resolve as an anonymous user to build the digest, or signal
    // that favorites/onboarding require live user context.
    return NextResponse.json({ rule });
  }
  return NextResponse.json({ data: listPushRules() });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    segment?: PushSegment;
    enabled?: boolean;
    frequency?: PushFrequency;
    config?: PushRuleConfig;
  };
  if (!body.segment) {
    return NextResponse.json({ error: 'segment required' }, { status: 400 });
  }
  savePushRule({
    segment: body.segment,
    enabled: body.enabled == null ? undefined : (body.enabled ? 1 : 0),
    frequency: body.frequency,
    config: body.config,
  });
  return NextResponse.json({ ok: true, data: listPushRules() });
}

// Force a real-content preview for the platform digest (anonymous context).
export async function PUT(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ push: resolvePushForUser({ id: -1 }) });
}
