import { NextRequest, NextResponse } from 'next/server';
import { getTrendingProjects } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Powers the global search bar's default (empty-query) "hot projects" dropdown.
export async function GET(req: NextRequest) {
  try {
    const { limited } = guardApi(req);
    if (limited) return limited;
    return NextResponse.json({ rows: getTrendingProjects() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
