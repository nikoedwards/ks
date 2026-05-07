import { NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { getLastSync, getSyncHistory, getProjectCount } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const syncState = getSyncState();
    const lastSync = await getLastSync();
    const history = await getSyncHistory();
    const projectCount = await getProjectCount();
    return NextResponse.json({ syncState, lastSync, history, projectCount });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
