import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots, getLatestRewards, getTextHistory, getProjectCollaborators, getProjectById } from '@/lib/db';
import { predictFinalUsd, buildDeviationSeries, type ProjectForPrediction } from '@/lib/prediction';
import { guardApi } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { limited } = guardApi(req);
  if (limited) return limited;
  const { id } = await params;
  const [snapshots, rewards, textHistory, collaborators, project] = await Promise.all([
    Promise.resolve(getSnapshots(id)),
    Promise.resolve(getLatestRewards(id)),
    Promise.resolve(getTextHistory(id)),
    Promise.resolve(getProjectCollaborators(id)),
    getProjectById(id),
  ]);

  // Final-funding prediction + deviation series are derived from the (just
  // loaded) snapshots, so they always reflect the latest scraped data.
  let prediction = null;
  let deviationSeries: ReturnType<typeof buildDeviationSeries> = [];
  if (project) {
    const p = project as ProjectForPrediction;
    try {
      prediction = predictFinalUsd(snapshots, p);
      deviationSeries = buildDeviationSeries(snapshots, p);
    } catch {
      /* prediction is best-effort; never block the chart payload */
    }
  }

  return NextResponse.json({ snapshots, rewards, textHistory, collaborators, prediction, deviationSeries });
}
