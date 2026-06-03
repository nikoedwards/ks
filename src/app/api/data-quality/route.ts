import { NextRequest, NextResponse } from 'next/server';
import { getDataQualityReport } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(getDataQualityReport());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
