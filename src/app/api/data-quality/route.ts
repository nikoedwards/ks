import { NextResponse } from 'next/server';
import { getDataQualityReport } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(getDataQualityReport());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
