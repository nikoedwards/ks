import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots, getLatestRewards, getTextHistory } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [snapshots, rewards, textHistory] = await Promise.all([
    Promise.resolve(getSnapshots(id)),
    Promise.resolve(getLatestRewards(id)),
    Promise.resolve(getTextHistory(id)),
  ]);
  return NextResponse.json({ snapshots, rewards, textHistory });
}
