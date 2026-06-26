import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { getKickstarterCategoryCensus } from '@/lib/db';
import { getIndiegogoCategoryCensus } from '@/lib/indiegogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Read-only category census across both platforms. Feeds the KS↔Indiegogo
// unified-category mapping work; no writes, admin-only.
export async function GET(req: NextRequest) {
  try {
    if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const kickstarter = getKickstarterCategoryCensus();
    const indiegogo = getIndiegogoCategoryCensus();
    const ksProjects = kickstarter.reduce((sum, row) => sum + row.count, 0);
    const iggProjects = indiegogo.reduce((sum, row) => sum + row.count, 0);
    return NextResponse.json({
      generatedAt: Date.now(),
      kickstarter,
      indiegogo,
      totals: {
        ksDistinct: kickstarter.length,
        ksProjects,
        iggDistinct: indiegogo.length,
        iggProjects,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
