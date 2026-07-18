import { NextRequest, NextResponse } from 'next/server';
import {
  getProjectById,
  getProjectCollaborators,
  markCollabChecked,
} from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import {
  buildKSJsonUrl,
  fetchCollaboratorsViaWorker,
  storeCollaboratorsFromWorker,
} from '@/lib/scraper';
import { isIndiegogoId } from '@/lib/platformProjects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETRY_SEC = Math.max(15 * 60, Number(process.env.KS_COLLAB_RETRY_SEC ?? 60 * 60));
const STALE_SEC = Math.max(60 * 60, Number(process.env.KS_COLLAB_STALE_SEC ?? 30 * 24 * 60 * 60));

interface RefreshResult {
  ok: boolean;
  status: 'stored' | 'confirmed_empty' | 'deferred' | 'incomplete' | 'unavailable';
  collaborators: ReturnType<typeof getProjectCollaborators>;
  reason?: string;
  nextRetryAt?: number;
}

declare global {
  // eslint-disable-next-line no-var
  var __ksCollaboratorRefreshes: Map<string, Promise<RefreshResult>> | undefined;
}

const inFlight = globalThis.__ksCollaboratorRefreshes
  ?? (globalThis.__ksCollaboratorRefreshes = new Map<string, Promise<RefreshResult>>());

function projectPageUrl(project: {
  source_url?: string | null;
  creator_slug?: string | null;
  slug?: string | null;
}): string | null {
  let jsonUrl = buildKSJsonUrl(project.source_url ?? '');
  if (!jsonUrl && project.creator_slug && project.slug) {
    jsonUrl = buildKSJsonUrl(`https://www.kickstarter.com/projects/${project.creator_slug}/${project.slug}`);
  }
  return jsonUrl ? jsonUrl.replace(/\.json(?:[?#].*)?$/, '') : null;
}

async function refreshProject(projectId: string): Promise<RefreshResult> {
  const existing = getProjectCollaborators(projectId);
  if (existing.length) return { ok: true, status: 'stored', collaborators: existing };

  const project = await getProjectById(projectId) as {
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
    collab_checked_at?: number | null;
  } | null;
  if (!project) return { ok: false, status: 'unavailable', collaborators: [], reason: 'project_not_found' };

  const now = Math.floor(Date.now() / 1000);
  const checkedAt = Number(project.collab_checked_at ?? 0);
  const nextRetryAt = checkedAt > 0 ? checkedAt + RETRY_SEC : 0;
  if (nextRetryAt > now) {
    return { ok: true, status: 'deferred', collaborators: [], reason: 'retry_not_due', nextRetryAt };
  }

  const pageUrl = projectPageUrl(project);
  if (!pageUrl) return { ok: false, status: 'unavailable', collaborators: [], reason: 'invalid_project_url' };

  const result = await fetchCollaboratorsViaWorker(pageUrl, projectId);
  if (!result) {
    return { ok: false, status: 'unavailable', collaborators: [], reason: 'worker_unavailable' };
  }

  const stored = storeCollaboratorsFromWorker(projectId, result.collaborators, now);
  if (stored > 0) {
    markCollabChecked(projectId, now);
    return { ok: true, status: 'stored', collaborators: getProjectCollaborators(projectId), reason: result.reason };
  }

  if (result.complete) {
    // Missing-data selection checks `collab_checked_at <= now - RETRY_SEC`.
    // Shift a confirmed empty result forward so its next probe follows the
    // normal stale interval instead of being retried every hour.
    const marker = now + Math.max(0, STALE_SEC - RETRY_SEC);
    markCollabChecked(projectId, marker);
    return { ok: true, status: 'confirmed_empty', collaborators: [], reason: result.reason, nextRetryAt: now + STALE_SEC };
  }

  const workerDelaySec = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : 0;
  const retryDelaySec = Math.max(RETRY_SEC, workerDelaySec);
  const marker = now + Math.max(0, retryDelaySec - RETRY_SEC);
  markCollabChecked(projectId, marker);
  return {
    ok: false,
    status: 'incomplete',
    collaborators: [],
    reason: result.reason,
    nextRetryAt: now + retryDelaySec,
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { limited } = guardApi(req, { bucket: 'collaborator-refresh', perMin: 6, perHour: 60 });
  if (limited) return limited;

  const { id } = await params;
  if (!id || isIndiegogoId(id)) {
    return NextResponse.json({ ok: false, error: 'Kickstarter project required.' }, { status: 400 });
  }

  let pending = inFlight.get(id);
  if (!pending) {
    pending = refreshProject(id);
    inFlight.set(id, pending);
  }

  try {
    const result = await pending;
    const httpStatus = result.ok ? 200 : result.status === 'incomplete' ? 202 : 503;
    return NextResponse.json(result, { status: httpStatus });
  } finally {
    if (inFlight.get(id) === pending) inFlight.delete(id);
  }
}
