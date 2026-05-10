import { NextRequest, NextResponse } from 'next/server';
import { ingestKickstarterLiveProjects, type KSDiscoverProject } from '@/lib/kickstarterLive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    | { projects?: KSDiscoverProject[]; project?: KSDiscoverProject }
    | KSDiscoverProject[]
    | null;

  const projects = Array.isArray(body)
    ? body
    : body?.projects ?? (body?.project ? [body.project] : []);

  if (!projects.length) {
    return NextResponse.json({ error: 'projects array required' }, { status: 400 });
  }

  const result = await ingestKickstarterLiveProjects(projects);
  return NextResponse.json({ ok: true, ...result });
}
