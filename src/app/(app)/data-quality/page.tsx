'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Database, ExternalLink, Globe2, HardDrive, Info, Layers, Lock, RefreshCw, RadioTower, Search, Server, ShieldCheck, Trash2, UploadCloud, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import DataSourceSync from '@/components/DataSourceSync';
import { PLATFORM_VIEWS, type PlatformViewId } from '@/lib/platforms';

interface SourceHealth {
  source: string;
  runs: number;
  completed: number;
  blocked: number;
  errors: number;
  last_started_at: number | null;
  last_completed_at: number | null;
  discovered_count: number | null;
  imported_count: number | null;
  snapshot_count: number | null;
}

interface CrawlRun {
  id: number;
  source: string;
  job_type: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  discovered_count: number;
  imported_count: number;
  snapshot_count: number;
  page_count: number;
  blocked_count: number;
  error_count: number;
  message: string | null;
}

interface CrawlerError {
  id: number;
  source: string;
  job_type: string | null;
  project_id: string | null;
  url: string | null;
  status_code: number | null;
  message: string;
  occurred_at: number;
  occurrence_count?: number;
}

type PlatformActionName =
  | 'init_db'
  | 'validate_config'
  | 'dry_run_capabilities'
  | 'crawl'
  | 'import'
  | 'export'
  | 'discover'
  | 'track'
  | 'backlog_sweep';

interface PlatformActionOptions {
  mode?: 'latest' | 'all_available' | 'missing';
  wait?: boolean;
  detailLimit?: number;
  maxDatasets?: number;
  maxPages?: number;
  trackLimit?: number;
  pageBudget?: number;
  sweepOp?: 'start' | 'pause' | 'resume';
}

interface IndiegogoWorkerHealthPayload {
  role: 'live' | 'bulk';
  configured: boolean;
  bases: Array<{
    base: string;
    ok: boolean;
    cleared?: boolean;
    activeFetches?: number;
    queuedFetches?: number;
    breakerOpen: boolean;
    error?: string;
  }>;
}

interface IndiegogoBacklogStatusPayload {
  sweepId: string;
  totalSlices: number;
  byStatus: Record<string, number>;
  discovered: number;
  capped: number;
  updatedAt: number | null;
}

type WebrobotsMonthStatus = 'completed' | 'missing' | 'running' | 'stale' | 'source_unavailable' | 'error' | 'skipped';

interface WebrobotsMonth {
  date: string;
  runId: string | null;
  url: string | null;
  status: WebrobotsMonthStatus;
  runCount: number;
  importedCount: number;
  snapshotCount: number;
  errorCount: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string | null;
}

interface WebrobotsDiagnostics {
  checkedAt: number;
  databaseExists: boolean;
  source: {
    ok: boolean;
    datasetCount: number;
    firstDate: string | null;
    latestDate: string | null;
    latestUrl: string | null;
    error?: string;
  };
  coverage: {
    expected: number;
    completed: number;
    missing: number;
    failed: number;
    running: number;
    stale: number;
    sourceUnavailable: number;
    skipped: number;
    percent: number | null;
  };
  range: {
    firstSnapshotAt: number | null;
    latestSnapshotAt: number | null;
    webrobotsProjects: number;
    webrobotsSnapshots: number;
    webrobotsDetails: number;
  };
  detailQueue: {
    total: number;
    byStatus: Record<string, number>;
  };
  errorSummary: Array<{
    jobType: string | null;
    statusCode: number | null;
    message: string;
    count: number;
    lastOccurredAt: number | null;
  }>;
  months: WebrobotsMonth[];
}

interface PlatformRunRow {
  id: number;
  job_type: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  discovered_count: number;
  imported_count: number;
  snapshot_count: number;
  error_count: number;
  message: string | null;
}

interface PlatformErrorRow {
  id: number;
  job_type: string | null;
  source_project_id?: string | null;
  url: string | null;
  status_code: number | null;
  message: string;
  occurred_at: number;
}

interface DiagnosticsReport {
  generatedAt: number;
  database: {
    path: string;
    fileBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    pageCount: number | null;
    pageSize: number | null;
    freelistCount: number | null;
  };
  storage: {
    dataDir: string;
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    diskFreePct: number | null;
    isCritical: boolean;
  };
  tableSizes: { name: string; rowCount: number }[];
  browserWorker: {
    configured: boolean;
    fetchUrl: string | null;
    timeoutMs: number;
    tokenConfigured: boolean;
  };
  crawlerStates: {
    source: string;
    job_type: string;
    last_status: string | null;
    last_started_at: number | null;
    last_completed_at: number | null;
    blocked_streak: number;
    next_attempt_at: number | null;
    message: string | null;
  }[];
  recentBrowserFallbackErrors: CrawlerError[];
}

interface RecentKsLiveProject {
  id: string;
  name: string;
  state: string;
  category_parent: string | null;
  category_name: string | null;
  country: string | null;
  usd_pledged: number | null;
  backers_count: number | null;
  image_thumb_url: string | null;
  image_url: string | null;
  source_url: string | null;
  ks_live_synced_at: number | null;
  first_seen_at: number | null;
}

interface WorkbenchProject {
  id: string;
  name: string;
  state: string;
  data_source: string | null;
  source_url: string | null;
  creator_slug: string | null;
  slug: string | null;
  image_thumb_url: string | null;
  image_url: string | null;
  usd_pledged: number | null;
  backers_count: number | null;
  goal: number | null;
  currency: string | null;
  launched_at: number | null;
  deadline: number | null;
  latest_snapshot_at: number | null;
  snapshot_count: number;
  reward_count: number;
  collaborator_count: number;
  last_error_at: number | null;
  last_error: string | null;
}

interface WorkbenchPayload {
  rows: WorkbenchProject[];
  total: number;
  limit: number;
  offset: number;
  filter: string;
}

interface KicktraqDayRow {
  date: string;
  pledged_usd: number;
  backers: number;
  comments?: number;
}

interface KicktraqPreviewPayload {
  projectName: string;
  images?: { cachedCount: number; kinds: string[]; bytes: number; fetchedAt: number | null };
  summary: {
    incoming: { pledged_usd: number; backers_count: number; goal_usd: number; currency: string | null } | null;
    current: { pledged_usd: number; backers_count: number; goal_usd: number };
  };
  daily: {
    incoming: { days: KicktraqDayRow[]; count: number; sumPledged: number; sumBackers: number; dateFrom: string | null; dateTo: string | null; imageSource?: 'cache' | 'network' | null } | null;
    current: { snapshotCount: number; kicktraqCount?: number; ownCount?: number; dateFrom: string | null; dateTo: string | null };
  };
  validation?: {
    pledgedMatchPct: number | null;
    backersMatchPct: number | null;
    negativeDays: number;
    confidence: 'high' | 'low' | 'none';
  };
}

interface KickstarterPreviewPayload {
  projectName: string;
  summary: {
    incoming: { pledged_usd: number; backers_count: number; goal_usd: number; state: string | null; currency: string | null } | null;
    current: { pledged_usd: number; backers_count: number; goal_usd: number; state: string | null };
  };
  warning?: string;
}

type SummaryMode = 'overwrite' | 'skip';
type DailyMode = 'overwrite' | 'merge';

interface QualityReport {
  generatedAt: number;
  totals: {
    totalProjects: number;
    liveProjects: number;
    newProjects24h: number;
    webrobotsProjects: number;
    ksLiveProjects: number;
    kicktraqProjects: number;
    missingSourceUrl: number;
    missingSlug: number;
    missingLaunchDate: number;
  };
  snapshots: {
    totalSnapshots: number;
    snapshots24h: number;
    projectsWithSnapshots: number;
    latestSnapshotAt: number | null;
    staleLiveProjects: number;
  };
  tracking: {
    trackedProjects: number;
    dueProjects: number;
    liveTrackable: number;
    autoTrackedLive: number;
    untrackedLive: number;
    untrackableLive: number;
  };
  schedule: {
    overdue: number;
    within1h: number;
    within6h: number;
    within24h: number;
    beyond24h: number;
    batchSize: number;
    concurrency?: number;
    cycleSeconds: number;
    upcoming: {
      id: string;
      name: string;
      state: string;
      lastFetched: number | null;
      nextFetch: number | null;
      consecutiveFailures: number;
    }[];
  };
  sourceHealth: SourceHealth[];
  syncSources: SourceHealth[];
  recentRuns: CrawlRun[];
  recentErrors: CrawlerError[];
  recentKsLiveProjects: RecentKsLiveProject[];
  diagnostics?: DiagnosticsReport | null;
}

interface PlatformQualityPayload {
  ok: true;
  view: PlatformViewId;
  scope: 'legacy' | 'source' | 'global';
  platform: {
    id: string;
    label: string;
    shortLabel: string;
    region: string;
    status: 'legacy_active' | 'source_active' | 'planned';
    samplePlatform: boolean;
    capabilities: Record<string, boolean>;
  } | null;
  database: {
    path: string;
    exists: boolean;
    fileBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    tableCounts: { table: string; rows: number }[];
  };
  status: {
    state: 'legacy_active' | 'planned_empty' | 'initialized' | 'aggregate_empty';
    message: string;
  };
  isolation: {
    writesToLegacyKickstarterDb: boolean;
    canInitialize: boolean;
    canRunCrawler: boolean;
    canImport: boolean;
    canExport: boolean;
    automaticJobsEnabled: boolean;
  };
  recentRuns: unknown[];
  recentErrors: unknown[];
  webrobots?: WebrobotsDiagnostics;
  workers?: { live: IndiegogoWorkerHealthPayload; bulk: IndiegogoWorkerHealthPayload };
  backlog?: IndiegogoBacklogStatusPayload;
}

function fmtNum(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function fmtBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function fmtTime(ts: number | null | undefined, lang: string) {
  if (!ts) return lang === 'cn' ? '暂无' : 'None';
  return new Date(ts * 1000).toLocaleString(lang === 'cn' ? 'zh-CN' : 'en-US');
}

function fmtMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-green-50 text-green-700';
  if (status === 'blocked') return 'bg-amber-50 text-amber-700';
  if (status === 'running') return 'bg-blue-50 text-blue-700';
  return 'bg-red-50 text-red-700';
}

function projectStateClass(state: string) {
  if (state === 'live') return 'bg-blue-50 text-blue-700';
  if (state === 'successful') return 'bg-green-50 text-green-700';
  if (state === 'failed' || state === 'canceled') return 'bg-red-50 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

function stateLabel(state: string, cn: boolean) {
  const map: Record<string, [string, string]> = {
    live: ['进行中', 'Live'],
    successful: ['成功', 'Successful'],
    failed: ['失败', 'Failed'],
    canceled: ['已取消', 'Canceled'],
    suspended: ['已暂停', 'Suspended'],
  };
  const pair = map[state];
  return pair ? (cn ? pair[0] : pair[1]) : state;
}

// Deadline countdown matching the project list's "下线时间" column.
function fmtDeadline(deadline: number | null | undefined, cn: boolean) {
  if (!deadline) return { text: cn ? '未知' : 'Unknown', tone: 'text-gray-400' };
  const now = Math.floor(Date.now() / 1000);
  const diffDays = Math.ceil((deadline - now) / 86400);
  if (diffDays < 0) return { text: cn ? '已结束' : 'Ended', tone: 'text-gray-400' };
  if (diffDays === 0) return { text: cn ? '今天结束' : 'Ends today', tone: 'text-red-600 font-semibold' };
  if (diffDays <= 3) return { text: cn ? `还有 ${diffDays} 天` : `${diffDays}d left`, tone: 'text-red-600 font-semibold' };
  if (diffDays <= 7) return { text: cn ? `还有 ${diffDays} 天` : `${diffDays}d left`, tone: 'text-amber-600 font-medium' };
  return { text: cn ? `还有 ${diffDays} 天` : `${diffDays}d left`, tone: 'text-gray-600' };
}

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    webrobots: 'Webrobots',
    ks_live: 'KS Live',
    kicktraq_active: 'Kicktraq Active',
    kicktraq_full_scan: 'Kicktraq Full Scan',
  };
  return labels[source] ?? source;
}

function platformStatusLabel(status: string, cn: boolean) {
  const map: Record<string, { cn: string; en: string; tone: string }> = {
    aggregate: { cn: '聚合视角', en: 'Aggregate', tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    legacy_active: { cn: '稳定运行', en: 'Legacy active', tone: 'bg-green-50 text-green-700 border-green-100' },
    source_active: { cn: '数据接入', en: 'Data pipeline', tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    planned: { cn: '预留接入', en: 'Planned', tone: 'bg-gray-50 text-gray-600 border-gray-100' },
    initialized: { cn: '已初始化', en: 'Initialized', tone: 'bg-green-50 text-green-700 border-green-100' },
    planned_empty: { cn: '未初始化', en: 'Not initialized', tone: 'bg-amber-50 text-amber-700 border-amber-100' },
    aggregate_empty: { cn: '空聚合库', en: 'Empty aggregate', tone: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  };
  return map[status] ?? { cn: status, en: status, tone: 'bg-gray-50 text-gray-600 border-gray-100' };
}

function platformTableCount(quality: PlatformQualityPayload, table: string) {
  return quality.database.tableCounts.find(item => item.table === table)?.rows ?? 0;
}

function fmtPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'unknown';
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function fmtDateOnly(ts: number | null | undefined) {
  if (!ts) return 'None';
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function PlatformSwitcher({
  value,
  onChange,
  cn,
}: {
  value: PlatformViewId;
  onChange: (value: PlatformViewId) => void;
  cn: boolean;
}) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Globe2 className="h-4 w-4 text-ks-green" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">{cn ? '平台数据域' : 'Platform data domains'}</h2>
          <p className="text-xs text-gray-400">
            {cn ? 'Global 只做聚合读取；各平台写入相互隔离。' : 'Global is read-only aggregation; platform writes are isolated.'}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {PLATFORM_VIEWS.map(view => {
          const meta = platformStatusLabel(view.status, cn);
          const active = value === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onChange(view.id)}
              className={`flex min-w-[132px] items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-ks-green bg-ks-green-light text-ks-green-dark shadow-sm'
                  : 'border-gray-100 bg-white text-gray-600 hover:border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">{view.label}</span>
                <span className="block text-[11px] text-gray-400">{view.shortLabel} · {view.region.toUpperCase()}</span>
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${active ? 'border-ks-green/30 bg-white/70 text-ks-green-dark' : meta.tone}`}>
                {cn ? meta.cn : meta.en}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkerHealthLine({ cn, health }: { cn: boolean; health?: IndiegogoWorkerHealthPayload }) {
  if (!health || !health.configured) {
    return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500">{cn ? 'Worker 未配置' : 'Worker not set'}</span>;
  }
  const anyOk = health.bases.some(b => b.ok);
  const anyCleared = health.bases.some(b => b.cleared);
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${anyOk ? (anyCleared ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700') : 'bg-red-50 text-red-700'}`}>
      {anyOk ? (anyCleared ? (cn ? 'Worker 已过盾' : 'Cleared') : (cn ? 'Worker 在线·未过盾' : 'Online·not cleared')) : (cn ? 'Worker 不可达' : 'Unreachable')}
      {` · ${health.bases.length}`}
    </span>
  );
}

function PipelineCard({
  cn,
  title,
  desc,
  tone,
  badges,
  children,
}: {
  cn: boolean;
  title: string;
  desc: string;
  tone: string;
  badges?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex flex-col rounded-xl border p-5 shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-black">{title}</h3>
          <p className="mt-1 text-sm opacity-80">{desc}</p>
        </div>
      </div>
      {badges && <div className="mt-3 flex flex-wrap gap-2">{badges}</div>}
      <div className="mt-4 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

function IndiegogoControlPanel({
  cn,
  quality,
  loading,
  actionBusy,
  actionMessage,
  onAction,
}: {
  cn: boolean;
  quality: PlatformQualityPayload;
  loading: boolean;
  actionBusy: string | null;
  actionMessage: { kind: 'success' | 'error'; text: string } | null;
  onAction: (action: PlatformActionName, options?: PlatformActionOptions) => void;
}) {
  const webrobots = quality.webrobots;
  const workers = quality.workers;
  const backlog = quality.backlog;
  const actionDisabled = Boolean(actionBusy);
  const dbReady = quality.database.exists;
  const recentRuns = (quality.recentRuns as PlatformRunRow[]).slice(0, 8);
  const recentErrors = (quality.recentErrors as PlatformErrorRow[]).slice(0, 8);
  const projectRows = platformTableCount(quality, 'platform_projects');
  const snapshotRows = platformTableCount(quality, 'platform_snapshots');
  const detailRows = platformTableCount(quality, 'indiegogo_project_details');
  const queueRows = platformTableCount(quality, 'platform_detail_queue');
  const errorRows = platformTableCount(quality, 'platform_crawler_errors');
  const detailQueue = webrobots?.detailQueue.byStatus ?? { queued: 0, ok: 0, error: 0, invalid_slug: 0 };

  const backlogDone = backlog?.byStatus.done ?? 0;
  const backlogRemaining = (backlog?.byStatus.pending ?? 0) + (backlog?.byStatus.in_progress ?? 0);
  const backlogPaused = backlog?.byStatus.paused ?? 0;

  // ---- Admin-facing derived signals (incremental vs backlog) ----------------
  const nowS = Math.floor(Date.now() / 1000);

  const detailOk = detailQueue.ok ?? 0;
  const detailQueued = detailQueue.queued ?? 0;
  const detailErr = (detailQueue.error ?? 0) + (detailQueue.invalid_slug ?? 0);
  const detailTotal = detailOk + detailQueued + detailErr;
  const detailPct = detailTotal > 0 ? Math.round((detailOk / detailTotal) * 1000) / 10 : 0;

  const lastDiscover = recentRuns.find(r => r.job_type === 'discover') ?? null;
  const lastTrack = recentRuns.find(r => r.job_type === 'detail_api') ?? null;
  const lastSweep = recentRuns.find(r => r.job_type === 'backlog_sweep') ?? null;

  const backlogInProgress = backlog?.byStatus.in_progress ?? 0;
  const backlogPending = backlog?.byStatus.pending ?? 0;
  const backlogSplit = backlog?.byStatus.split ?? 0;
  const backlogError = backlog?.byStatus.error ?? 0;
  const backlogTotalSlices = backlog?.totalSlices ?? 0;
  const backlogSettled = backlogDone + backlogSplit;
  const backlogPct = backlogTotalSlices > 0 ? Math.round((backlogSettled / backlogTotalSlices) * 1000) / 10 : 0;
  const backlogDiscovered = backlog?.discovered ?? 0;
  const backlogCapped = backlog?.capped ?? 0;

  // Classify errors: transient worker hiccups (CF challenge page → non-JSON) and
  // dead legacy slugs (detail API 400) are *expected attrition*, not failures.
  // Only real faults (5xx / config / repeated stalls) should colour the badge.
  const isTransientError = (e: PlatformErrorRow) => {
    const m = (e.message ?? '').toLowerCase();
    if (e.status_code === 400) return true;
    return (
      m.includes('invalid_worker_response') ||
      m.includes('invalid_slug') ||
      m.includes('without a usable project') ||
      m.includes('projecturlname')
    );
  };
  const realErrors = recentErrors.filter(e => !isTransientError(e));
  const transientCount = recentErrors.length - realErrors.length;

  // Is the incremental pipeline behaving as expected?
  const liveVerdict = (() => {
    if (!dbReady) return { tone: 'gray', label: cn ? '未初始化' : 'Not initialized', detail: cn ? '先初始化 Indiegogo 数据库。' : 'Initialize the DB first.' };
    if (!lastDiscover) return { tone: 'amber', label: cn ? '尚未运行' : 'Not run yet', detail: cn ? '点「立即发现一轮」开始。' : 'Run discovery once to begin.' };
    if (lastDiscover.status === 'error') return { tone: 'red', label: cn ? '发现报错' : 'Discovery error', detail: lastDiscover.message ?? (cn ? '最近一轮发现失败。' : 'Latest discovery failed.') };
    if (nowS - lastDiscover.started_at > 90 * 60) return { tone: 'amber', label: cn ? '发现停滞' : 'Discovery stalled', detail: cn ? '超过 90 分钟没有发现运行,检查定时任务 / live worker。' : 'No discovery run in 90+ minutes.' };
    if (realErrors.length > 0) return { tone: 'amber', label: cn ? '有错误' : 'Has errors', detail: realErrors[0]?.message ?? '' };
    const note = transientCount > 0
      ? (cn ? `正常推进;偶发损耗 ${fmtNum(transientCount)} 条(死链 slug / worker 抖动,已自动重试 / 退避)。` : `Healthy; ${fmtNum(transientCount)} transient (dead slugs / worker blips, auto-retried/backed off).`)
      : (cn ? '发现按时运行,无错误。' : 'Running on schedule, no errors.');
    return { tone: 'green', label: cn ? '符合预期' : 'Healthy', detail: note };
  })();

  // Does the backlog sweep need a human?
  const backlogVerdict = (() => {
    if (!dbReady) return { tone: 'gray', label: cn ? '未初始化' : 'Not initialized', detail: '' };
    if (backlogTotalSlices === 0) return { tone: 'gray', label: cn ? '尚未启动' : 'Not started', detail: cn ? '点「运行存量一轮」开始穷举目录。' : 'Run the sweep to start enumerating.' };
    if (backlogError > 0) return { tone: 'red', label: cn ? `${backlogError} 个切片失败` : `${backlogError} slices failed`, detail: cn ? '需人工检查后续跑。' : 'Needs a manual check, then resume.' };
    if (backlogPaused > 0 && backlogInProgress === 0 && backlogPending === 0) return { tone: 'amber', label: cn ? '已暂停' : 'Paused', detail: cn ? `点「续跑」继续(暂停 ${fmtNum(backlogPaused)} 个切片)。` : 'Click Resume to continue.' };
    if (backlogSettled >= backlogTotalSlices) return { tone: 'green', label: cn ? '已完成' : 'Complete', detail: cn ? '本轮目录已穷举完毕。' : 'Catalog fully enumerated.' };
    return { tone: 'green', label: cn ? '正在推进' : 'In progress', detail: cn ? '无需人工介入。' : 'No intervention needed.' };
  })();

  const verdictPill = (t: string) =>
    t === 'green' ? 'bg-green-100 text-green-700'
      : t === 'amber' ? 'bg-amber-100 text-amber-700'
        : t === 'red' ? 'bg-red-100 text-red-700'
          : 'bg-gray-100 text-gray-600';

  const MiniStat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-black text-gray-900">{value}</p>
    </div>
  );

  const runConfirmed = (action: PlatformActionName, options: PlatformActionOptions | undefined, message: string) => {
    if (actionDisabled) return;
    if (!window.confirm(message)) return;
    onAction(action, options);
  };

  const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50';
  const btnGhost = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50';

  return (
    <div className="space-y-5">
      {actionMessage && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${actionMessage.kind === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMessage.kind === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {actionMessage.text}
        </div>
      )}

      <section className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 shadow-sm text-emerald-900">
        <div className="flex flex-wrap items-center gap-2">
          <Server className="h-5 w-5" />
          <h2 className="text-xl font-black">{cn ? 'Indiegogo 抓取管线' : 'Indiegogo ingestion pipelines'}</h2>
          {loading && <RefreshCw className="h-4 w-4 animate-spin opacity-70" />}
          {!quality.isolation.automaticJobsEnabled && (
            <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              {cn ? '自动任务未开启 (INDIEGOGO_CRAWLER_ENABLED=1)' : 'Auto jobs off (INDIEGOGO_CRAWLER_ENABLED=1)'}
            </span>
          )}
        </div>
        <p className="mt-2 text-sm opacity-90">
          {cn
            ? '实时发现走 live worker（不可错过）；在筹分级 tracker 走 detail API（不占浏览器车道）；存量扫描走 bulk worker（可暂停/续跑）。'
            : 'Live discovery uses the live worker; the tiered tracker uses the detail API; the backlog sweep uses the bulk worker.'}
        </p>
        {!dbReady && (
          <button type="button" onClick={() => onAction('init_db')} disabled={actionDisabled} className={`mt-4 ${btnPrimary}`}>
            {actionBusy === 'init_db' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {cn ? '初始化 Indiegogo 数据库' : 'Initialize Indiegogo DB'}
          </button>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile icon={Database} label={cn ? '项目总数' : 'Projects'} value={fmtNum(projectRows)} hint={cn ? `详情 ${fmtNum(detailRows)}` : `Details ${fmtNum(detailRows)}`} tone="green" />
        <StatTile icon={Activity} label={cn ? '快照总数' : 'Snapshots'} value={fmtNum(snapshotRows)} hint={cn ? `队列 ${fmtNum(queueRows)}` : `Queue ${fmtNum(queueRows)}`} tone="blue" />
        <StatTile icon={HardDrive} label={cn ? '存量切片进度' : 'Backlog slices'} value={`${fmtNum(backlogDone)} / ${fmtNum(backlogDone + backlogRemaining + backlogPaused)}`} hint={cn ? `已发现 ${fmtNum(backlog?.discovered)} · DB ${fmtBytes(quality.database.fileBytes)}` : `Discovered ${fmtNum(backlog?.discovered)} · DB ${fmtBytes(quality.database.fileBytes)}`} tone={errorRows ? 'amber' : 'green'} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PipelineCard
          cn={cn}
          tone="border-blue-100 bg-blue-50 text-blue-900"
          title={cn ? '实时发现' : 'Live discovery'}
          desc={cn ? '枚举新上线 + 在筹项目，错过不可补。' : 'Enumerate new + ongoing projects; misses are unrecoverable.'}
          badges={<WorkerHealthLine cn={cn} health={workers?.live} />}
        >
          <button type="button" onClick={() => onAction('discover')} disabled={actionDisabled || !dbReady} className={btnPrimary}>
            {actionBusy === 'discover' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {cn ? '立即发现一轮' : 'Run discovery'}
          </button>
        </PipelineCard>

        <PipelineCard
          cn={cn}
          tone="border-green-100 bg-green-50 text-green-900"
          title={cn ? '在筹分级 tracker' : 'Tiered live tracker'}
          desc={cn ? '按价值分档刷新资金/支持者快照（detail API）。' : 'Tiered funding/backer snapshots via the detail API.'}
          badges={<span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">{cn ? `队列 queued ${fmtNum(detailQueue.queued)} · ok ${fmtNum(detailQueue.ok)}` : `queued ${fmtNum(detailQueue.queued)} · ok ${fmtNum(detailQueue.ok)}`}</span>}
        >
          <button type="button" onClick={() => onAction('track')} disabled={actionDisabled || !dbReady} className={btnPrimary}>
            {actionBusy === 'track' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {cn ? '立即跟踪一轮' : 'Run tracker'}
          </button>
        </PipelineCard>

        <PipelineCard
          cn={cn}
          tone="border-purple-100 bg-purple-50 text-purple-900"
          title={cn ? '存量扫描' : 'Backlog sweep'}
          desc={cn ? '按分类递归切片全量目录，可暂停/续跑。' : 'Recursive category sweep of the full catalog; pausable/resumable.'}
          badges={
            <>
              <WorkerHealthLine cn={cn} health={workers?.bulk} />
              <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-semibold">
                {cn ? `完成 ${fmtNum(backlogDone)} · 待跑 ${fmtNum(backlogRemaining)}${backlogPaused ? ` · 暂停 ${fmtNum(backlogPaused)}` : ''}` : `done ${fmtNum(backlogDone)} · todo ${fmtNum(backlogRemaining)}${backlogPaused ? ` · paused ${fmtNum(backlogPaused)}` : ''}`}
              </span>
            </>
          }
        >
          <button
            type="button"
            onClick={() => runConfirmed('backlog_sweep', { sweepOp: 'start' }, cn ? '这会启动一轮存量扫描（按当前页预算消耗），可随时暂停。确定开始吗？' : 'This runs one backlog sweep chunk (page-budget bounded). Continue?')}
            disabled={actionDisabled || !dbReady}
            className={btnPrimary}
          >
            {actionBusy === 'backlog_sweep' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HardDrive className="h-4 w-4" />}
            {cn ? '运行存量一轮' : 'Run sweep'}
          </button>
          <button type="button" onClick={() => onAction('backlog_sweep', { sweepOp: 'pause' })} disabled={actionDisabled} className={btnGhost}>
            {cn ? '暂停' : 'Pause'}
          </button>
          <button type="button" onClick={() => onAction('backlog_sweep', { sweepOp: 'resume' })} disabled={actionDisabled} className={btnGhost}>
            {cn ? '续跑' : 'Resume'}
          </button>
        </PipelineCard>
      </div>

      <section className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <RefreshCw className="h-4 w-4 text-blue-500" />
          <h3 className="font-bold text-gray-900">{cn ? '增量数据 · 实时发现 + 在筹跟踪' : 'Incremental · live discovery + tracker'}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verdictPill(liveVerdict.tone)}`}>{liveVerdict.label}</span>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          {cn
            ? '目标:不漏抓新上线 / 在筹项目,并把每个项目的资金、支持者等富数据(detail)补全。'
            : 'Goal: never miss new/ongoing projects, and fill in each project\'s funding & backer detail.'}
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <p className="text-xs text-gray-500">{cn ? '最近发现' : 'Last discovery'}</p>
            <p className="mt-1 text-sm font-bold text-gray-900">{lastDiscover ? fmtTime(lastDiscover.started_at, cn ? 'cn' : 'en') : (cn ? '从未' : 'never')}</p>
            <p className="text-xs text-gray-400">{cn ? `本轮入库 ${lastDiscover ? fmtNum(lastDiscover.imported_count) : 0}` : `imported ${lastDiscover ? fmtNum(lastDiscover.imported_count) : 0}`}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3" title={cn ? '“变更”只统计本轮数据发生变化的项目;已成功读取但数据未变的不计入。真实累计进度看下方进度条。' : 'Counts only projects whose data changed this round; unchanged reads still mark OK. See the bar below for cumulative progress.'}>
            <p className="text-xs text-gray-500">{cn ? '最近跟踪' : 'Last tracker'}</p>
            <p className="mt-1 text-sm font-bold text-gray-900">{lastTrack ? fmtTime(lastTrack.started_at, cn ? 'cn' : 'en') : (cn ? '从未' : 'never')}</p>
            <p className="text-xs text-gray-400">{cn ? `本轮变更 ${lastTrack ? fmtNum(lastTrack.imported_count) : 0}` : `changed ${lastTrack ? fmtNum(lastTrack.imported_count) : 0}`}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3" title={cn ? '死链 slug / worker 抖动属正常损耗,系统已退避或自动重试。' : 'Dead slugs / worker blips are expected attrition (auto backed-off/retried).'}>
            <p className="text-xs text-gray-500">{cn ? '损耗(失败/无效)' : 'Attrition (failed/invalid)'}</p>
            <p className="mt-1 text-sm font-bold text-gray-900">{fmtNum(detailErr)}</p>
            <p className="text-xs text-gray-400">{realErrors.length > 0 ? (cn ? `真实错误 ${fmtNum(realErrors.length)}` : `real errors ${fmtNum(realErrors.length)}`) : (cn ? '无真实错误' : 'no real errors')}</p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-700">{cn ? 'detail 补全进度' : 'Detail completeness'}</span>
            <span className="text-gray-500">{detailPct}% · {cn ? `已补 ${fmtNum(detailOk)} / 待补 ${fmtNum(detailQueued)}` : `done ${fmtNum(detailOk)} / queued ${fmtNum(detailQueued)}`}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, detailPct)}%` }} />
          </div>
        </div>

        {liveVerdict.detail && <p className="mt-3 text-xs text-gray-500">{liveVerdict.detail}</p>}
      </section>

      <section className="rounded-xl border border-purple-100 bg-white p-5 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <HardDrive className="h-4 w-4 text-purple-500" />
          <h3 className="font-bold text-gray-900">{cn ? '存量数据 · 全量目录扫描' : 'Backlog · full-catalog sweep'}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verdictPill(backlogVerdict.tone)}`}>{backlogVerdict.label}</span>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          {cn
            ? '目标:按 phase × 33 个分类递归切片,穷举全量目录(绕过单查询 1 万条上限)。'
            : 'Goal: enumerate the whole catalog via phase × category recursive slicing (bypassing the 10k per-query cap).'}
        </p>

        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="font-semibold text-gray-700">{cn ? '切片完成进度' : 'Slice progress'}</span>
            <span className="text-gray-500">{backlogPct}% · {cn ? `完成 ${fmtNum(backlogSettled)} / 共 ${fmtNum(backlogTotalSlices)}` : `done ${fmtNum(backlogSettled)} / ${fmtNum(backlogTotalSlices)}`}</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${Math.min(100, backlogPct)}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label={cn ? '已发现项目' : 'Discovered'} value={fmtNum(backlogDiscovered)} />
          <MiniStat label={cn ? '进行中 / 待跑' : 'In progress'} value={fmtNum(backlogInProgress + backlogPending)} />
          <MiniStat label={cn ? '已拆分' : 'Split'} value={fmtNum(backlogSplit)} />
          <MiniStat label={cn ? '封顶切片' : 'Capped'} value={fmtNum(backlogCapped)} />
        </div>

        <p className="mt-3 text-xs text-gray-500">
          {cn ? '最近扫描:' : 'Last sweep: '}
          {lastSweep ? fmtTime(lastSweep.started_at, cn ? 'cn' : 'en') : (cn ? '从未' : 'never')}
          {backlogVerdict.detail ? ` · ${backlogVerdict.detail}` : ''}
        </p>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-500" />
          <h3 className="font-bold text-gray-900">{cn ? '最近运行记录' : 'Recent runs'}</h3>
        </div>
        <div className="space-y-2">
          {recentRuns.map(run => (
            <div key={run.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-gray-500">{run.job_type}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(run.status)}`}>{run.status}</span>
                <span className="text-xs text-gray-400">{fmtTime(run.started_at, cn ? 'cn' : 'en')}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {cn ? '导入' : 'Imported'} {fmtNum(run.imported_count)} · {cn ? '快照' : 'Snapshots'} {fmtNum(run.snapshot_count)} · {cn ? '错误' : 'Errors'} {fmtNum(run.error_count)}
              </p>
              {run.message && <p className="mt-1 line-clamp-2 text-xs text-gray-400">{run.message}</p>}
            </div>
          ))}
          {!recentRuns.length && <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">{cn ? '暂无运行记录。' : 'No runs yet.'}</p>}
        </div>
      </section>
    </div>
  );
}

function PlatformIsolationPanel({
  cn,
  quality,
  loading,
  actionBusy,
  actionMessage,
  onAction,
}: {
  cn: boolean;
  quality: PlatformQualityPayload | null;
  loading: boolean;
  actionBusy: string | null;
  actionMessage: { kind: 'success' | 'error'; text: string } | null;
  onAction: (action: PlatformActionName, options?: PlatformActionOptions) => void;
}) {
  if (loading && !quality) {
    return (
      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {cn ? '正在读取平台隔离状态...' : 'Loading platform isolation status...'}
        </div>
      </section>
    );
  }

  if (!quality) {
    return (
      <section className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm text-red-700">
        {cn ? '平台状态暂不可用。' : 'Platform status is unavailable.'}
      </section>
    );
  }

  if (quality.view === 'indiegogo') {
    return (
      <IndiegogoControlPanel
        cn={cn}
        quality={quality}
        loading={loading}
        actionBusy={actionBusy}
        actionMessage={actionMessage}
        onAction={onAction}
      />
    );
  }

  const statusMeta = platformStatusLabel(quality.status.state, cn);
  const tableCounts = quality.database.tableCounts.length
    ? quality.database.tableCounts
    : [
        { table: quality.scope === 'global' ? 'global_projects' : 'platform_projects', rows: 0 },
        { table: quality.scope === 'global' ? 'global_snapshots' : 'platform_snapshots', rows: 0 },
        { table: quality.scope === 'global' ? 'global_refresh_runs' : 'platform_crawl_runs', rows: 0 },
      ];
  const actionDisabled = Boolean(actionBusy);
  const platformActions: Array<{
    action: 'crawl' | 'import' | 'export';
    enabled: boolean;
    label: string;
    title: string;
  }> = [
    {
      action: 'crawl',
      enabled: quality.isolation.canRunCrawler,
      label: cn ? 'CRAWL · 活跃同步' : 'CRAWL · active sync',
      title: cn ? '同步当前活跃项目，并刷新一批详情队列' : 'Sync currently active projects and refresh a detail batch',
    },
    {
      action: 'import',
      enabled: quality.isolation.canImport,
      label: cn ? 'IMPORT · 历史导入' : 'IMPORT · history import',
      title: cn ? '从 Webrobots Indiegogo 历史数据集后台导入' : 'Import Webrobots Indiegogo history in the background',
    },
    {
      action: 'export',
      enabled: quality.isolation.canExport,
      label: cn ? 'EXPORT · 未接入' : 'EXPORT · not wired',
      title: cn ? '导出能力尚未接入' : 'Export is not wired yet',
    },
  ];
  const capabilityRows = [
    {
      label: cn ? '隔离数据库' : 'Isolated source DB',
      enabled: quality.scope === 'global' || Boolean(quality.platform?.capabilities.isolatedDb),
      note: quality.scope === 'global'
        ? (cn ? 'Global 使用独立聚合库' : 'Global uses its own aggregation DB')
        : quality.database.path,
    },
    {
      label: cn ? 'Global 聚合' : 'Global aggregation',
      enabled: quality.scope === 'global' || Boolean(quality.platform?.capabilities.globalAggregation),
      note: cn ? '只读 source DB，可重建' : 'Reads source DBs and remains rebuildable',
    },
    {
      label: cn ? '真实爬取' : 'Real crawler',
      enabled: quality.isolation.canRunCrawler,
      note: quality.isolation.canRunCrawler
        ? (cn ? '沿用现有稳定链路' : 'Uses the existing stable pipeline')
        : (cn ? '第一阶段未接入' : 'Not wired in phase one'),
    },
    {
      label: cn ? '导入/导出' : 'Import/export',
      enabled: quality.isolation.canImport || quality.isolation.canExport,
      note: quality.isolation.canImport || quality.isolation.canExport
        ? (cn ? '沿用现有稳定链路' : 'Uses the existing stable pipeline')
        : (cn ? '接口保留，真实动作返回 501' : 'Reserved API; real actions return 501'),
    },
    {
      label: cn ? '自动任务' : 'Automatic jobs',
      enabled: quality.isolation.automaticJobsEnabled,
      note: quality.isolation.automaticJobsEnabled
        ? (cn ? '仅 Kickstarter 旧链路' : 'Only the Kickstarter legacy flow')
        : (cn ? '不开 cron，不启动后台 crawl' : 'No cron or background crawl is started'),
    },
  ];

  return (
    <div className="space-y-5">
      {actionMessage && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${actionMessage.kind === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {actionMessage.kind === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {actionMessage.text}
        </div>
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              {quality.scope === 'global' ? <Layers className="h-5 w-5 text-indigo-500" /> : <Server className="h-5 w-5 text-ks-green" />}
              <h2 className="text-lg font-bold text-gray-900">
                {quality.scope === 'global' ? 'Global' : quality.platform?.label}
              </h2>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusMeta.tone}`}>
                {cn ? statusMeta.cn : statusMeta.en}
              </span>
              {quality.platform?.samplePlatform && (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {cn ? '样板优先' : 'Sample first'}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-3xl text-sm text-gray-500">
              {quality.status.message}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onAction('init_db')}
            disabled={!quality.isolation.canInitialize || actionDisabled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Database className={`h-4 w-4 ${actionBusy === 'init_db' ? 'animate-pulse' : ''}`} />
            {quality.database.exists ? (cn ? '重新确认 DB' : 'Confirm DB') : (cn ? '初始化 DB' : 'Initialize DB')}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatTile
          icon={Database}
          label={cn ? '隔离数据库' : 'Isolated database'}
          value={quality.database.exists ? (cn ? '已存在' : 'Exists') : (cn ? '未创建' : 'Missing')}
          hint={quality.database.path}
          tone={quality.database.exists ? 'green' : 'amber'}
        />
        <StatTile
          icon={HardDrive}
          label={cn ? '文件大小' : 'File size'}
          value={fmtBytes(quality.database.fileBytes)}
          hint={`WAL ${fmtBytes(quality.database.walBytes)} · SHM ${fmtBytes(quality.database.shmBytes)}`}
          tone="blue"
        />
        <StatTile
          icon={Lock}
          label={cn ? 'Kickstarter 写入' : 'Kickstarter writes'}
          value={quality.isolation.writesToLegacyKickstarterDb ? (cn ? '旧链路' : 'Legacy') : (cn ? '禁止' : 'Blocked')}
          hint={quality.isolation.writesToLegacyKickstarterDb
            ? (cn ? '仅 Kickstarter tab 使用旧库' : 'Only Kickstarter tab uses the legacy DB')
            : (cn ? '该平台不会写入 kickstarter.db' : 'This view does not write to kickstarter.db')}
          tone={quality.isolation.writesToLegacyKickstarterDb ? 'amber' : 'green'}
        />
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">{cn ? '标准化表结构' : 'Standardized schema'}</h3>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {tableCounts.map(item => (
            <div key={item.table} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              <p className="font-mono text-xs text-gray-500">{item.table}</p>
              <p className="mt-1 text-lg font-black text-gray-900">{fmtNum(item.rows)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ks-green" />
          <h3 className="font-semibold text-gray-900">{cn ? '第一阶段操作接口' : 'Phase-one action interface'}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAction('validate_config')}
            disabled={actionDisabled}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cn ? '校验配置' : 'Validate config'}
          </button>
          <button
            type="button"
            onClick={() => onAction('dry_run_capabilities')}
            disabled={actionDisabled}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {cn ? 'Dry-run 能力检查' : 'Dry-run capabilities'}
          </button>
          {platformActions.map(item => (
            <button
              key={item.action}
              type="button"
              onClick={() => onAction(item.action)}
              disabled={actionDisabled || !item.enabled}
              className={
                item.enabled
                  ? 'rounded-lg border border-ks-green/30 bg-ks-green-light px-3 py-2 text-sm font-semibold text-ks-green-dark hover:bg-green-100 disabled:opacity-50'
                  : 'rounded-lg border border-dashed border-gray-200 px-3 py-2 text-sm font-semibold text-gray-400 hover:bg-gray-50 disabled:opacity-50'
              }
              title={item.title}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-400">
          {cn ? '不会开启自动 cron。已接入的平台可手动触发 crawl/import；未接入的动作会保持禁用。' : 'No automatic cron is started. Wired platforms can run crawl/import manually; unavailable actions stay disabled.'}
        </p>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-4 w-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">{cn ? '能力清单' : 'Capability checklist'}</h3>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {capabilityRows.map(item => (
            <div key={item.label} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
              {item.enabled ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ks-green" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              )}
              <div>
                <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-400">{item.note}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <Activity className="h-4 w-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">{cn ? '运行记录' : 'Run history'}</h3>
        </div>
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
          {cn ? '第一阶段暂无真实爬取运行记录。' : 'No real crawl runs exist in phase one.'}
        </div>
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-gray-500" />
          <h3 className="font-semibold text-gray-900">{cn ? '错误摘要' : 'Error summary'}</h3>
        </div>
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-400">
          {quality.recentErrors.length
            ? (cn ? '已有错误记录，后续接入真实爬虫后会在这里展示。' : 'Error records exist and will be shown here when real crawlers are wired.')
            : (cn ? '暂无平台爬取错误。' : 'No platform crawler errors yet.')}
        </div>
      </section>
    </div>
  );
}

function fmtRelative(ts: number | null | undefined, cn: boolean) {
  if (!ts) return cn ? '暂无' : 'never';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60) return cn ? `${ahead} 秒后` : `in ${ahead}s`;
    if (ahead < 3600) return cn ? `${Math.round(ahead / 60)} 分钟后` : `in ${Math.round(ahead / 60)}m`;
    return cn ? `${Math.round(ahead / 3600)} 小时后` : `in ${Math.round(ahead / 3600)}h`;
  }
  if (diff < 60) return cn ? '刚刚' : 'just now';
  if (diff < 3600) return cn ? `${Math.round(diff / 60)} 分钟前` : `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return cn ? `${Math.round(diff / 3600)} 小时前` : `${Math.round(diff / 3600)}h ago`;
  return cn ? `${Math.round(diff / 86400)} 天前` : `${Math.round(diff / 86400)}d ago`;
}

const CRAWL_STATUS_META: Record<string, { tone: string; dot: string; cn: string; en: string }> = {
  running: { tone: 'bg-blue-50 text-blue-700 border-blue-200', dot: 'bg-blue-500', cn: '运行中', en: 'Running' },
  completed: { tone: 'bg-green-50 text-green-700 border-green-200', dot: 'bg-green-500', cn: '正常', en: 'Healthy' },
  blocked: { tone: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500', cn: '被拦截', en: 'Blocked' },
  error: { tone: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-500', cn: '出错', en: 'Error' },
};

type WorkerVerdict = 'unconfigured' | 'unreachable' | 'browser_down' | 'ip_blocked' | 'degraded' | 'healthy';

interface WorkerLiveStatus {
  configured: boolean;
  reachable: boolean;
  verdict: WorkerVerdict;
  message?: string;
  browserConnected?: boolean | null;
  browserVersion?: string | null;
  proxyConfigured?: boolean;
  proxyServer?: string | null;
  warmupOk?: boolean | null;
  warmupAttempts?: number | null;
  warmupLastError?: string | null;
  warmupLastAt?: string | null;
  memoryRssMb?: number | null;
  uptimeSec?: number | null;
  checkedAt: number;
}

const WORKER_VERDICT_META: Record<WorkerVerdict, { tone: string; dot: string; cn: string; en: string }> = {
  healthy: { tone: 'border-green-200 bg-green-50 text-green-800', dot: 'bg-green-500', cn: '正常', en: 'Healthy' },
  ip_blocked: { tone: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500', cn: 'IP 被 Cloudflare 拦截', en: 'IP blocked by Cloudflare' },
  browser_down: { tone: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500', cn: '浏览器未启动', en: 'Browser down' },
  unreachable: { tone: 'border-red-200 bg-red-50 text-red-800', dot: 'bg-red-500', cn: 'Worker 不可达', en: 'Worker unreachable' },
  unconfigured: { tone: 'border-gray-200 bg-gray-50 text-gray-600', dot: 'bg-gray-400', cn: '未配置 Worker', en: 'Worker not configured' },
  degraded: { tone: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', cn: '状态未知', en: 'Degraded' },
};

function workerVerdictHint(s: WorkerLiveStatus, cn: boolean): string {
  switch (s.verdict) {
    case 'healthy':
      return cn ? '浏览器已连接，预热访问 Kickstarter 成功，可正常抓取。' : 'Browser connected and Kickstarter warmup succeeded.';
    case 'ip_blocked':
      return cn
        ? '浏览器本身正常，但访问 Kickstarter 被返回 403。多半是机房 IP 被 Cloudflare 拦截——需要给 worker 配住宅代理。'
        : 'Browser is fine but Kickstarter returns 403 — datacenter IP is blocked by Cloudflare. Configure a residential proxy on the worker.';
    case 'browser_down':
      return cn ? 'Worker 在线，但 Chromium 没能启动/连接,抓取无法进行。' : 'Worker is up but Chromium failed to launch/connect.';
    case 'unreachable':
      return cn ? '主服务连不上 worker 的 /diag,可能 worker 重启中或挂了。' : 'Main service cannot reach worker /diag; it may be restarting or down.';
    case 'unconfigured':
      return cn ? '主服务未配置 worker 地址 (KICKSTARTER_BROWSER_FETCH_URL)。' : 'Main service has no worker URL configured.';
    default:
      return cn ? 'Worker 在线,但预热状态未知。' : 'Worker is up but warmup state is unknown.';
  }
}

function WorkerHealthBanner({ cn }: { cn: boolean }) {
  const [status, setStatus] = useState<WorkerLiveStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch('/api/data-quality/worker', { cache: 'no-store' });
        const data = (await res.json()) as WorkerLiveStatus;
        if (active) setStatus(data);
      } catch {
        /* keep last known */
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading && !status) {
    return (
      <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-400">
        {cn ? '正在检测浏览器 Worker 实时状态…' : 'Checking browser worker live status…'}
      </div>
    );
  }
  if (!status) return null;

  const meta = WORKER_VERDICT_META[status.verdict] ?? WORKER_VERDICT_META.degraded;
  const proxyLabel = status.proxyConfigured
    ? (cn ? '代理 ✓' : 'Proxy ✓')
    : (cn ? '代理 ✗（直连机房 IP）' : 'Proxy ✗ (datacenter IP)');

  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 ${meta.tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${meta.dot} ${status.verdict === 'healthy' ? 'animate-pulse' : ''}`} />
          <span className="font-semibold text-sm">{cn ? '浏览器 Worker：' : 'Browser worker: '}{cn ? meta.cn : meta.en}</span>
        </div>
        {status.reachable && (
          <div className="flex items-center gap-2 flex-shrink-0 text-[11px] font-medium">
            <span className={`rounded-full px-2 py-0.5 border ${status.proxyConfigured ? 'border-green-200 bg-green-50 text-green-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>{proxyLabel}</span>
            {status.browserConnected != null && (
              <span className={`rounded-full px-2 py-0.5 border ${status.browserConnected ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                {status.browserConnected ? (cn ? '浏览器 ✓' : 'Browser ✓') : (cn ? '浏览器 ✗' : 'Browser ✗')}
              </span>
            )}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs opacity-90">{workerVerdictHint(status, cn)}</p>
      {(status.warmupLastError || status.message) && (
        <p className="mt-1 text-[11px] font-mono opacity-70 line-clamp-2" title={status.warmupLastError ?? status.message ?? ''}>
          {status.warmupLastError ?? status.message}
        </p>
      )}
    </div>
  );
}

function CrawlStatusSection({
  diagnostics,
  latestSnapshotAt,
  staleLiveProjects,
  liveProjects,
  cn,
  lang,
}: {
  diagnostics: DiagnosticsReport | null | undefined;
  latestSnapshotAt: number | null;
  staleLiveProjects: number;
  liveProjects: number;
  cn: boolean;
  lang: string;
}) {
  const states = diagnostics?.crawlerStates ?? [];
  const fmtTimeLocal = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toLocaleString(lang === 'cn' ? 'zh-CN' : 'en-US') : (cn ? '暂无' : 'None'));
  const staleTone = staleLiveProjects === 0 ? 'green' : staleLiveProjects > 100 ? 'red' : 'amber';
  const staleToneCls = staleTone === 'green' ? 'text-green-700' : staleTone === 'red' ? 'text-red-700' : 'text-amber-700';

  return (
    <section className="bg-white border border-gray-100 rounded-lg p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ks-green opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-ks-green" />
          </span>
          <h2 className="font-semibold text-gray-800">{cn ? '实时爬取状态' : 'Live Crawl Status'}</h2>
        </div>
        <span className="text-xs text-gray-400">{cn ? '每 30 秒自动刷新' : 'Auto-refresh 30s'}</span>
      </div>

      <WorkerHealthBanner cn={cn} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{cn ? '最新数据打点' : 'Latest snapshot'}</p>
          <p className="text-base font-bold text-gray-900 mt-1">{fmtRelative(latestSnapshotAt, cn)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">{fmtTimeLocal(latestSnapshotAt)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{cn ? '打点滞后的进行中项目' : 'Live projects behind'}</p>
          <p className={`text-base font-bold mt-1 ${staleToneCls}`}>{fmtNum(staleLiveProjects)}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {cn ? `超过 6 小时未更新 / 共 ${fmtNum(liveProjects)} 个进行中` : `>6h without update / ${fmtNum(liveProjects)} live`}
          </p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <p className="text-xs text-gray-500">{cn ? '抓取任务' : 'Crawl jobs'}</p>
          <p className="text-base font-bold text-gray-900 mt-1">{states.length}</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {cn
              ? `${states.filter(s => s.last_status === 'blocked' || s.last_status === 'error').length} 个异常`
              : `${states.filter(s => s.last_status === 'blocked' || s.last_status === 'error').length} unhealthy`}
          </p>
        </div>
      </div>

      {states.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {states.map(s => {
            const meta = CRAWL_STATUS_META[s.last_status ?? ''] ?? { tone: 'bg-gray-50 text-gray-600 border-gray-200', dot: 'bg-gray-400', cn: s.last_status ?? '未知', en: s.last_status ?? 'Unknown' };
            return (
              <div key={`${s.source}:${s.job_type}`} className={`rounded-lg border p-3 ${s.last_status === 'blocked' || s.last_status === 'error' ? 'border-amber-200 bg-amber-50/30' : 'border-gray-100 bg-white'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{sourceLabel(s.source)}</p>
                    <p className="text-[11px] text-gray-400 font-mono truncate">{s.job_type}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold flex-shrink-0 ${meta.tone}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${s.last_status === 'running' ? 'animate-pulse' : ''}`} />
                    {cn ? meta.cn : meta.en}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-gray-400">{cn ? '上次完成' : 'Last run'}</span>
                    <p className="text-gray-700 font-medium">{fmtRelative(s.last_completed_at, cn)}</p>
                  </div>
                  <div>
                    <span className="text-gray-400">{cn ? '下次尝试' : 'Next attempt'}</span>
                    <p className="text-gray-700 font-medium">{s.next_attempt_at ? fmtRelative(s.next_attempt_at, cn) : '—'}</p>
                  </div>
                </div>
                {s.blocked_streak > 0 && (
                  <p className="mt-2 text-[11px] font-medium text-amber-700">
                    {cn ? `连续被拦截 ${s.blocked_streak} 次` : `Blocked ${s.blocked_streak}× in a row`}
                  </p>
                )}
                {s.message && (
                  <p className="mt-1 text-[11px] text-gray-500 line-clamp-2" title={s.message}>{s.message}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
          {cn ? '暂无抓取任务状态，下一轮调度后会显示。' : 'No crawler state yet; appears after the next scheduled run.'}
        </div>
      )}
    </section>
  );
}

function StorageSection({ diagnostics, cn }: { diagnostics: DiagnosticsReport; cn: boolean }) {
  const dbBytes = (diagnostics.database.fileBytes ?? 0) + (diagnostics.database.walBytes ?? 0) + (diagnostics.database.shmBytes ?? 0);
  const diskFreeBytes = diagnostics.storage.diskFreeBytes;
  const diskFreePct = diagnostics.storage.diskFreePct;
  const diskCritical = diagnostics.storage.isCritical;
  const workerOk = diagnostics.browserWorker.configured;

  return (
    <section className={`rounded-lg border p-5 ${diskCritical || !workerOk ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center gap-2 mb-4">
        <HardDrive className={`w-4 h-4 ${diskCritical ? 'text-red-500' : 'text-ks-green'}`} />
        <h2 className="font-semibold text-gray-800">{cn ? '存储与运行环境' : 'Storage & Environment'}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`rounded-lg p-4 border ${diskCritical ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
          <p className="text-xs text-gray-500">{cn ? '磁盘可用空间' : 'Disk free space'}</p>
          <p className={`text-2xl font-bold mt-1 ${diskCritical ? 'text-red-700' : 'text-gray-900'}`}>
            {fmtBytes(diskFreeBytes)}
            {diskFreePct !== null && <span className="text-sm text-gray-500 font-normal ml-2">({diskFreePct}%)</span>}
          </p>
          <p className="text-xs text-gray-400 mt-1 truncate" title={diagnostics.storage.dataDir}>
            {cn ? `数据目录: ${diagnostics.storage.dataDir}` : `Data dir: ${diagnostics.storage.dataDir}`}
          </p>
          {diskCritical && (
            <p className="text-xs text-red-600 mt-2 font-medium">
              {cn
                ? '⚠ 空间紧张：去 Railway 给 volume 扩容'
                : '⚠ Critically low — expand the Railway volume.'}
            </p>
          )}
        </div>

        <div className="rounded-lg p-4 border border-gray-100 bg-white">
          <p className="text-xs text-gray-500">{cn ? 'SQLite 总占用' : 'SQLite total size'}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmtBytes(dbBytes)}</p>
          <p className="text-xs text-gray-400 mt-1">
            DB {fmtBytes(diagnostics.database.fileBytes)} · WAL {fmtBytes(diagnostics.database.walBytes)} · SHM {fmtBytes(diagnostics.database.shmBytes)}
          </p>
        </div>

        <div className={`rounded-lg p-4 border ${workerOk ? 'border-gray-100 bg-white' : 'border-amber-200 bg-amber-50'}`}>
          <p className="text-xs text-gray-500">Browser Worker</p>
          <p className={`text-2xl font-bold mt-1 ${workerOk ? 'text-gray-900' : 'text-amber-700'}`}>
            {workerOk ? (cn ? '已配置' : 'Configured') : (cn ? '未配置' : 'Not configured')}
          </p>
          {workerOk ? (
            <p className="text-xs text-gray-400 mt-1 truncate">
              {diagnostics.browserWorker.fetchUrl}
              {diagnostics.browserWorker.tokenConfigured ? ' · token ✓' : ' · token ✗'}
            </p>
          ) : (
            <p className="text-xs text-amber-600 mt-1">
              {cn
                ? 'KS Live 抓取依赖 browser-worker，否则会被 Cloudflare 拦截'
                : 'KS Live fetching needs browser-worker; without it Cloudflare blocks every request.'}
            </p>
          )}
        </div>
      </div>

      {diagnostics.tableSizes.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
            {cn ? '展开各表行数（用于排查表膨胀）' : 'Show table row counts (for spotting bloat)'}
          </summary>
          <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {diagnostics.tableSizes.map(t => (
              <div key={t.name} className="rounded bg-gray-50 px-2 py-1.5 flex justify-between">
                <span className="text-gray-600 font-mono">{t.name}</span>
                <span className="font-semibold text-gray-900">{fmtNum(t.rowCount)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function TrackingSection({ report, cn }: { report: QualityReport; cn: boolean }) {
  const t = report.tracking;
  const s = report.schedule;
  const untrackable = t.untrackableLive ?? Math.max(0, report.totals.liveProjects - t.liveTrackable);

  const perHour = s.cycleSeconds > 0 ? Math.round((s.batchSize / s.cycleSeconds) * 3600) : 0;
  const drainHours = perHour > 0 ? Math.ceil(s.overdue / perHour) : null;

  const buckets = [
    { key: 'overdue', label: cn ? '待抓（已到期）' : 'Due now', value: s.overdue, color: 'bg-amber-400', text: 'text-amber-700' },
    { key: 'within1h', label: cn ? '1 小时内' : '< 1h', value: s.within1h, color: 'bg-blue-400', text: 'text-blue-700' },
    { key: 'within6h', label: cn ? '6 小时内' : '< 6h', value: s.within6h, color: 'bg-ks-green', text: 'text-green-700' },
    { key: 'within24h', label: cn ? '24 小时内' : '< 24h', value: s.within24h, color: 'bg-teal-400', text: 'text-teal-700' },
    { key: 'beyond24h', label: cn ? '更久' : '> 24h', value: s.beyond24h, color: 'bg-gray-300', text: 'text-gray-600' },
  ];
  const bucketTotal = Math.max(1, buckets.reduce((sum, b) => sum + b.value, 0));

  const fmtSched = (ts: number | null) => {
    if (!ts) return cn ? '未排期' : 'unscheduled';
    return fmtRelative(ts, cn);
  };

  return (
    <section className="bg-white border border-gray-100 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <RadioTower className="w-4 h-4 text-ks-green" />
        <h2 className="font-semibold text-gray-800">{cn ? '追踪覆盖与排期' : 'Tracking Coverage & Schedule'}</h2>
          </div>

      {/* Coverage breakdown — explains why "tracking now" < total live projects.
          Rendered as one stacked bar + compact legend so we don't repeat the
          hero "tracking now" number as another giant tile. */}
      {(() => {
        const liveTotal = Math.max(1, report.totals.liveProjects);
        const segs = [
          { key: 'tracked', label: cn ? '已追踪' : 'Tracking', value: t.autoTrackedLive, color: 'bg-ks-green', text: 'text-green-700' },
          { key: 'pending', label: cn ? '待纳入' : 'Pending', value: t.untrackedLive, color: 'bg-amber-400', text: 'text-amber-700' },
          { key: 'untrackable', label: cn ? '不可追踪' : 'Untrackable', value: untrackable, color: 'bg-gray-300', text: 'text-gray-500' },
        ];
                return (
          <div>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-gray-500">{cn ? '进行中项目' : 'Live projects'}</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtNum(report.totals.liveProjects)}</p>
            </div>
            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              {segs.map(seg => (
                seg.value > 0 ? <div key={seg.key} className={seg.color} style={{ width: `${(seg.value / liveTotal) * 100}%` }} title={`${seg.label}: ${seg.value}`} /> : null
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
              {segs.map(seg => (
                <span key={seg.key} className="inline-flex items-center gap-1.5 text-xs">
                  <span className={`h-2 w-2 rounded-full ${seg.color}`} />
                  <span className="text-gray-500">{seg.label}</span>
                  <span className={`font-semibold tabular-nums ${seg.text}`}>{fmtNum(seg.value)}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3 leading-relaxed">
              {cn
                ? `“已追踪”就是顶部的“实时追踪中”。“待纳入”是可追踪但还没轮到入队的（每 15 分钟批量自动纳入，通常为 0）。“不可追踪”是缺少可用 Kickstarter 链接/slug 的进行中项目，系统拼不出抓取地址、无法定时打点——这就是进行中总数比追踪数多出来的差额。这类多来自 webrobots 批量数据里 slug 缺失的记录；我们已改用项目 URL 兜底解析，后续 webrobots 同步会逐步把这部分补回、差额会缩小。`
                : `"Tracking" is the hero "Tracking now" number. "Pending" are trackable but not-yet-enrolled (auto-enrolled every 15 min, usually 0). "Untrackable" are live projects missing a usable Kickstarter URL/slug, so no fetch URL can be built — that's exactly the gap between live total and tracked. These are mostly webrobots rows with a missing slug; the import now falls back to the project URL, so future syncs recover them and the gap shrinks.`}
            </p>
          </div>
        );
      })()}

      {/* Cadence rules */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-600 mb-2">{cn ? '抓取节奏（按项目热度）' : 'Refresh cadence (by project heat)'}</p>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-blue-50 text-blue-700 px-2.5 py-1">{cn ? '每 1 小时：发布首日 / 临近截止 48h / 高优先' : 'Every 1h: first day / last 48h / high priority'}</span>
          <span className="rounded-full bg-green-50 text-green-700 px-2.5 py-1">{cn ? '每 2 小时：热门（≥$500k 或 ≥5000 支持者）' : 'Every 2h: hot (≥$500k or ≥5000 backers)'}</span>
          <span className="rounded-full bg-gray-100 text-gray-600 px-2.5 py-1">{cn ? '每 24 小时：普通进行中项目' : 'Every 24h: normal live projects'}</span>
          <span className="rounded-full bg-amber-50 text-amber-700 px-2.5 py-1">{cn ? '失败重试：30m → 2h → 6h → 24h' : 'Retry backoff: 30m → 2h → 6h → 24h'}</span>
        </div>
      </div>

      {/* Schedule distribution */}
      <div className="mt-5 pt-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-600">{cn ? '下次抓取排期分布' : 'Next-fetch schedule'}</p>
          <p className="text-[11px] text-gray-400">
            {cn
              ? `每 ${Math.round(s.cycleSeconds / 60)} 分钟一批 · 每批 ${s.batchSize} 个${s.concurrency ? ` · ${s.concurrency} 路并发` : ''} ≈ ${fmtNum(perHour)}/小时`
              : `${s.batchSize}/batch every ${Math.round(s.cycleSeconds / 60)}m${s.concurrency ? ` · ${s.concurrency}-way parallel` : ''} ≈ ${fmtNum(perHour)}/h`}
          </p>
        </div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
          {buckets.map(b => (
            b.value > 0 ? <div key={b.key} className={b.color} style={{ width: `${(b.value / bucketTotal) * 100}%` }} title={`${b.label}: ${b.value}`} /> : null
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {buckets.map(b => (
            <div key={b.key} className="rounded-lg border border-gray-100 px-2.5 py-2">
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${b.color}`} />
                <span className="text-[11px] text-gray-500">{b.label}</span>
              </div>
              <p className={`text-lg font-bold mt-0.5 tabular-nums ${b.text}`}>{fmtNum(b.value)}</p>
            </div>
          ))}
        </div>
        {s.overdue > 0 && drainHours !== null && (
          <p className="text-xs text-gray-400 mt-3">
            {cn
              ? `当前有 ${fmtNum(s.overdue)} 个已到期待抓，按上面的吞吐速度约需 ${drainHours} 小时清空（每条走 Kicktraq 摘要抓取，实际速度可能略有波动）。`
              : `${fmtNum(s.overdue)} overdue now — at the throughput above it takes ~${drainHours}h to clear (each scrape uses the Kicktraq summary path).`}
          </p>
        )}
      </div>

      {/* Upcoming queue */}
      {s.upcoming.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-600 mb-2">{cn ? '即将 / 最该抓取的项目' : 'Next up in the queue'}</p>
          <div className="rounded-lg border border-gray-100 divide-y divide-gray-50">
            {s.upcoming.map(p => {
              const due = !p.nextFetch || p.nextFetch * 1000 <= Date.now();
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <a href={`/projects/${p.id}`} target="_blank" rel="noreferrer" className="min-w-0 text-sm text-gray-800 hover:text-ks-green truncate">
                    {p.name || p.id}
                  </a>
                  <div className="flex items-center gap-3 flex-shrink-0 text-[11px]">
                    {p.consecutiveFailures > 0 && (
                      <span className="text-red-600">{cn ? `失败 ${p.consecutiveFailures}×` : `${p.consecutiveFailures} fails`}</span>
                    )}
                    <span className="text-gray-400">
                      {cn ? '上次 ' : 'last '}{p.lastFetched ? fmtRelative(p.lastFetched, cn) : (cn ? '从未' : 'never')}
                    </span>
                    <span className={`font-semibold ${due ? 'text-amber-700' : 'text-gray-600'}`}>
                      {due ? (cn ? '待抓' : 'due') : `${cn ? '下次 ' : 'next '}${fmtSched(p.nextFetch)}`}
                    </span>
                  </div>
                </div>
                );
              })}
          </div>
        </div>
      )}
    </section>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <Info className="h-3.5 w-3.5 text-gray-300 hover:text-gray-500 cursor-help" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-72 -translate-x-1/2 whitespace-pre-line rounded-lg bg-gray-900 px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

function Pager({ page, totalPages, onChange, cn }: { page: number; totalPages: number; onChange: (p: number) => void; cn: boolean }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-100 text-xs text-gray-500">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 0}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {cn ? '上一页' : 'Prev'}
      </button>
      <span className="tabular-nums">{cn ? `第 ${page + 1} / ${totalPages} 页` : `${page + 1} / ${totalPages}`}</span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {cn ? '下一页' : 'Next'}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tip,
  tone = 'gray',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tip?: string;
  tone?: 'gray' | 'green' | 'blue' | 'amber' | 'red';
}) {
  const tones = {
    gray: 'bg-gray-50 text-gray-600',
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };

  return (
    <div className="border border-gray-100 rounded-lg p-4 bg-white">
      <div className="flex items-center justify-between gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tones[tone]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      </div>
      <p className="text-sm font-medium text-gray-700 mt-3 flex items-center gap-1.5">
        {label}
        {tip && <InfoTip text={tip} />}
      </p>
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );
}

export default function DataQualityPage() {
  const [lang] = useLanguage();
  const [reportState, setReport] = useState<QualityReport | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [workbenchFilter, setWorkbenchFilter] = useState('all');
  const [workbenchQuery, setWorkbenchQuery] = useState('');
  const [workbenchState, setWorkbenchState] = useState('all');
  const [workbenchMinPledged, setWorkbenchMinPledged] = useState('');
  const [workbenchMaxPledged, setWorkbenchMaxPledged] = useState('');
  const [workbenchSort, setWorkbenchSort] = useState<string | null>(null);
  const [workbenchDir, setWorkbenchDir] = useState<'asc' | 'desc'>('desc');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [ksLivePage, setKsLivePage] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  const [errorsPage, setErrorsPage] = useState(0);
  const [workbenchLimit, setWorkbenchLimit] = useState(5);

  // ─── Kicktraq import (manual preview/commit) ───────────────────────────────
  const [ktModalProjectId, setKtModalProjectId] = useState<string | null>(null);
  const [ktPreview, setKtPreview] = useState<KicktraqPreviewPayload | null>(null);
  const [ktPreviewLoading, setKtPreviewLoading] = useState(false);
  const [ktPreviewError, setKtPreviewError] = useState<string | null>(null);
  const [ktImportSummary, setKtImportSummary] = useState(true);
  const [ktImportDaily, setKtImportDaily] = useState(false);
  const [ktSummaryMode, setKtSummaryMode] = useState<SummaryMode>('overwrite');
  const [ktDailyMode, setKtDailyMode] = useState<DailyMode>('overwrite');
  const [ktCommitting, setKtCommitting] = useState(false);
  const [ktDailyLoading, setKtDailyLoading] = useState(false);
  const [ktDailyError, setKtDailyError] = useState<string | null>(null);
  // When the DB already has cached chart images, default to reusing them; the user can
  // opt in to re-fetching from Kicktraq (overwrites the cache) before OCR.
  const [ktImageRefresh, setKtImageRefresh] = useState(false);

  // ─── Kickstarter import (manual preview/confirm) ───────────────────────────
  const [ksModalProjectId, setKsModalProjectId] = useState<string | null>(null);
  const [ksPreview, setKsPreview] = useState<KickstarterPreviewPayload | null>(null);
  const [ksPreviewLoading, setKsPreviewLoading] = useState(false);
  const [ksPreviewError, setKsPreviewError] = useState<string | null>(null);
  const [ksCommitting, setKsCommitting] = useState(false);

  const [ktBatchOpen, setKtBatchOpen] = useState(false);
  const [ktBatchSummaryImport, setKtBatchSummaryImport] = useState(true);
  const [ktBatchSummaryMode, setKtBatchSummaryMode] = useState<SummaryMode>('skip');
  const [ktBatchDailyImport, setKtBatchDailyImport] = useState(true);
  const [ktBatchDailyMode, setKtBatchDailyMode] = useState<DailyMode>('overwrite');
  const [ktBatchSkipLowConfidence, setKtBatchSkipLowConfidence] = useState(true);
  const [ktBatchRunning, setKtBatchRunning] = useState(false);

  const KS_LIVE_PAGE_SIZE = 8;
  const RUNS_PAGE_SIZE = 6;
  const ERRORS_PAGE_SIZE = 5;

  const cn = lang === 'cn';
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformViewId>('kickstarter');
  const [platformQuality, setPlatformQuality] = useState<PlatformQualityPayload | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [platformActionBusy, setPlatformActionBusy] = useState<string | null>(null);
  const [platformActionMessage, setPlatformActionMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const loadWorkbench = async (
    filter = workbenchFilter,
    query = workbenchQuery,
    offset = 0,
    limit = workbenchLimit,
    sort = workbenchSort,
    dir = workbenchDir,
  ) => {
    setWorkbenchLoading(true);
    try {
      const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) });
      if (query.trim()) params.set('q', query.trim());
      if (workbenchState !== 'all') params.set('state', workbenchState);
      if (workbenchMinPledged.trim()) params.set('minPledged', workbenchMinPledged.trim());
      if (workbenchMaxPledged.trim()) params.set('maxPledged', workbenchMaxPledged.trim());
      if (sort) { params.set('sort', sort); params.set('dir', dir); }
      const res = await fetch(`/api/data-quality/workbench?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load data workbench.');
      setWorkbench(data);
      setSelectedProjectIds([]);
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setWorkbenchLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/data-quality', { cache: 'no-store' });
      setReport(await res.json());
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformQuality = async (platform = selectedPlatform) => {
    if (platform === 'kickstarter') return;
    setPlatformLoading(true);
    try {
      const res = await fetch(`/api/platforms/${platform}/quality`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load platform quality.');
      setPlatformQuality(data);
    } catch (err) {
      setPlatformActionMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPlatformLoading(false);
    }
  };

  // Click a sortable header: first click sorts descending, click again to flip to
  // ascending, a third click clears back to the default ordering. Resets to page 1.
  const toggleWorkbenchSort = (key: string) => {
    let nextSort: string | null = key;
    let nextDir: 'asc' | 'desc' = 'desc';
    if (workbenchSort === key) {
      if (workbenchDir === 'desc') { nextDir = 'asc'; }
      else { nextSort = null; nextDir = 'desc'; }
    }
    setWorkbenchSort(nextSort);
    setWorkbenchDir(nextDir);
    loadWorkbench(workbenchFilter, workbenchQuery, 0, workbenchLimit, nextSort, nextDir);
  };

  const sortIndicator = (key: string) => (workbenchSort === key ? (workbenchDir === 'desc' ? ' ↓' : ' ↑') : '');

  useEffect(() => {
    if (selectedPlatform !== 'kickstarter') return;
    load();
    loadWorkbench();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatform]);

  useEffect(() => {
    if (selectedPlatform === 'kickstarter') return;
    loadPlatformQuality(selectedPlatform);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatform]);

  useEffect(() => {
    if (selectedPlatform === 'kickstarter') return;
    if (!platformQuality?.webrobots?.coverage.running) return;
    const id = setInterval(() => loadPlatformQuality(selectedPlatform), 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlatform, platformQuality?.webrobots?.coverage.running]);

  const changePlatform = (platform: PlatformViewId) => {
    setSelectedPlatform(platform);
    setPlatformActionMessage(null);
    if (platform !== 'kickstarter') setPlatformQuality(null);
  };

  const runPlatformAction = async (action: PlatformActionName, options: PlatformActionOptions = {}) => {
    if (selectedPlatform === 'kickstarter') return;
    setPlatformActionBusy(action);
    setPlatformActionMessage(null);
    try {
      const res = await fetch(`/api/platforms/${selectedPlatform}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...options }),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        error?: string;
        quality?: PlatformQualityPayload;
      };
      if (!res.ok || !data.ok) {
        setPlatformActionMessage({ kind: 'error', text: data.error ?? data.message ?? 'Action failed.' });
      } else {
        setPlatformActionMessage({ kind: 'success', text: data.message ?? 'Action completed.' });
        if (data.quality) setPlatformQuality(data.quality);
        else await loadPlatformQuality(selectedPlatform);
      }
    } catch (err) {
      setPlatformActionMessage({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setPlatformActionBusy(null);
    }
  };

  const applyWorkbenchFilter = async (filter: string) => {
    setWorkbenchFilter(filter);
    await loadWorkbench(filter, workbenchQuery);
  };

  const toggleProjectSelection = (projectId: string) => {
    setSelectedProjectIds(prev => (
      prev.includes(projectId)
        ? prev.filter(id => id !== projectId)
        : [...prev, projectId]
    ));
  };

  const visibleProjectIds = workbench?.rows?.map(project => project.id) ?? [];
  const allVisibleSelected = visibleProjectIds.length > 0 && visibleProjectIds.every(id => selectedProjectIds.includes(id));
  const toggleVisibleSelection = () => {
    setSelectedProjectIds(prev => (
      allVisibleSelected
        ? prev.filter(id => !visibleProjectIds.includes(id))
        : Array.from(new Set([...prev, ...visibleProjectIds]))
    ));
  };

  type ScrapeAction = 'kickstarter_basic_sync' | 'kickstarter_sync' | 'kicktraq_import';

  const runWorkbenchRequest = async (projectId: string, action: ScrapeAction) => {
    const actionKey = `${action}:${projectId}`;
    setRunningAction(actionKey);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; source?: string; days?: number; writtenSnapshots?: number };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? data.message ?? 'Action failed.' });
      } else {
        const okText = action === 'kicktraq_import'
          ? (cn ? `已从 Kicktraq 导入 ${data.days ?? 0} 天曲线（写入 ${data.writtenSnapshots ?? 0} 条快照）。` : `Imported ${data.days ?? 0} days from Kicktraq (${data.writtenSnapshots ?? 0} snapshots).`)
          : `${data.message ?? (cn ? '已更新最新数据。' : 'Latest data updated.')}${data.source ? ` | source=${data.source}` : ''}`;
        setActionMessage({ kind: 'success', text: okText });
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: 'Network error while running action.' });
    } finally {
      setRunningAction(null);
    }
  };

  const runBatchAction = async (action: ScrapeAction | 'delete_projects') => {
    if (!selectedProjectIds.length) return;
    if (action === 'delete_projects') {
      const ok = window.confirm(cn
        ? `确定要删除选中的 ${selectedProjectIds.length} 个项目吗？相关快照、奖励、合作者、追踪和错误记录也会一起删除。`
        : `Delete ${selectedProjectIds.length} selected projects and their snapshots, rewards, collaborators, tracking, and errors?`);
      if (!ok) return;
    }
    setRunningAction(`bulk:${action}`);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: selectedProjectIds, action }),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        message?: string;
        error?: string;
        succeeded?: number;
        failed?: number;
        deleted?: number;
      };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? data.message ?? 'Batch action failed.' });
      } else {
        const text = action === 'delete_projects'
          ? (cn ? `已删除 ${data.deleted ?? 0} 个项目。` : `Deleted ${data.deleted ?? 0} projects.`)
          : (cn
              ? `批量${action === 'kicktraq_import' ? ' Kicktraq 抓取' : ' Kickstarter 抓取'}完成：成功 ${data.succeeded ?? 0}，失败 ${data.failed ?? 0}。`
              : `Batch ${action === 'kicktraq_import' ? 'Kicktraq' : 'Kickstarter'} sync finished: ${data.succeeded ?? 0} succeeded, ${data.failed ?? 0} failed.`);
        setActionMessage({ kind: 'success', text });
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: 'Network error while running batch action.' });
    } finally {
      setRunningAction(null);
    }
  };

  // ─── Kicktraq preview/commit handlers ──────────────────────────────────────
  const closeKtModal = () => {
    setKtModalProjectId(null);
    setKtPreview(null);
    setKtPreviewError(null);
    setKtDailyError(null);
  };

  const openKicktraqPreview = async (projectId: string) => {
    setKtModalProjectId(projectId);
    setKtPreview(null);
    setKtPreviewError(null);
    setKtDailyError(null);
    setKtPreviewLoading(true);
    setKtImportSummary(true);
    setKtImportDaily(false);
    setKtSummaryMode('overwrite');
    setKtDailyMode('overwrite');
    setKtImageRefresh(false);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30_000);
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'kicktraq_preview' }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({})) as { ok?: boolean; preview?: KicktraqPreviewPayload; error?: string; message?: string };
      if (!res.ok || !data.ok || !data.preview) {
        setKtPreviewError(data.error ?? data.message ?? (cn ? '抓取失败。' : 'Preview failed.'));
        return;
      }
      const preview = data.preview;
      setKtPreview(preview);
      setKtImportSummary(!!preview.summary.incoming);
      setKtImportDaily(false);
      setKtSummaryMode('overwrite');
      setKtDailyMode(preview.daily.current.snapshotCount > 0 ? 'merge' : 'overwrite');
    } catch (e) {
      setKtPreviewError((e instanceof Error && e.name === 'AbortError')
        ? (cn ? '读取汇总超时，请重试。' : 'Summary fetch timed out, please retry.')
        : (cn ? '网络错误。' : 'Network error.'));
    } finally {
      setKtPreviewLoading(false);
    }
  };

  // The slow, image-OCR daily layer is fetched on demand (own spinner + client timeout)
  // so it never blocks the summary preview.
  const fetchKicktraqDaily = async () => {
    if (!ktModalProjectId || !ktPreview) return;
    setKtDailyLoading(true);
    setKtDailyError(null);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 240_000);
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: ktModalProjectId,
          action: 'kicktraq_daily',
          summaryPledged: ktPreview.summary.incoming?.pledged_usd ?? 0,
          summaryBackers: ktPreview.summary.incoming?.backers_count ?? 0,
          imageMode: ktImageRefresh ? 'refresh' : 'cache',
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean;
        daily?: KicktraqPreviewPayload['daily']['incoming'];
        validation?: KicktraqPreviewPayload['validation'];
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.daily) {
        setKtDailyError(data.error ?? data.message ?? (cn ? '每日曲线抓取失败。' : 'Daily fetch failed.'));
        return;
      }
      const daily = data.daily;
      setKtPreview(prev => prev ? { ...prev, daily: { ...prev.daily, incoming: daily }, validation: data.validation } : prev);
      setKtImportDaily(daily.count > 0);
      if (daily.count === 0 && data.message) setKtDailyError(data.message);
    } catch (e) {
      setKtDailyError((e instanceof Error && e.name === 'AbortError')
        ? (cn ? 'OCR 抓取超时（>4 分钟），可能图表太大或模型太慢，请重试。' : 'OCR timed out (>4 min), please retry.')
        : (cn ? '网络错误。' : 'Network error.'));
    } finally {
      setKtDailyLoading(false);
    }
  };

  const confirmKicktraqCommit = async () => {
    if (!ktModalProjectId || !ktPreview) return;
    if (!ktImportSummary && !ktImportDaily) return;
    setKtCommitting(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: ktModalProjectId,
          action: 'kicktraq_commit',
          parts: { summary: ktImportSummary, daily: ktImportDaily },
          summaryMode: ktSummaryMode,
          dailyMode: ktDailyMode,
          payload: {
            summary: ktImportSummary ? ktPreview.summary.incoming : undefined,
            days: ktImportDaily ? (ktPreview.daily.incoming?.days ?? []) : undefined,
          },
        }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; summaryWritten?: boolean; summarySkipped?: boolean; dailyWritten?: number; error?: string; message?: string };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? data.message ?? (cn ? '入库失败。' : 'Commit failed.') });
      } else {
        const parts: string[] = [];
        if (data.summaryWritten) parts.push(cn ? '汇总已更新' : 'summary updated');
        else if (data.summarySkipped) parts.push(cn ? '汇总已跳过（已有数据）' : 'summary skipped');
        if ((data.dailyWritten ?? 0) > 0) parts.push(cn ? `每日明细写入 ${data.dailyWritten} 条` : `${data.dailyWritten} daily snapshots`);
        setActionMessage({ kind: 'success', text: (cn ? 'Kicktraq 入库完成：' : 'Kicktraq import done: ') + (parts.join(cn ? '，' : ', ') || (cn ? '无变化' : 'no changes')) });
        closeKtModal();
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: cn ? '入库时网络错误。' : 'Network error while committing.' });
    } finally {
      setKtCommitting(false);
    }
  };

  // ─── Kickstarter preview/confirm handlers (mirror the Kicktraq flow) ────────
  const closeKsModal = () => {
    setKsModalProjectId(null);
    setKsPreview(null);
    setKsPreviewError(null);
  };

  const openKickstarterPreview = async (projectId: string) => {
    setKsModalProjectId(projectId);
    setKsPreview(null);
    setKsPreviewError(null);
    setKsPreviewLoading(true);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 70_000);
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action: 'kickstarter_preview' }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({})) as { ok?: boolean; preview?: KickstarterPreviewPayload; error?: string; message?: string };
      if (!res.ok || !data.ok || !data.preview) {
        setKsPreviewError(data.error ?? data.message ?? (cn ? '预览失败。' : 'Preview failed.'));
        return;
      }
      setKsPreview(data.preview);
    } catch (e) {
      setKsPreviewError((e instanceof Error && e.name === 'AbortError')
        ? (cn ? '读取超时，请重试。' : 'Preview timed out, please retry.')
        : (cn ? '网络错误。' : 'Network error.'));
    } finally {
      setKsPreviewLoading(false);
    }
  };

  const confirmKickstarterCommit = async () => {
    if (!ksModalProjectId) return;
    setKsCommitting(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: ksModalProjectId, action: 'kickstarter_sync' }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; source?: string };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? data.message ?? (cn ? '入库失败。' : 'Sync failed.') });
      } else {
        setActionMessage({ kind: 'success', text: `${data.message ?? (cn ? '已从 Kickstarter 更新。' : 'Synced from Kickstarter.')}${data.source ? ` | source=${data.source}` : ''}` });
        closeKsModal();
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: cn ? '入库时网络错误。' : 'Network error while syncing.' });
    } finally {
      setKsCommitting(false);
    }
  };

  const runKicktraqBatch = async () => {
    if (!selectedProjectIds.length) return;
    if (!ktBatchSummaryImport && !ktBatchDailyImport) return;
    setKtBatchRunning(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectIds: selectedProjectIds,
          action: 'kicktraq_batch_commit',
          config: {
            summary: { import: ktBatchSummaryImport, mode: ktBatchSummaryMode },
            daily: { import: ktBatchDailyImport, mode: ktBatchDailyMode },
            skipLowConfidence: ktBatchSkipLowConfidence,
          },
        }),
      });
      const data = await res.json().catch(() => ({})) as {
        ok?: boolean; succeeded?: number; failed?: number; summaryWritten?: number; dailyWritten?: number; skippedLowConfidence?: number; error?: string;
      };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? (cn ? '批量入库失败。' : 'Batch import failed.') });
      } else {
        setActionMessage({
          kind: 'success',
          text: cn
            ? `批量 Kicktraq 入库：成功 ${data.succeeded ?? 0}，失败 ${data.failed ?? 0}（汇总 ${data.summaryWritten ?? 0}，每日 ${data.dailyWritten ?? 0}，因 OCR 质量跳过每日 ${data.skippedLowConfidence ?? 0}）。`
            : `Batch Kicktraq import: ${data.succeeded ?? 0} ok, ${data.failed ?? 0} failed (summary ${data.summaryWritten ?? 0}, daily ${data.dailyWritten ?? 0}, daily skipped on low OCR ${data.skippedLowConfidence ?? 0}).`,
        });
        setKtBatchOpen(false);
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: cn ? '批量入库时网络错误。' : 'Network error during batch import.' });
    } finally {
      setKtBatchRunning(false);
    }
  };

  if (selectedPlatform === 'kickstarter' && !reportState) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{cn ? '数据质量' : 'Data Quality'}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {cn ? '按平台隔离管理众筹数据源。' : 'Manage crowdfunding data sources by isolated platform.'}
            </p>
          </div>
        </div>
        <PlatformSwitcher value={selectedPlatform} onChange={changePlatform} cn={cn} />
        <div className="flex items-center gap-2 text-gray-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>{cn ? '正在读取数据质量状态...' : 'Loading data quality status...'}</span>
        </div>
      </div>
    );
  }

  if (selectedPlatform !== 'kickstarter') {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{cn ? '数据质量' : 'Data Quality'}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {cn ? '按平台隔离管理众筹数据源。' : 'Manage crowdfunding data sources by isolated platform.'}
            </p>
          </div>
          <button
            onClick={() => loadPlatformQuality(selectedPlatform)}
            disabled={platformLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${platformLoading ? 'animate-spin' : ''}`} />
            {cn ? '刷新' : 'Refresh'}
          </button>
        </div>

        <PlatformSwitcher value={selectedPlatform} onChange={changePlatform} cn={cn} />
        <PlatformIsolationPanel
          cn={cn}
          quality={platformQuality}
          loading={platformLoading}
          actionBusy={platformActionBusy}
          actionMessage={platformActionMessage}
          onAction={runPlatformAction}
        />
      </div>
    );
  }

  const report = reportState;
  if (!report) return null;

  const workbenchPageLimit = workbench?.limit ?? workbenchLimit;
  const workbenchPage = Math.floor((workbench?.offset ?? 0) / Math.max(1, workbenchPageLimit));
  const workbenchTotalPages = Math.max(1, Math.ceil((workbench?.total ?? 0) / Math.max(1, workbenchPageLimit)));

  const ksLiveTotalPages = Math.max(1, Math.ceil(report.recentKsLiveProjects.length / KS_LIVE_PAGE_SIZE));
  const ksLivePageClamped = Math.min(ksLivePage, ksLiveTotalPages - 1);
  const ksLiveSlice = report.recentKsLiveProjects.slice(ksLivePageClamped * KS_LIVE_PAGE_SIZE, ksLivePageClamped * KS_LIVE_PAGE_SIZE + KS_LIVE_PAGE_SIZE);

  const runsTotalPages = Math.max(1, Math.ceil(report.recentRuns.length / RUNS_PAGE_SIZE));
  const runsPageClamped = Math.min(runsPage, runsTotalPages - 1);
  const runsSlice = report.recentRuns.slice(runsPageClamped * RUNS_PAGE_SIZE, runsPageClamped * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE);

  const errorsTotalPages = Math.max(1, Math.ceil(report.recentErrors.length / ERRORS_PAGE_SIZE));
  const errorsPageClamped = Math.min(errorsPage, errorsTotalPages - 1);
  const errorsSlice = report.recentErrors.slice(errorsPageClamped * ERRORS_PAGE_SIZE, errorsPageClamped * ERRORS_PAGE_SIZE + ERRORS_PAGE_SIZE);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? '数据质量' : 'Data Quality'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {cn ? '入库总量、实时抓取状态与项目数据维护。' : 'Database totals, live crawl status, and project data maintenance.'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {cn ? '刷新' : 'Refresh'}
        </button>
      </div>

      <PlatformSwitcher value={selectedPlatform} onChange={changePlatform} cn={cn} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatTile
          icon={Database}
          label={cn ? '项目总入库量' : 'Total projects in DB'}
          value={fmtNum(report.totals.totalProjects)}
          hint={cn ? `其中 ${fmtNum(report.totals.liveProjects)} 个进行中` : `${fmtNum(report.totals.liveProjects)} currently live`}
          tip={cn
            ? `数据库里目前收录的所有 Kickstarter 项目总数，包含已结束和进行中的。其中“进行中”有 ${fmtNum(report.totals.liveProjects)} 个；这个数会比右侧“实时追踪中”略多，差额是少数缺少可用 Kickstarter 链接/slug、暂时无法抓取的项目（见下方“追踪覆盖与排期”）。`
            : `Total Kickstarter projects stored in the database, including ended and live ones. Of these, ${fmtNum(report.totals.liveProjects)} are live; this is slightly higher than "Tracking now" — the gap is the few live projects without a usable Kickstarter URL/slug (see "Tracking coverage" below).`}
          tone="blue"
        />
        <StatTile
          icon={UploadCloud}
          label={cn ? '24h 新增入库' : 'New in last 24h'}
          value={fmtNum(report.totals.newProjects24h)}
          hint={cn ? '首次入库时间在过去 24 小时内' : 'First seen within the last 24 hours'}
          tip={cn
            ? '过去 24 小时内第一次被我们收录进数据库的新项目数量，反映最近的抓取产出。'
            : 'Projects first added to the database in the last 24 hours — a measure of recent crawl output.'}
          tone="green"
        />
        <StatTile
          icon={RadioTower}
          label={cn ? '实时追踪中' : 'Tracking now'}
          value={fmtNum(report.tracking.autoTrackedLive)}
          hint={cn
            ? `进行中 ${fmtNum(report.totals.liveProjects)} · 可追踪 ${fmtNum(report.tracking.autoTrackedLive)}${report.tracking.untrackableLive > 0 ? ` · ${fmtNum(report.tracking.untrackableLive)} 个缺链接` : ''}`
            : `${fmtNum(report.totals.liveProjects)} live · ${fmtNum(report.tracking.autoTrackedLive)} trackable${report.tracking.untrackableLive > 0 ? ` · ${fmtNum(report.tracking.untrackableLive)} no link` : ''}`}
          tip={cn
            ? `正在进行中、且已纳入定时更新名单的项目数量——系统会定期抓取它们最新的金额、支持者等数据。\n\n为什么比“进行中”(${fmtNum(report.totals.liveProjects)}) 少？因为有 ${fmtNum(report.tracking.untrackableLive)} 个进行中项目缺少可用的 Kickstarter 链接/slug，系统拼不出抓取地址，暂时无法定时打点。我们已在 webrobots 入库时改用项目 URL 兜底解析，后续同步会逐步把这部分补回、缺口会缩小。\n\n“待抓”=这些追踪项目里已到点、正排队等待本轮抓取的数量（始终 ≤ 追踪中总数）。`
            : `Live projects enrolled in the auto-refresh schedule that the system periodically re-fetches.\n\nWhy fewer than "live" (${fmtNum(report.totals.liveProjects)})? ${fmtNum(report.tracking.untrackableLive)} live projects lack a usable Kickstarter URL/slug, so no fetch URL can be built and they can't be scheduled yet. The webrobots import now falls back to the project URL to recover these, so the gap shrinks over time.\n\n"Due" is the subset already past its scheduled time and queued for this round (always ≤ tracked).`}
          tone="amber"
        />
      </div>

      <CrawlStatusSection
        diagnostics={report.diagnostics}
        latestSnapshotAt={report.snapshots.latestSnapshotAt}
        staleLiveProjects={report.snapshots.staleLiveProjects}
        liveProjects={report.totals.liveProjects}
        cn={cn}
        lang={lang}
      />

      {report.diagnostics && (
        <StorageSection diagnostics={report.diagnostics} cn={cn} />
      )}

      <TrackingSection report={report} cn={cn} />

      <DataSourceSync cn={cn} />

      <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-ks-green" />
              <h2 className="font-semibold text-gray-800">{cn ? '项目数据工作台' : 'Project Data Workbench'}</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
            {cn
              ? '与项目列表口径一致。可单条或批量手动重新抓取：从 Kickstarter 拉取最新金额/支持者，或从 Kicktraq 导入历史曲线，并直接写入数据库；也可批量删除脏数据。'
              : 'Same figures as the project list. Manually re-scrape one or many: pull the latest pledged/backers from Kickstarter, or import the history curve from Kicktraq, written straight to the DB. Bulk delete is available too.'}
            </p>
          </div>

        <div className="px-5 py-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-400 mr-1">{cn ? '快捷视图' : 'Views'}</span>
            {[
              ['all', cn ? '全部' : 'All'],
              ['missing_collaborators', cn ? '缺合作者' : 'Missing collaborators'],
              ['missing_rewards', cn ? '缺奖励档位' : 'Missing rewards'],
              ['missing_snapshots', cn ? '缺快照' : 'Missing snapshots'],
              ['webrobots_only', cn ? '仅 WebRobots' : 'WebRobots only'],
              ['kicktraq_available', cn ? '可导入 Kicktraq' : 'Kicktraq ready'],
              ['recent_errors', cn ? '最近失败' : 'Recent errors'],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => applyWorkbenchFilter(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  workbenchFilter === key ? 'bg-ks-green text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              loadWorkbench(workbenchFilter, workbenchQuery);
            }}
          >
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={workbenchQuery}
                onChange={e => setWorkbenchQuery(e.target.value)}
                placeholder={cn ? '搜索项目名 / slug' : 'Search project / slug'}
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-ks-green"
              />
            </div>
            <select
              value={workbenchState}
              onChange={e => setWorkbenchState(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-ks-green"
            >
              <option value="all">{cn ? '全部状态' : 'All states'}</option>
              <option value="live">{cn ? '进行中' : 'Live'}</option>
              <option value="successful">{cn ? '已成功' : 'Successful'}</option>
              <option value="failed">{cn ? '失败' : 'Failed'}</option>
              <option value="canceled">{cn ? '已取消' : 'Canceled'}</option>
              <option value="suspended">{cn ? '暂停' : 'Suspended'}</option>
            </select>
            <input
              value={workbenchMinPledged}
              onChange={e => setWorkbenchMinPledged(e.target.value)}
              inputMode="numeric"
              placeholder={cn ? '最低 $' : 'Min $'}
              className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-ks-green"
            />
            <input
              value={workbenchMaxPledged}
              onChange={e => setWorkbenchMaxPledged(e.target.value)}
              inputMode="numeric"
              placeholder={cn ? '最高 $' : 'Max $'}
              className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-ks-green"
            />
            <button
              type="submit"
              disabled={workbenchLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${workbenchLoading ? 'animate-spin' : ''}`} />
              {cn ? '筛选' : 'Filter'}
            </button>
            <button
              type="button"
            onClick={toggleVisibleSelection}
              className="ml-auto rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
              {allVisibleSelected ? (cn ? '取消选择本页' : 'Clear page') : (cn ? '选择本页' : 'Select page')}
          </button>
          </form>
        </div>

        {selectedProjectIds.length > 0 && (
          <div className="mx-5 mt-4 flex flex-col gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{cn ? `已选中 ${selectedProjectIds.length} 个项目` : `${selectedProjectIds.length} projects selected`}</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runBatchAction('kickstarter_sync')}
                disabled={!!runningAction}
                title={cn ? '从 Kickstarter 重新抓取最新金额/支持者并写库' : 'Re-scrape latest figures from Kickstarter'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ks-green px-3 py-2 text-xs font-bold text-white hover:bg-ks-green-dark disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningAction === 'bulk:kickstarter_sync' ? 'animate-spin' : ''}`} />
                {cn ? '批量从 Kickstarter 抓取' : 'Scrape Kickstarter'}
              </button>
              <button
                onClick={() => setKtBatchOpen(true)}
                disabled={!!runningAction || ktBatchRunning}
                title={cn ? '配置入库方式后批量从 Kicktraq 抓取写库' : 'Configure import options, then batch import from Kicktraq'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                <UploadCloud className={`h-3.5 w-3.5 ${ktBatchRunning ? 'animate-spin' : ''}`} />
                {cn ? '批量从 Kicktraq 抓取' : 'Scrape Kicktraq'}
              </button>
              <button
                onClick={() => runBatchAction('delete_projects')}
                disabled={!!runningAction}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-600 ring-1 ring-red-100 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {cn ? '批量删除' : 'Delete'}
              </button>
            </div>
          </div>
        )}

        {actionMessage && (
          <div className={`mx-5 mt-4 rounded-lg px-4 py-3 text-sm ${
            actionMessage.kind === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            {actionMessage.text}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-5 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleVisibleSelection}
                    className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                    aria-label={cn ? '选择本页' : 'Select page'}
                  />
                </th>
                <th className="text-left px-2 py-3 font-medium">{cn ? '项目' : 'Project'}</th>
                <th className="text-right px-3 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleWorkbenchSort('pledged')}
                    className={`inline-flex items-center gap-0.5 hover:text-ks-green ${workbenchSort === 'pledged' ? 'text-ks-green font-semibold' : ''}`}
                    title={cn ? '点击按筹款排序' : 'Sort by pledged'}
                  >
                    {cn ? '筹款' : 'Pledged'}{sortIndicator('pledged')}
                  </button>
                </th>
                <th className="text-right px-3 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleWorkbenchSort('backers')}
                    className={`inline-flex items-center gap-0.5 hover:text-ks-green ${workbenchSort === 'backers' ? 'text-ks-green font-semibold' : ''}`}
                    title={cn ? '点击按支持者排序' : 'Sort by backers'}
                  >
                    {cn ? '支持者' : 'Backers'}{sortIndicator('backers')}
                  </button>
                </th>
                <th className="text-right px-3 py-3 font-medium">
                  <button
                    type="button"
                    onClick={() => toggleWorkbenchSort('deadline')}
                    className={`inline-flex items-center gap-0.5 hover:text-ks-green ${workbenchSort === 'deadline' ? 'text-ks-green font-semibold' : ''}`}
                    title={cn ? '点击按下线时间排序' : 'Sort by closing date'}
                  >
                    {cn ? '下线时间' : 'Closing'}{sortIndicator('deadline')}
                  </button>
                </th>
                <th className="text-left px-3 py-3 font-medium">{cn ? '数据' : 'Data'}</th>
                <th className="text-right px-5 py-3 font-medium">{cn ? '操作' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(workbench?.rows ?? []).map(project => {
                const runningKs = runningAction === `kickstarter_sync:${project.id}`;
                const fundedPct = project.goal && project.goal > 0
                  ? Math.round((Number(project.usd_pledged ?? 0) / project.goal) * 100)
                  : null;
                const closing = fmtDeadline(project.deadline, cn);
                return (
                  <tr key={project.id} className="align-middle hover:bg-gray-50/60">
                    <td className="px-5 py-4">
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.includes(project.id)}
                          onChange={() => toggleProjectSelection(project.id)}
                        className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                        />
                    </td>
                    <td className="px-2 py-4">
                      <div className="flex gap-3">
                        <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                          {(project.image_thumb_url || project.image_url) && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={project.image_thumb_url || project.image_url || ''} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0 max-w-[260px]">
                          <a href={`/projects/${project.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 font-semibold text-gray-900 hover:text-ks-green">
                            <span className="truncate">{project.name}</span>
                            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                          </a>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${projectStateClass(project.state)}`}>{stateLabel(project.state, cn)}</span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{project.data_source || 'unknown'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <p className="font-semibold text-gray-900">{fmtMoney(project.usd_pledged)}</p>
                      {fundedPct !== null && (
                        <p className={`text-xs ${fundedPct >= 100 ? 'text-ks-green' : 'text-gray-400'}`}>{fundedPct >= 10000 ? '>10K' : fundedPct.toLocaleString()}%</p>
                      )}
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-gray-900">{fmtNum(project.backers_count)}</td>
                    <td className={`px-3 py-4 text-right text-xs ${closing.tone}`}>{closing.text}</td>
                    <td className="px-3 py-4">
                      {project.last_error ? (
                        <p className="line-clamp-2 max-w-[180px] text-xs text-red-600" title={project.last_error}>{project.last_error}</p>
                      ) : (
                        <p className="text-xs text-gray-400">
                          {cn ? `${fmtNum(project.snapshot_count)} 快照` : `${fmtNum(project.snapshot_count)} snaps`}
                          <span className="text-gray-300"> · {fmtTime(project.latest_snapshot_at, lang)}</span>
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-nowrap justify-end gap-1.5">
                        <button
                          onClick={() => openKickstarterPreview(project.id)}
                          disabled={!!runningAction || ksPreviewLoading || ksCommitting}
                          title={cn ? '预览 Kickstarter 最新数据，确认后再写入数据库' : 'Preview latest Kickstarter data, then confirm before writing to DB'}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-ks-green px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-ks-green-dark disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 flex-shrink-0 ${(runningKs || (ksPreviewLoading && ksModalProjectId === project.id)) ? 'animate-spin' : ''}`} />
                          {cn ? '从 Kickstarter 抓取' : 'Kickstarter'}
                        </button>
                        <button
                          onClick={() => openKicktraqPreview(project.id)}
                          disabled={!!runningAction || ktPreviewLoading || ktCommitting}
                          title={cn ? '预览 Kicktraq 数据，确认后再写入数据库' : 'Preview Kicktraq data, then confirm before writing to DB'}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <UploadCloud className={`h-3.5 w-3.5 flex-shrink-0 ${(ktPreviewLoading && ktModalProjectId === project.id) ? 'animate-spin' : ''}`} />
                          {cn ? '从 Kicktraq 抓取' : 'Kicktraq'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!workbench?.rows?.length && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">
                    {workbenchLoading ? (cn ? '加载中...' : 'Loading...') : (cn ? '没有匹配项目。' : 'No matching projects.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          <span>
            {cn
              ? `当前筛选共 ${fmtNum(workbench?.total ?? 0)} 个项目`
              : `${fmtNum(workbench?.total ?? 0)} matching projects`}
          </span>
          <div className="flex items-center gap-2 text-gray-500">
            <label className="flex items-center gap-1.5">
              <span>{cn ? '每页' : 'Per page'}</span>
              <select
                value={workbenchLimit}
                onChange={e => {
                  const next = Number(e.target.value);
                  setWorkbenchLimit(next);
                  loadWorkbench(workbenchFilter, workbenchQuery, 0, next);
                }}
                className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-ks-green"
              >
                {[5, 10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            {workbenchTotalPages > 1 && (
              <>
                <button
                  onClick={() => loadWorkbench(workbenchFilter, workbenchQuery, (workbenchPage - 1) * workbenchPageLimit)}
                  disabled={workbenchPage <= 0 || workbenchLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  {cn ? '上一页' : 'Prev'}
                </button>
                <span className="tabular-nums">{cn ? `第 ${workbenchPage + 1} / ${workbenchTotalPages} 页` : `${workbenchPage + 1} / ${workbenchTotalPages}`}</span>
                <button
                  onClick={() => loadWorkbench(workbenchFilter, workbenchQuery, (workbenchPage + 1) * workbenchPageLimit)}
                  disabled={workbenchPage >= workbenchTotalPages - 1 || workbenchLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {cn ? '下一页' : 'Next'}
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RadioTower className="w-4 h-4 text-ks-green" />
            <h2 className="font-semibold text-gray-800">{cn ? '最近 KS Live 入库项目' : 'Recent KS Live Projects'}</h2>
          </div>
          <span className="text-xs text-gray-400">{cn ? `共 ${fmtNum(report.recentKsLiveProjects.length)} 个` : `${fmtNum(report.recentKsLiveProjects.length)} total`}</span>
        </div>
        <div className="divide-y divide-gray-50">
          {ksLiveSlice.map(project => (
            <a
              key={project.id}
              href={`/projects/${project.id}`}
              target="_blank"
              rel="noreferrer"
              className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition-colors"
            >
              <div className="w-24 h-14 rounded-md bg-gray-100 overflow-hidden flex-shrink-0">
                {(project.image_thumb_url || project.image_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={project.image_thumb_url || project.image_url || ''}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${projectStateClass(project.state)}`}>{project.state}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1 truncate">
                  {[project.category_parent, project.category_name, project.country].filter(Boolean).join(' / ') || '-'}
                </p>
              </div>
              <div className="hidden md:grid grid-cols-3 gap-4 text-right text-xs min-w-[280px]">
                <div>
                  <p className="text-gray-400">{cn ? '金额' : 'Pledged'}</p>
                  <p className="font-semibold text-gray-900">{fmtMoney(project.usd_pledged)}</p>
                </div>
                <div>
                  <p className="text-gray-400">{cn ? '支持者' : 'Backers'}</p>
                  <p className="font-semibold text-gray-900">{fmtNum(project.backers_count)}</p>
                </div>
                <div>
                  <p className="text-gray-400">{cn ? '同步' : 'Synced'}</p>
                  <p className="font-semibold text-gray-900">{fmtTime(project.ks_live_synced_at ?? project.first_seen_at, lang)}</p>
                </div>
              </div>
            </a>
          ))}
          {!report.recentKsLiveProjects.length && (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              {cn ? '下一次 KS Live 成功入库后，这里会显示项目。' : 'Projects will appear here after the next KS Live import.'}
            </div>
          )}
        </div>
        <Pager page={ksLivePageClamped} totalPages={ksLiveTotalPages} onChange={setKsLivePage} cn={cn} />
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="xl:col-span-2 bg-white border border-gray-100 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <RadioTower className="w-4 h-4 text-ks-green" />
            <h2 className="font-semibold text-gray-800">{cn ? '来源健康度' : 'Source health'}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">{cn ? '来源' : 'Source'}</th>
                  <th className="text-right px-4 py-3 font-medium">{cn ? '运行' : 'Runs'}</th>
                  <th className="text-right px-4 py-3 font-medium">{cn ? '成功' : 'Done'}</th>
                  <th className="text-right px-4 py-3 font-medium">{cn ? '阻断' : 'Blocked'}</th>
                  <th className="text-right px-4 py-3 font-medium">{cn ? '错误' : 'Errors'}</th>
                  <th className="text-right px-5 py-3 font-medium">{cn ? '入库' : 'Imported'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.sourceHealth.map(source => (
                  <tr key={source.source}>
                    <td className="px-5 py-3 font-medium text-gray-800">{sourceLabel(source.source)}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{fmtNum(source.runs)}</td>
                    <td className="px-4 py-3 text-right text-green-700">{fmtNum(source.completed)}</td>
                    <td className="px-4 py-3 text-right text-amber-700">{fmtNum(source.blocked)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{fmtNum(source.errors)}</td>
                    <td className="px-5 py-3 text-right text-gray-900 font-medium">{fmtNum(source.imported_count)}</td>
                  </tr>
                ))}
                {!report.sourceHealth.length && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-gray-400">
                      {cn ? '还没有采集运行记录。' : 'No crawl runs recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white border border-gray-100 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <ShieldCheck className="w-4 h-4 text-blue-500" />
            <h2 className="font-semibold text-gray-800">{cn ? '字段完整性' : 'Field completeness'}</h2>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">source_url</span>
                <span className="font-medium text-gray-900">{fmtNum(report.totals.missingSourceUrl)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{cn ? '缺少项目原始链接' : 'Missing canonical project URL'}</p>
            </div>
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">creator_slug / slug</span>
                <span className="font-medium text-gray-900">{fmtNum(report.totals.missingSlug)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{cn ? '影响跨来源去重' : 'Affects cross-source deduplication'}</p>
            </div>
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">launched_at</span>
                <span className="font-medium text-gray-900">{fmtNum(report.totals.missingLaunchDate)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">{cn ? '影响时间序列分析' : 'Affects time-series analysis'}</p>
            </div>
            <div className="pt-3 border-t border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">{cn ? '追踪项目' : 'Tracked projects'}</span>
                <span className="font-medium text-gray-900">{fmtNum(report.tracking.trackedProjects)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {cn ? `${fmtNum(report.tracking.dueProjects)} 个已到抓取时间` : `${fmtNum(report.tracking.dueProjects)} due for fetching`}
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-gray-500" />
          <h2 className="font-semibold text-gray-800">{cn ? '最近采集运行' : 'Recent crawl runs'}</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {runsSlice.map(run => (
            <div key={run.id} className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{sourceLabel(run.source)}</span>
                  <span className="text-xs text-gray-400">{run.job_type}</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusClass(run.status)}`}>{run.status}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{fmtTime(run.started_at, lang)}</p>
                {run.message && <p className="text-xs text-gray-500 mt-1 truncate max-w-3xl">{run.message}</p>}
              </div>
              <div className="grid grid-cols-4 gap-3 text-right text-xs min-w-[360px]">
                <div>
                  <p className="text-gray-400">{cn ? '发现' : 'Found'}</p>
                  <p className="font-semibold text-gray-800">{fmtNum(run.discovered_count)}</p>
                </div>
                <div>
                  <p className="text-gray-400">{cn ? '入库' : 'Imported'}</p>
                  <p className="font-semibold text-gray-800">{fmtNum(run.imported_count)}</p>
                </div>
                <div>
                  <p className="text-gray-400">{cn ? '快照' : 'Snapshots'}</p>
                  <p className="font-semibold text-gray-800">{fmtNum(run.snapshot_count)}</p>
                </div>
                <div>
                  <p className="text-gray-400">{cn ? '页数' : 'Pages'}</p>
                  <p className="font-semibold text-gray-800">{fmtNum(run.page_count)}</p>
                </div>
              </div>
            </div>
          ))}
          {!report.recentRuns.length && (
            <div className="px-5 py-8 text-center text-sm text-gray-400">
              {cn ? '下一次同步后这里会出现采集运行记录。' : 'Crawl runs will appear here after the next sync.'}
            </div>
          )}
        </div>
        <Pager page={runsPageClamped} totalPages={runsTotalPages} onChange={setRunsPage} cn={cn} />
      </section>

      {!!report.recentErrors.length && (
        <section className="bg-white border border-red-100 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold text-gray-800">{cn ? '最近错误' : 'Recent errors'}</h2>
          </div>
          <div className="divide-y divide-red-50">
            {errorsSlice.map(error => (
              <div key={error.id} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{sourceLabel(error.source)}</span>
                  {error.job_type && <span className="text-xs text-gray-500">{error.job_type}</span>}
                  {error.status_code && <span className="text-xs text-red-600">HTTP {error.status_code}</span>}
                  {error.occurrence_count && error.occurrence_count > 1 && (
                    <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      ×{error.occurrence_count}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{fmtTime(error.occurred_at, lang)}</span>
                </div>
                <p className="text-sm text-red-700 mt-1 break-words">{error.message}</p>
              </div>
            ))}
          </div>
          <Pager page={errorsPageClamped} totalPages={errorsTotalPages} onChange={setErrorsPage} cn={cn} />
        </section>
      )}

      {ktModalProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeKtModal}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">{cn ? 'Kicktraq 数据预览' : 'Kicktraq preview'}</h3>
                <p className="mt-0.5 truncate text-xs text-gray-500">{ktPreview?.projectName ?? ''}</p>
              </div>
              {ktPreview && ktPreview.validation && (() => {
                const c = ktPreview.validation.confidence;
                const map = {
                  high: { cls: 'bg-green-100 text-green-700', cn: '可靠', en: 'Reliable' },
                  low: { cls: 'bg-amber-100 text-amber-700', cn: 'OCR 可能异常', en: 'Check OCR' },
                  none: { cls: 'bg-gray-100 text-gray-500', cn: '无每日数据', en: 'No daily data' },
                }[c];
                return <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${map.cls}`}>{cn ? map.cn : map.en}</span>;
              })()}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {ktPreviewLoading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {cn ? '正在读取汇总…' : 'Loading summary…'}
                </div>
              )}
              {!ktPreviewLoading && ktPreviewError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{ktPreviewError}</div>
              )}
              {!ktPreviewLoading && ktPreview && (
                <div className="space-y-4">
                  {/* Layer 1: summary */}
                  <div className={`rounded-lg border p-4 ${ktImportSummary ? 'border-ks-green/40 bg-green-50/30' : 'border-gray-200 bg-gray-50/40'}`}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ktImportSummary}
                        disabled={!ktPreview.summary.incoming}
                        onChange={e => setKtImportSummary(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                      />
                      <span className="text-sm font-semibold text-gray-800">{cn ? '① 汇总（筹款 / 支持者 / 目标）' : '① Summary (pledged / backers / goal)'}</span>
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{cn ? 'HTML 文本 · 可靠' : 'HTML text · reliable'}</span>
                    </label>
                    {ktPreview.summary.incoming ? (
                      <div className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1.5 text-sm">
                        <span className="text-xs text-gray-400">{cn ? '字段' : 'Field'}</span>
                        <span className="text-xs text-gray-400">{cn ? '现有' : 'Current'}</span>
                        <span className="text-xs text-gray-400">{cn ? '即将入库' : 'Incoming'}</span>
                        {([
                          { label: cn ? '总筹款' : 'Pledged', cur: ktPreview.summary.current.pledged_usd, inc: ktPreview.summary.incoming.pledged_usd, money: true },
                          { label: cn ? '支持者' : 'Backers', cur: ktPreview.summary.current.backers_count, inc: ktPreview.summary.incoming.backers_count, money: false },
                          { label: cn ? '目标' : 'Goal', cur: ktPreview.summary.current.goal_usd, inc: ktPreview.summary.incoming.goal_usd, money: true },
                        ]).map(row => {
                          const changed = Math.round(row.cur) !== Math.round(row.inc);
                          const fmt = (v: number) => (row.money ? fmtMoney(v) : fmtNum(v));
                          return (
                            <div key={row.label} className="contents">
                              <span className="text-gray-600">{row.label}</span>
                              <span className="tabular-nums text-gray-500">{fmt(row.cur)}</span>
                              <span className={`tabular-nums font-semibold ${changed ? 'text-ks-green' : 'text-gray-400'}`}>{fmt(row.inc)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-gray-400">{cn ? '未解析到汇总数据。' : 'No summary data parsed.'}</p>
                    )}
                    {ktImportSummary && ktPreview.summary.incoming && (Number(ktPreview.summary.current.pledged_usd) > 0 || Number(ktPreview.summary.current.backers_count) > 0) && (
                      <div className="mt-3 flex items-center gap-3 text-xs">
                        <span className="text-gray-500">{cn ? '已有数据：' : 'Existing data:'}</span>
                        {(['overwrite', 'skip'] as SummaryMode[]).map(m => (
                          <label key={m} className="flex items-center gap-1 cursor-pointer">
                            <input type="radio" name="kt-summary-mode" checked={ktSummaryMode === m} onChange={() => setKtSummaryMode(m)} className="text-ks-green focus:ring-ks-green" />
                            <span className="text-gray-700">{m === 'overwrite' ? (cn ? '覆盖' : 'Overwrite') : (cn ? '跳过' : 'Skip')}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Layer 2: daily (fetched on demand — OCR is slow) */}
                  <div className={`rounded-lg border p-4 ${ktImportDaily ? 'border-ks-green/40 bg-green-50/30' : 'border-gray-200 bg-gray-50/40'}`}>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ktImportDaily}
                        disabled={!ktPreview.daily.incoming || ktPreview.daily.incoming.count === 0}
                        onChange={e => setKtImportDaily(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                      />
                      <span className="text-sm font-semibold text-gray-800">{cn ? '② 每日明细曲线' : '② Daily curve'}</span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{cn ? 'OCR · 尽力回填' : 'OCR · best-effort'}</span>
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-gray-400">{cn ? '现有' : 'Current'}</p>
                        <p className="text-gray-600">{cn ? `${fmtNum(ktPreview.daily.current.snapshotCount)} 个快照` : `${fmtNum(ktPreview.daily.current.snapshotCount)} snapshots`}</p>
                        {(ktPreview.daily.current.ownCount ?? 0) > 0 && (
                          <p className="text-[11px] text-gray-400">
                            {cn
                              ? `自抓(KS) ${fmtNum(ktPreview.daily.current.ownCount ?? 0)} · Kicktraq ${fmtNum(ktPreview.daily.current.kicktraqCount ?? 0)}`
                              : `Own(KS) ${fmtNum(ktPreview.daily.current.ownCount ?? 0)} · Kicktraq ${fmtNum(ktPreview.daily.current.kicktraqCount ?? 0)}`}
                          </p>
                        )}
                        {ktPreview.daily.current.dateFrom && <p className="text-xs text-gray-400">{ktPreview.daily.current.dateFrom} → {ktPreview.daily.current.dateTo}</p>}
                      </div>
                      <div>
                        <p className="text-xs text-gray-400">{cn ? '即将入库' : 'Incoming'}</p>
                        {ktPreview.daily.incoming ? (
                          <>
                            <p className="font-semibold text-gray-800">{cn ? `${fmtNum(ktPreview.daily.incoming.count)} 天` : `${fmtNum(ktPreview.daily.incoming.count)} days`}</p>
                            {ktPreview.daily.incoming.dateFrom && <p className="text-xs text-gray-400">{ktPreview.daily.incoming.dateFrom} → {ktPreview.daily.incoming.dateTo}</p>}
                          </>
                        ) : (
                          <p className="text-gray-400">{cn ? '尚未抓取' : 'Not fetched yet'}</p>
                        )}
                      </div>
                    </div>

                    {!ktPreview.daily.incoming && (
                      <div className="mt-3">
                        {ktPreview.images && ktPreview.images.cachedCount > 0 && (
                          <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-800">
                            <p>
                              {cn
                                ? `数据库已缓存 ${ktPreview.images.cachedCount} 张图表原图`
                                : `${ktPreview.images.cachedCount} chart image(s) cached in DB`}
                              {ktPreview.images.fetchedAt
                                ? `（${new Date(ktPreview.images.fetchedAt * 1000).toLocaleString()}）`
                                : ''}
                              。
                            </p>
                            <label className="mt-1.5 flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ktImageRefresh}
                                disabled={ktDailyLoading}
                                onChange={e => setKtImageRefresh(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                              />
                              <span>{cn ? '重新从 Kicktraq 抓取并覆盖图片（否则用库内图做 OCR）' : 'Re-fetch from Kicktraq & overwrite images (otherwise OCR the cached images)'}</span>
                            </label>
                          </div>
                        )}
                        <button
                          onClick={fetchKicktraqDaily}
                          disabled={ktDailyLoading}
                          className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                        >
                          {ktDailyLoading && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                          {ktDailyLoading
                            ? (cn ? '正在 OCR 识别每日曲线…（可能 1-3 分钟）' : 'Running OCR on the daily chart… (1-3 min)')
                            : (ktPreview.images && ktPreview.images.cachedCount > 0 && !ktImageRefresh)
                              ? (cn ? '用库内图片做 OCR（较慢）' : 'OCR cached images (slow)')
                              : (cn ? '抓取每日曲线（OCR，较慢）' : 'Fetch daily curve (OCR, slow)')}
                        </button>
                        {ktDailyError && <p className="mt-2 text-[11px] text-red-600 break-words">{ktDailyError}</p>}
                      </div>
                    )}

                    {ktPreview.daily.incoming?.imageSource && (
                      <p className="mt-2 text-[11px] text-gray-400">
                        {cn ? '图片来源：' : 'Image source: '}
                        {ktPreview.daily.incoming.imageSource === 'cache'
                          ? (cn ? '数据库缓存' : 'DB cache')
                          : (cn ? 'Kicktraq（已缓存到库）' : 'Kicktraq (now cached)')}
                      </p>
                    )}

                    {ktPreview.daily.incoming && ktPreview.validation && (
                      <>
                        <p className="mt-2 text-[11px] text-gray-400">
                          {cn ? '自校验（仅供参考，汇总含结束后销售，差异正常）：' : 'Self-check (informational; summary includes post-campaign sales):'}
                          {' '}
                          {cn ? '筹款' : 'pledged'} {ktPreview.validation.pledgedMatchPct ?? '—'}% · {cn ? '支持者' : 'backers'} {ktPreview.validation.backersMatchPct ?? '—'}%
                          {ktPreview.validation.negativeDays > 0 && <span className="text-amber-600"> · {cn ? `${ktPreview.validation.negativeDays} 天出现负增长` : `${ktPreview.validation.negativeDays} negative days`}</span>}
                        </p>
                        {ktPreview.validation.confidence === 'low' && (
                          <p className="mt-1 text-[11px] font-medium text-amber-600">{cn ? '⚠ OCR 可能读取异常，请确认后再入库每日明细。' : '⚠ OCR may have mis-read; confirm before importing daily data.'}</p>
                        )}
                        {ktDailyError && <p className="mt-1 text-[11px] text-amber-600 break-words">{ktDailyError}</p>}
                      </>
                    )}

                    {ktImportDaily && ktPreview.daily.incoming && ktPreview.daily.current.snapshotCount > 0 && (
                      <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2.5 text-xs">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold text-gray-600">{cn ? '已有历史数据：' : 'Existing history:'}</span>
                          {(['overwrite', 'merge'] as DailyMode[]).map(m => (
                            <label key={m} className="flex items-center gap-1 cursor-pointer">
                              <input type="radio" name="kt-daily-mode" checked={ktDailyMode === m} onChange={() => setKtDailyMode(m)} className="text-ks-green focus:ring-ks-green" />
                              <span className="text-gray-700">{m === 'overwrite' ? (cn ? '覆盖' : 'Overwrite') : (cn ? '合并' : 'Merge')}</span>
                            </label>
                          ))}
                        </div>
                        <p className="text-[11px] leading-relaxed text-gray-500">
                          {(ktPreview.daily.current.ownCount ?? 0) > 0 ? (
                            cn
                              ? '检测到本项目已有自抓(KS)历史。无论选哪种，KS 已覆盖的日期都会保留、不被 Kicktraq 覆盖——Kicktraq 只回填 KS 没有的日期。「合并」仅补缺失日；「覆盖」会先清空旧的 Kicktraq 层再重抓（适合重新 OCR 后纠错），仍不动 KS。'
                              : 'This project already has own (KS) history. Either way, KS-owned days are preserved — Kicktraq only backfills dates KS doesn\'t cover. "Merge" fills gaps only; "Overwrite" clears the old Kicktraq layer and re-imports (use after a re-OCR), still never touching KS.'
                          ) : (
                            cn
                              ? '「合并」仅补缺失日期；「覆盖」先清空旧的 Kicktraq 快照再重新导入（适合重新 OCR 后纠错）。'
                              : '"Merge" fills missing dates only; "Overwrite" clears old Kicktraq snapshots then re-imports (use after a re-OCR).'
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={closeKtModal} disabled={ktCommitting} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {cn ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={confirmKicktraqCommit}
                disabled={ktCommitting || ktPreviewLoading || !ktPreview || (!ktImportSummary && !ktImportDaily)}
                className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-4 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark disabled:opacity-50"
              >
                {ktCommitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                {cn ? `确认入库（${(ktImportSummary ? 1 : 0) + (ktImportDaily ? 1 : 0)} 项）` : `Confirm import (${(ktImportSummary ? 1 : 0) + (ktImportDaily ? 1 : 0)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ksModalProjectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeKsModal}>
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">{cn ? 'Kickstarter 数据预览' : 'Kickstarter preview'}</h3>
                <p className="mt-0.5 truncate text-xs text-gray-500">{ksPreview?.projectName ?? ''}</p>
              </div>
              <span className="flex-shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700">{cn ? 'Kickstarter 官方' : 'KS official'}</span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {ksPreviewLoading && (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  {cn ? '正在读取 Kickstarter 数据…' : 'Loading Kickstarter data…'}
                </div>
              )}
              {!ksPreviewLoading && ksPreviewError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{ksPreviewError}</div>
              )}
              {!ksPreviewLoading && ksPreview && (
                <div className="space-y-4">
                  {ksPreview.warning && (
                    <div className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-700">{ksPreview.warning}</div>
                  )}
                  <div className="rounded-lg border border-ks-green/40 bg-green-50/30 p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800">{cn ? '汇总（筹款 / 支持者 / 目标 / 状态）' : 'Summary (pledged / backers / goal / state)'}</span>
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{cn ? '官方 JSON' : 'official JSON'}</span>
                    </div>
                    {ksPreview.summary.incoming ? (
                      <div className="mt-3 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1.5 text-sm">
                        <span className="text-xs text-gray-400">{cn ? '字段' : 'Field'}</span>
                        <span className="text-xs text-gray-400">{cn ? '现有' : 'Current'}</span>
                        <span className="text-xs text-gray-400">{cn ? '即将入库' : 'Incoming'}</span>
                        {([
                          { label: cn ? '总筹款' : 'Pledged', cur: ksPreview.summary.current.pledged_usd, inc: ksPreview.summary.incoming.pledged_usd, money: true },
                          { label: cn ? '支持者' : 'Backers', cur: ksPreview.summary.current.backers_count, inc: ksPreview.summary.incoming.backers_count, money: false },
                          { label: cn ? '目标' : 'Goal', cur: ksPreview.summary.current.goal_usd, inc: ksPreview.summary.incoming.goal_usd, money: true },
                        ]).map(row => {
                          const changed = Math.round(row.cur) !== Math.round(row.inc);
                          const fmt = (v: number) => (row.money ? fmtMoney(v) : fmtNum(v));
                          return (
                            <div key={row.label} className="contents">
                              <span className="text-gray-600">{row.label}</span>
                              <span className="tabular-nums text-gray-500">{fmt(row.cur)}</span>
                              <span className={`tabular-nums font-semibold ${changed ? 'text-ks-green' : 'text-gray-400'}`}>{fmt(row.inc)}</span>
                            </div>
                          );
                        })}
                        <div className="contents">
                          <span className="text-gray-600">{cn ? '状态' : 'State'}</span>
                          <span className="tabular-nums text-gray-500">{ksPreview.summary.current.state ?? '—'}</span>
                          <span className={`tabular-nums font-semibold ${(ksPreview.summary.current.state ?? '') !== (ksPreview.summary.incoming.state ?? '') ? 'text-ks-green' : 'text-gray-400'}`}>{ksPreview.summary.incoming.state ?? '—'}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-gray-400">{cn ? '未能预取到 Kickstarter 数据；确认后将走完整同步（含浏览器 / Kicktraq 兜底）。' : 'Could not pre-fetch Kickstarter data; confirm will run the full sync with fallbacks.'}</p>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">{cn ? '确认后将从 Kickstarter 重新抓取并写入数据库（含 rewards / 评论 / 文本变更）。' : 'Confirm re-scrapes Kickstarter and writes to the DB (rewards / comments / text changes).'}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={closeKsModal} disabled={ksCommitting} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {cn ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={confirmKickstarterCommit}
                disabled={ksCommitting || ksPreviewLoading}
                className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-4 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark disabled:opacity-50"
              >
                {ksCommitting && <RefreshCw className="h-4 w-4 animate-spin" />}
                {cn ? '确认抓取并入库' : 'Confirm & sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ktBatchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !ktBatchRunning && setKtBatchOpen(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-gray-100 px-5 py-4">
              <h3 className="font-semibold text-gray-900">{cn ? '批量从 Kicktraq 入库' : 'Batch import from Kicktraq'}</h3>
              <p className="mt-0.5 text-xs text-gray-500">{cn ? `共 ${selectedProjectIds.length} 个选中项目 · 先设定入库规则` : `${selectedProjectIds.length} selected projects · set import rules first`}</p>
            </div>
            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ktBatchSummaryImport} onChange={e => setKtBatchSummaryImport(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green" />
                  <span className="text-sm font-semibold text-gray-800">{cn ? '① 汇总（筹款 / 支持者 / 目标）' : '① Summary'}</span>
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">{cn ? 'HTML · 可靠' : 'HTML · reliable'}</span>
                </label>
                {ktBatchSummaryImport && (
                  <div className="mt-3 flex items-center gap-3 text-xs">
                    <span className="text-gray-500">{cn ? '已有数据：' : 'Existing:'}</span>
                    {(['overwrite', 'skip'] as SummaryMode[]).map(m => (
                      <label key={m} className="flex items-center gap-1 cursor-pointer">
                        <input type="radio" name="kt-batch-summary" checked={ktBatchSummaryMode === m} onChange={() => setKtBatchSummaryMode(m)} className="text-ks-green focus:ring-ks-green" />
                        <span className="text-gray-700">{m === 'overwrite' ? (cn ? '覆盖' : 'Overwrite') : (cn ? '跳过' : 'Skip')}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={ktBatchDailyImport} onChange={e => setKtBatchDailyImport(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green" />
                  <span className="text-sm font-semibold text-gray-800">{cn ? '② 每日明细曲线' : '② Daily curve'}</span>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{cn ? 'OCR · 可能不准' : 'OCR · may be off'}</span>
                </label>
                {ktBatchDailyImport && (
                  <div className="mt-3 space-y-2 text-xs">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500">{cn ? '已有数据：' : 'Existing:'}</span>
                      {(['overwrite', 'merge'] as DailyMode[]).map(m => (
                        <label key={m} className="flex items-center gap-1 cursor-pointer">
                          <input type="radio" name="kt-batch-daily" checked={ktBatchDailyMode === m} onChange={() => setKtBatchDailyMode(m)} className="text-ks-green focus:ring-ks-green" />
                          <span className="text-gray-700">{m === 'overwrite' ? (cn ? '覆盖' : 'Overwrite') : (cn ? '合并' : 'Merge')}</span>
                        </label>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={ktBatchSkipLowConfidence} onChange={e => setKtBatchSkipLowConfidence(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-ks-green focus:ring-ks-green" />
                      <span className="text-gray-700">{cn ? 'OCR 质量异常的项目自动跳过每日明细（只入汇总）' : 'Auto-skip daily for projects with bad OCR (summary only)'}</span>
                    </label>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setKtBatchOpen(false)} disabled={ktBatchRunning} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {cn ? '取消' : 'Cancel'}
              </button>
              <button
                onClick={runKicktraqBatch}
                disabled={ktBatchRunning || (!ktBatchSummaryImport && !ktBatchDailyImport)}
                className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-4 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark disabled:opacity-50"
              >
                {ktBatchRunning && <RefreshCw className="h-4 w-4 animate-spin" />}
                {cn ? `开始批量入库（${selectedProjectIds.length}）` : `Start batch import (${selectedProjectIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
