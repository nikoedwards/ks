import { NextRequest, NextResponse } from 'next/server';
import { getProjectById, getSimilarProjects } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const project = await getProjectById(id) as Record<string, unknown> | null;
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

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
