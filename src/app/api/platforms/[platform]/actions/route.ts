import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { isPlatformViewId } from '@/lib/platforms';
import { runPlatformAction, type PlatformAction } from '@/lib/platformDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = new Set<PlatformAction>(['init_db', 'validate_config', 'dry_run_capabilities', 'crawl', 'import', 'export']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  try {
    if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { platform } = await params;
    if (!isPlatformViewId(platform)) {
      return NextResponse.json({ ok: false, error: `Unknown platform: ${platform}` }, { status: 404 });
    }
    const body = await req.json().catch(() => ({})) as { action?: string };
    const action = body.action;
    if (!action || !ACTIONS.has(action as PlatformAction)) {
      return NextResponse.json({ ok: false, error: 'Unsupported or missing action.' }, { status: 400 });
    }
    const result = runPlatformAction(platform, action as PlatformAction);
    return NextResponse.json(result.payload, { status: result.status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
