import { NextRequest, NextResponse } from 'next/server';
import { getSnapshots, getLatestRewards, getTextHistory, getProjectCollaborators, getProjectById } from '@/lib/db';
import { predictFinalUsd, buildDeviationSeries, type ProjectForPrediction } from '@/lib/prediction';
import { guardApi } from '@/lib/apiAuth';
import { isIndiegogoId, indiegogoSourceId, getIndiegogoSnapshots } from '@/lib/platformProjects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { limited } = guardApi(req);
  if (limited) return limited;
  const { id } = await params;

  // Indiegogo: only pledge/backer snapshots exist. Rewards, text history,
  // collaborators and prediction are Kickstarter-only -> return empty so the
  // detail page gracefully hides those modules.
  if (isIndiegogoId(id)) {
    const iggSnapshots = getIndiegogoSnapshots(indiegogoSourceId(id)).map(s => ({
      captured_at: s.captured_at,
      pledged_usd: Number(s.pledged_usd ?? s.pledged_amount ?? 0),
      backers_count: Number(s.backers_count ?? 0),
      state: s.state ?? null,
      source: s.source,
    }));
    return NextResponse.json({
      snapshots: iggSnapshots,
      rewards: [],
      textHistory: [],
      collaborators: [],
      prediction: null,
      deviationSeries: [],
    });
  }
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
