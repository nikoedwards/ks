import { NextRequest, NextResponse } from 'next/server';
import { getProjectById, getSimilarProjects, recordAnalyticsEvent } from '@/lib/db';
import { guardApi, getClientIp } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, limited } = guardApi(req);
    if (limited) return limited;
    const { id } = await params;
    const project = await getProjectById(id) as Record<string, unknown> | null;
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Count a project view (per detail-page load) for click-distribution stats.
    recordAnalyticsEvent({ event_type: 'project_view', project_id: id, user_id: user?.id ?? null, ip: getClientIp(req) });

    const similar = getSimilarProjects(
      id,
      String(project.category_parent ?? ''),
      Number(project.goal ?? 0),
      Number(project.backers_count ?? 0),
    );

    return NextResponse.json({ ...project, similar });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
