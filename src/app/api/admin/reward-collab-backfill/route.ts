import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';
import { getProjectById, getRewardCollabBackfillDue, markRewardCollabChecked } from '@/lib/db';
import {
  backfillRewardsAndCollaborators,
  buildKSJsonUrl,
  extractCreatorSlug,
  extractProjectSlug,
} from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildProjectPageUrl(project: { source_url?: string | null; creator_slug?: string | null; slug?: string | null }): string | null {
  let jsonUrl = buildKSJsonUrl(project.source_url ?? '');
  if (!jsonUrl && project.creator_slug && project.slug) {
    jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`);
  }
  if (!jsonUrl && project.source_url) {
    const creatorSlug = extractCreatorSlug(project.source_url);
    const projectSlug = extractProjectSlug(project.source_url);
    if (creatorSlug && projectSlug) {
      jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${creatorSlug}/${projectSlug}`);
    }
  }
  return jsonUrl ? jsonUrl.replace(/\.json(?:[?#].*)?$/, '') : null;
}

/**
 * Admin-only manual trigger for the isolated rewards + collaborators backfill.
 *
 * - `{ projectIds: [...] }` — backfill those specific projects (works for ANY
 *   project, including ended ones; this is the on-demand path for ended
 *   campaigns that the automatic live-only pass never touches).
 * - `{ limit }` (no projectIds) — pull the next due batch of tracked live
 *   projects still missing rewards/collaborators and backfill them.
 *
 * Only writes reward_snapshots + project_collaborators via the worker /project
 * endpoint (LOW priority). Never touches funding snapshots, scheduling, state,
 * or any other crawl path.
 */
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { projectIds?: string[]; limit?: number };
  const explicitIds = Array.isArray(body.projectIds)
    ? Array.from(new Set(body.projectIds.map((id) => String(id).trim()).filter(Boolean))).slice(0, 50)
    : [];

  const ids = explicitIds.length
    ? explicitIds
    : getRewardCollabBackfillDue(Math.max(1, Math.min(Number(body.limit ?? 25), 50))).map((r) => r.project_id);

  if (!ids.length) {
    return NextResponse.json({ ok: true, message: 'No projects to backfill.', processed: 0, results: [] });
  }

  const results: Array<{ projectId: string; ok: boolean; rewardCount: number; collaboratorCount: number; message?: string }> = [];
  for (const id of ids) {
    try {
      const project = await getProjectById(id) as { source_url?: string | null; creator_slug?: string | null; slug?: string | null } | null;
      if (!project) {
        results.push({ projectId: id, ok: false, rewardCount: 0, collaboratorCount: 0, message: 'Project not found.' });
        continue;
      }
      const pageUrl = buildProjectPageUrl(project);
      if (!pageUrl) {
        markRewardCollabChecked(id);
        results.push({ projectId: id, ok: false, rewardCount: 0, collaboratorCount: 0, message: 'No valid Kickstarter URL.' });
        continue;
      }
      const res = await backfillRewardsAndCollaborators(id, pageUrl);
      markRewardCollabChecked(id);
      results.push({ projectId: id, ok: res.ok, rewardCount: res.rewardCount, collaboratorCount: res.collaboratorCount, message: res.message });
    } catch (e) {
      results.push({ projectId: id, ok: false, rewardCount: 0, collaboratorCount: 0, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const rewardsWritten = results.reduce((n, r) => n + (r.rewardCount > 0 ? 1 : 0), 0);
  const collaboratorsWritten = results.reduce((n, r) => n + (r.collaboratorCount > 0 ? 1 : 0), 0);
  return NextResponse.json({
    ok: succeeded > 0,
    mode: explicitIds.length ? 'explicit' : 'due',
    processed: results.length,
    succeeded,
    rewardsWritten,
    collaboratorsWritten,
    results,
  });
}
