import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE } from '@/lib/auth';
import {
  deleteProjectsDeep,
  deleteKicktraqSnapshots,
  type DataWorkbenchFilter,
  getDataWorkbenchProjects,
  getKicktraqSnapshotStats,
  getProjectById,
  getRecentCrawlerErrors,
} from '@/lib/db';
import {
  buildKSJsonUrl,
  extractCreatorSlug,
  extractProjectSlug,
  getOptionalEnv,
  type KicktraqDay,
  type KicktraqSummary,
  previewKicktraqImport,
  scrapeAndStore,
  scrapeKicktraqDetailed,
  scrapeKicktraqProjectSummary,
  storeKicktraqDays,
  storeKicktraqSummary,
} from '@/lib/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  const user = getSessionUser(token);
  return user?.role === 'admin' ? user : null;
}

function buildProjectJsonUrl(project: { source_url?: string | null; creator_slug?: string | null; slug?: string | null }) {
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

  return jsonUrl;
}

export async function GET(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  return NextResponse.json(getDataWorkbenchProjects({
    filter: (searchParams.get('filter') || 'all') as DataWorkbenchFilter,
    query: searchParams.get('q') ?? undefined,
    state: searchParams.get('state') ?? undefined,
    minPledged: searchParams.get('minPledged') ? Number(searchParams.get('minPledged')) : undefined,
    maxPledged: searchParams.get('maxPledged') ? Number(searchParams.get('maxPledged')) : undefined,
    limit: Number(searchParams.get('limit') || 25),
    offset: Number(searchParams.get('offset') || 0),
  }));
}

async function runKickstarterBasicSync(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null;
    creator_slug?: string | null;
    slug?: string | null;
  } | null;
  if (!project) return { response: NextResponse.json({ ok: false, error: 'Project not found' }, { status: 404 }) };

  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) return { response: NextResponse.json({ ok: false, error: 'No valid Kickstarter URL for this project' }, { status: 422 }) };

  const result = await scrapeAndStore(projectId, jsonUrl, {
    track_rewards: 0,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
    allowKicktraqSummaryFallback: false,
    basicOnly: true,
    allowBrowserFallback: true,
    allowHtmlFallback: false,
    directTimeoutMs: Number(process.env.KICKSTARTER_BASIC_DIRECT_TIMEOUT_MS ?? 60_000),
    directAttempts: Number(process.env.KICKSTARTER_BASIC_DIRECT_ATTEMPTS ?? 2),
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
  const recentDetail = recentErrors
    .map(error => error.message)
    .filter(Boolean)
    .slice(0, 2)
    .join(' | ');
  return {
    payload: {
      ok: result.ok,
      action,
      source: result.source,
      full: result.full,
      rewardCount: result.rewardCount,
      collaboratorCount: result.collaboratorCount,
      message: result.ok
        ? (result.message ?? 'Synced Kickstarter basic project fields.')
        : recentDetail || result.message,
      recentErrors,
    },
    status: result.ok ? 200 : 502,
  };
}

async function runKickstarterFullSync(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null; creator_slug?: string | null; slug?: string | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const jsonUrl = buildProjectJsonUrl(project);
  if (!jsonUrl) return { payload: { ok: false, action, error: 'No valid Kickstarter URL for this project' }, status: 422 };

  const result = await scrapeAndStore(projectId, jsonUrl, {
    track_rewards: process.env.KS_DIRECT_PRIMARY === '1' ? 1 : 0,
    track_comments: 1,
    track_text_diff: 1,
    manual: true,
    allowKicktraqSummaryFallback: false,
  });
  const pageUrl = jsonUrl.replace(/\.json(?:[?#].*)?$/, '');
  const recentErrors = result.ok ? [] : getRecentCrawlerErrors({ projectId, urls: [jsonUrl, pageUrl], limit: 4 });
  const recentDetail = recentErrors.map(e => e.message).filter(Boolean).slice(0, 2).join(' | ');
  return {
    payload: {
      ok: result.ok,
      action,
      source: result.source,
      full: result.full,
      rewardCount: result.rewardCount,
      collaboratorCount: result.collaboratorCount,
      message: result.ok ? result.message : (recentDetail || result.message),
      recentErrors,
    },
    status: result.ok ? 200 : 502,
  };
}

async function runKicktraqImport(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null; creator_slug?: string | null; slug?: string | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const creatorSlug = project.creator_slug || extractCreatorSlug(project.source_url ?? '');
  const projectSlug = project.slug || extractProjectSlug(project.source_url ?? '');
  if (!creatorSlug || !projectSlug) {
    return { payload: { ok: false, action, error: 'Cannot derive Kicktraq URL for this project.' }, status: 422 };
  }

  const { days, diagnostics } = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
  if (!days.length) {
    if ((diagnostics.zeroRowsRejected ?? 0) > 0) deleteKicktraqSnapshots(projectId);
    const hasOcr = Boolean(getOptionalEnv('QWEN_API_KEY') || getOptionalEnv('OPENAI_API_KEY') || getOptionalEnv('ANTHROPIC_API_KEY'));
    return {
      payload: {
        ok: false,
        action,
        noData: true,
        message: hasOcr
          ? `No usable Kicktraq rows parsed. page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, image=${diagnostics.imageStatus ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}.`
          : 'OCR provider key is not available in this Railway service.',
        diagnostics,
      },
      status: 422,
    };
  }

  const writtenSnapshots = storeKicktraqDays(projectId, days);
  return { payload: { ok: true, action, days: days.length, writtenSnapshots, diagnostics }, status: 200 };
}

// ─── Kicktraq preview/commit (manual, isolated from KS Live) ──────────────────
//
// The Kicktraq import is a deliberately manual, two-phase flow triggered only from
// the data-quality workbench. `kicktraq_preview` is READ-ONLY (never touches the DB);
// it returns the proposed summary + daily layers plus the current DB values so the UI
// can render a confirmation modal. `kicktraq_commit` writes only the layers the user
// selected, using the chosen write mode. None of this shares an execution path with
// the KS Live discovery pipeline (kickstarterLive.ts / tracker.ts).

type KicktraqDayMetrics = {
  count: number;
  sumPledged: number;
  sumBackers: number;
  negativeDays: number;
  dateFrom: string | null;
  dateTo: string | null;
  pledgedMatchPct: number | null;
  backersMatchPct: number | null;
  confidence: 'high' | 'low' | 'none';
};

function summarizeKicktraqDays(days: KicktraqDay[], summaryPledged: number, summaryBackers: number): KicktraqDayMetrics {
  let sumPledged = 0;
  let sumBackers = 0;
  let negativeDays = 0;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  for (const d of days) {
    sumPledged += d.pledged_usd;
    sumBackers += d.backers;
    if (d.pledged_usd < 0 || d.backers < 0) negativeDays += 1;
    if (!dateFrom || d.date < dateFrom) dateFrom = d.date;
    if (!dateTo || d.date > dateTo) dateTo = d.date;
  }
  const pledgedMatchPct = summaryPledged > 0 ? Math.round((sumPledged / summaryPledged) * 1000) / 10 : null;
  const backersMatchPct = summaryBackers > 0 ? Math.round((sumBackers / summaryBackers) * 1000) / 10 : null;
  // The summary total can legitimately exceed the in-campaign daily sum (post-campaign
  // sales), so a low match % is NOT treated as a failure. We only flag "low" confidence
  // when the daily curve itself looks broken: negative increments, or a sum that
  // massively over-reads the reliable summary total (OCR mis-read).
  let confidence: 'high' | 'low' | 'none' = 'high';
  if (!days.length) confidence = 'none';
  else if (negativeDays > 0) confidence = 'low';
  else if (pledgedMatchPct !== null && pledgedMatchPct > 150) confidence = 'low';
  return { count: days.length, sumPledged, sumBackers, negativeDays, dateFrom, dateTo, pledgedMatchPct, backersMatchPct, confidence };
}

function deriveKicktraqSlugs(project: { creator_slug?: string | null; slug?: string | null; source_url?: string | null }) {
  const creatorSlug = project.creator_slug || extractCreatorSlug(project.source_url ?? '');
  const projectSlug = project.slug || extractProjectSlug(project.source_url ?? '');
  return { creatorSlug, projectSlug };
}

function coerceSummary(raw: unknown): KicktraqSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const summary: KicktraqSummary = {
    pledged_usd: Math.max(0, num(r.pledged_usd)),
    backers_count: Math.max(0, num(r.backers_count)),
    goal_usd: Math.max(0, num(r.goal_usd)),
    currency: typeof r.currency === 'string' ? r.currency : null,
  };
  if (summary.pledged_usd <= 0 && summary.backers_count <= 0 && summary.goal_usd <= 0) return null;
  return summary;
}

function coerceDays(raw: unknown): KicktraqDay[] {
  if (!Array.isArray(raw)) return [];
  const out: KicktraqDay[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const date = typeof r.date === 'string' ? r.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      pledged_usd: Number.isFinite(Number(r.pledged_usd)) ? Number(r.pledged_usd) : 0,
      backers: Number.isFinite(Number(r.backers)) ? Number(r.backers) : 0,
      comments: Number.isFinite(Number(r.comments)) ? Number(r.comments) : 0,
    });
  }
  return out;
}

// Preview is split in two so the modal never blocks on OCR: this step fetches ONLY the
// fast, reliable summary layer (HTML text) plus current DB stats. The slow daily/OCR
// layer is fetched on demand via runKicktraqDaily.
async function runKicktraqPreview(projectId: string, action: string) {
  const project = await getProjectById(projectId) as {
    name?: string | null; source_url?: string | null; creator_slug?: string | null; slug?: string | null;
    usd_pledged?: number | null; backers_count?: number | null; goal?: number | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const { creatorSlug, projectSlug } = deriveKicktraqSlugs(project);
  if (!creatorSlug || !projectSlug) {
    return { payload: { ok: false, action, error: 'Cannot derive Kicktraq URL for this project.' }, status: 422 };
  }

  let summary: KicktraqSummary | null = null;
  try {
    summary = await scrapeKicktraqProjectSummary(creatorSlug, projectSlug);
  } catch {
    summary = null;
  }
  const stats = getKicktraqSnapshotStats(projectId);

  return {
    payload: {
      ok: true,
      action,
      preview: {
        projectName: project.name ?? projectSlug,
        summary: {
          incoming: summary
            ? { pledged_usd: summary.pledged_usd, backers_count: summary.backers_count, goal_usd: summary.goal_usd, currency: summary.currency }
            : null,
          current: {
            pledged_usd: Number(project.usd_pledged ?? 0),
            backers_count: Number(project.backers_count ?? 0),
            goal_usd: Number(project.goal ?? 0),
          },
        },
        daily: {
          incoming: null,
          current: { snapshotCount: stats.count, dateFrom: stats.dateFrom, dateTo: stats.dateTo },
        },
      },
    },
    status: 200,
  };
}

// On-demand daily/OCR fetch (the slow part). Triggered explicitly from the modal so the
// user gets a dedicated, cancellable spinner instead of blocking the whole preview.
async function runKicktraqDaily(
  projectId: string,
  action: string,
  body: { summaryPledged?: number; summaryBackers?: number },
) {
  const project = await getProjectById(projectId) as {
    source_url?: string | null; creator_slug?: string | null; slug?: string | null;
  } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const { creatorSlug, projectSlug } = deriveKicktraqSlugs(project);
  if (!creatorSlug || !projectSlug) {
    return { payload: { ok: false, action, error: 'Cannot derive Kicktraq URL for this project.' }, status: 422 };
  }

  let days: KicktraqDay[] = [];
  let diagnostics: Awaited<ReturnType<typeof scrapeKicktraqDetailed>>['diagnostics'] = {};
  try {
    const detailed = await scrapeKicktraqDetailed(creatorSlug, projectSlug);
    days = detailed.days;
    diagnostics = detailed.diagnostics;
  } catch (e) {
    diagnostics = { reason: `Daily scrape failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}` };
  }

  const metrics = summarizeKicktraqDays(days, Number(body.summaryPledged ?? 0), Number(body.summaryBackers ?? 0));
  const hasOcr = Boolean(getOptionalEnv('QWEN_API_KEY') || getOptionalEnv('OPENAI_API_KEY') || getOptionalEnv('ANTHROPIC_API_KEY'));

  return {
    payload: {
      ok: true,
      action,
      daily: {
        days,
        count: metrics.count,
        sumPledged: metrics.sumPledged,
        sumBackers: metrics.sumBackers,
        dateFrom: metrics.dateFrom,
        dateTo: metrics.dateTo,
      },
      validation: {
        pledgedMatchPct: metrics.pledgedMatchPct,
        backersMatchPct: metrics.backersMatchPct,
        negativeDays: metrics.negativeDays,
        confidence: metrics.confidence,
      },
      message: metrics.count === 0
        ? (hasOcr
            ? `No daily rows parsed. page=${diagnostics.pageStatus ?? '-'}, json=${diagnostics.jsonStatus ?? '-'}, image=${diagnostics.imageStatus ?? '-'}, ocr=${diagnostics.ocrProvider ?? '-'} ${diagnostics.ocrStatus ?? '-'}.${diagnostics.ocrError ? ' ' + diagnostics.ocrError : ''}${diagnostics.reason ? ' ' + diagnostics.reason : ''}`
            : 'No OCR provider key configured, so the image-only daily curve cannot be read.')
        : undefined,
      diagnostics,
    },
    status: 200,
  };
}

type KicktraqCommitParts = { summary?: boolean; daily?: boolean };

function commitKicktraqSelection(
  projectId: string,
  project: { usd_pledged?: number | null; backers_count?: number | null },
  parts: KicktraqCommitParts,
  summaryMode: 'overwrite' | 'skip',
  dailyMode: 'overwrite' | 'merge',
  payload: { summary?: unknown; days?: unknown },
): { summaryWritten: boolean; summarySkipped: boolean; dailyWritten: number } {
  let summaryWritten = false;
  let summarySkipped = false;
  let dailyWritten = 0;

  if (parts.summary) {
    const summary = coerceSummary(payload.summary);
    if (summary) {
      const hasExisting = Number(project.usd_pledged ?? 0) > 0 || Number(project.backers_count ?? 0) > 0;
      if (summaryMode === 'skip' && hasExisting) {
        summarySkipped = true;
      } else {
        storeKicktraqSummary(projectId, summary);
        summaryWritten = true;
      }
    }
  }

  if (parts.daily) {
    const days = coerceDays(payload.days);
    if (days.length) {
      dailyWritten = storeKicktraqDays(projectId, days, { mode: dailyMode }).length;
    }
  }

  return { summaryWritten, summarySkipped, dailyWritten };
}

async function runKicktraqCommit(
  projectId: string,
  action: string,
  body: { parts?: KicktraqCommitParts; summaryMode?: string; dailyMode?: string; payload?: { summary?: unknown; days?: unknown } },
) {
  const project = await getProjectById(projectId) as { usd_pledged?: number | null; backers_count?: number | null } | null;
  if (!project) return { payload: { ok: false, action, error: 'Project not found' }, status: 404 };

  const parts: KicktraqCommitParts = { summary: body.parts?.summary === true, daily: body.parts?.daily === true };
  if (!parts.summary && !parts.daily) {
    return { payload: { ok: false, action, error: 'Select at least one layer to import.' }, status: 400 };
  }
  const summaryMode: 'overwrite' | 'skip' = body.summaryMode === 'skip' ? 'skip' : 'overwrite';
  const dailyMode: 'overwrite' | 'merge' = body.dailyMode === 'merge' ? 'merge' : 'overwrite';

  const result = commitKicktraqSelection(projectId, project, parts, summaryMode, dailyMode, body.payload ?? {});
  const ok = result.summaryWritten || result.dailyWritten > 0;
  return {
    payload: {
      ok,
      action,
      ...result,
      message: ok ? 'Kicktraq data committed.' : 'Nothing was written (no usable data in selection).',
    },
    status: ok ? 200 : 422,
  };
}

type KicktraqBatchConfig = {
  summary?: { import?: boolean; mode?: string };
  daily?: { import?: boolean; mode?: string };
  skipLowConfidence?: boolean;
};

async function runKicktraqBatchCommit(projectIds: string[], config: KicktraqBatchConfig) {
  const importSummary = config.summary?.import === true;
  const importDaily = config.daily?.import === true;
  const summaryMode: 'overwrite' | 'skip' = config.summary?.mode === 'skip' ? 'skip' : 'overwrite';
  const dailyMode: 'overwrite' | 'merge' = config.daily?.mode === 'merge' ? 'merge' : 'overwrite';
  const skipLowConfidence = config.skipLowConfidence === true;

  const results: Array<Record<string, unknown>> = [];
  let summaryWrittenTotal = 0;
  let dailyWrittenProjects = 0;
  let skippedLowConfidence = 0;
  let failed = 0;

  for (const id of projectIds.slice(0, 25)) {
    try {
      const project = await getProjectById(id) as {
        source_url?: string | null; creator_slug?: string | null; slug?: string | null;
        usd_pledged?: number | null; backers_count?: number | null;
      } | null;
      if (!project) { failed += 1; results.push({ projectId: id, ok: false, error: 'Project not found' }); continue; }

      const { creatorSlug, projectSlug } = deriveKicktraqSlugs(project);
      if (!creatorSlug || !projectSlug) { failed += 1; results.push({ projectId: id, ok: false, error: 'No Kicktraq URL' }); continue; }

      const { summary, days } = await previewKicktraqImport(creatorSlug, projectSlug);
      const metrics = summarizeKicktraqDays(days, summary?.pledged_usd ?? 0, summary?.backers_count ?? 0);
      const lowConfidence = metrics.confidence === 'low';
      const includeDaily = importDaily && !(skipLowConfidence && lowConfidence);

      const r = commitKicktraqSelection(
        id,
        project,
        { summary: importSummary, daily: includeDaily },
        summaryMode,
        dailyMode,
        { summary: summary ?? undefined, days },
      );

      if (r.summaryWritten) summaryWrittenTotal += 1;
      if (r.dailyWritten > 0) dailyWrittenProjects += 1;
      if (importDaily && !includeDaily) skippedLowConfidence += 1;
      const ok = r.summaryWritten || r.dailyWritten > 0 || r.summarySkipped;
      if (!ok) failed += 1;
      results.push({ projectId: id, ok, ...r, confidence: metrics.confidence, skippedDailyLowConfidence: importDaily && !includeDaily });
    } catch {
      failed += 1;
      results.push({ projectId: id, ok: false, error: 'Project import failed.' });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  return {
    payload: {
      ok: succeeded > 0,
      action: 'kicktraq_batch_commit',
      requested: projectIds.length,
      succeeded,
      failed,
      summaryWritten: summaryWrittenTotal,
      dailyWritten: dailyWrittenProjects,
      skippedLowConfidence,
      results,
    },
    status: succeeded > 0 ? 200 : 502,
  };
}

const SCRAPE_RUNNERS: Record<string, (projectId: string, action: string) => Promise<{ payload?: Record<string, unknown>; status?: number; response?: NextResponse }>> = {
  kickstarter_basic_sync: runKickstarterBasicSync,
  kickstarter_sync: runKickstarterFullSync,
  kicktraq_import: runKicktraqImport,
};

export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    projectId?: string;
    projectIds?: string[];
    action?: string;
    config?: KicktraqBatchConfig;
    parts?: KicktraqCommitParts;
    summaryMode?: string;
    dailyMode?: string;
    payload?: { summary?: unknown; days?: unknown };
    summaryPledged?: number;
    summaryBackers?: number;
  };
  const action = body.action ?? '';
  const projectIds = Array.isArray(body.projectIds)
    ? Array.from(new Set(body.projectIds.map(id => String(id).trim()).filter(Boolean))).slice(0, 50)
    : [];

  // ─── Batch ────────────────────────────────────────────────────────────────
  if (projectIds.length) {
    if (action === 'delete_projects') {
      const deleted = deleteProjectsDeep(projectIds);
      return NextResponse.json({ ok: true, action, deleted, requested: projectIds.length });
    }
    if (action === 'kicktraq_batch_commit') {
      const result = await runKicktraqBatchCommit(projectIds, body.config ?? {});
      return NextResponse.json(result.payload, { status: result.status });
    }
    const runner = SCRAPE_RUNNERS[action];
    if (!runner) return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
    const results: Array<{ projectId: string; status: number; ok?: boolean; [k: string]: unknown }> = [];
    for (const id of projectIds.slice(0, 25)) {
      const r = await runner(id, action).catch(() => ({ payload: { ok: false, error: 'Project sync failed.' }, status: 500 }));
      const hasResponse = 'response' in r && r.response;
      const payload: { ok?: boolean; [k: string]: unknown } = hasResponse
        ? { ok: false, error: 'Project sync failed.' }
        : (r.payload ?? { ok: false, error: 'Project sync failed.' });
      results.push({ projectId: id, status: r.status ?? 500, ...payload });
    }
    const succeeded = results.filter(r => r.ok).length;
    return NextResponse.json({
      ok: succeeded > 0,
      action,
      succeeded,
      failed: results.length - succeeded,
      results,
    }, { status: succeeded > 0 ? 200 : 502 });
  }

  // ─── Single project ─────────────────────────────────────────────────────────
  const projectId = body.projectId?.trim();
  if (!projectId) return NextResponse.json({ ok: false, error: 'projectId is required' }, { status: 400 });

  if (action === 'kicktraq_preview') {
    try {
      const result = await runKicktraqPreview(projectId, action);
      return NextResponse.json(result.payload, { status: result.status });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: `Preview crashed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` }, { status: 500 });
    }
  }
  if (action === 'kicktraq_daily') {
    try {
      const result = await runKicktraqDaily(projectId, action, body as { summaryPledged?: number; summaryBackers?: number });
      return NextResponse.json(result.payload, { status: result.status });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: `Daily scrape crashed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` }, { status: 500 });
    }
  }
  if (action === 'kicktraq_commit') {
    try {
      const result = await runKicktraqCommit(projectId, action, body);
      return NextResponse.json(result.payload, { status: result.status });
    } catch (e) {
      return NextResponse.json({ ok: false, action, error: `Commit crashed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}` }, { status: 500 });
    }
  }

  const runner = SCRAPE_RUNNERS[action];
  if (!runner) return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  const result = await runner(projectId, action);
  if (result.response) return result.response;
  return NextResponse.json(result.payload, { status: result.status });
}
