import { NextResponse } from 'next/server';
import { getMeta } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const meta = await getMeta();
    return NextResponse.json(meta);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
