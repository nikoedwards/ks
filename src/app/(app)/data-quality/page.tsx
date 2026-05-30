'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Database, ExternalLink, HardDrive, Info, RefreshCw, RadioTower, Search, ShieldCheck, Trash2, UploadCloud, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import DataSourceSync from '@/components/DataSourceSync';

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
              ? `当前有 ${fmtNum(s.overdue)} 个已到期待抓，按上面的吞吐速度约需 ${drainHours} 小时清空（实际受 browser worker 抓取速度影响，可能更久）。`
              : `${fmtNum(s.overdue)} overdue now — at the throughput above it takes ~${drainHours}h to clear (real speed depends on the browser worker).`}
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
  const [report, setReport] = useState<QualityReport | null>(null);
  const [workbench, setWorkbench] = useState<WorkbenchPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [workbenchLoading, setWorkbenchLoading] = useState(false);
  const [workbenchFilter, setWorkbenchFilter] = useState('all');
  const [workbenchQuery, setWorkbenchQuery] = useState('');
  const [workbenchState, setWorkbenchState] = useState('all');
  const [workbenchMinPledged, setWorkbenchMinPledged] = useState('');
  const [workbenchMaxPledged, setWorkbenchMaxPledged] = useState('');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [ksLivePage, setKsLivePage] = useState(0);
  const [runsPage, setRunsPage] = useState(0);
  const [errorsPage, setErrorsPage] = useState(0);
  const [workbenchLimit, setWorkbenchLimit] = useState(5);

  const KS_LIVE_PAGE_SIZE = 8;
  const RUNS_PAGE_SIZE = 6;
  const ERRORS_PAGE_SIZE = 5;

  const cn = lang === 'cn';

  const loadWorkbench = async (filter = workbenchFilter, query = workbenchQuery, offset = 0, limit = workbenchLimit) => {
    setWorkbenchLoading(true);
    try {
      const params = new URLSearchParams({ filter, limit: String(limit), offset: String(offset) });
      if (query.trim()) params.set('q', query.trim());
      if (workbenchState !== 'all') params.set('state', workbenchState);
      if (workbenchMinPledged.trim()) params.set('minPledged', workbenchMinPledged.trim());
      if (workbenchMaxPledged.trim()) params.set('maxPledged', workbenchMaxPledged.trim());
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

  useEffect(() => {
    load();
    loadWorkbench();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (!report) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 text-gray-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>{cn ? '正在读取数据质量状态...' : 'Loading data quality status...'}</span>
        </div>
      </div>
    );
  }

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
                onClick={() => runBatchAction('kicktraq_import')}
                disabled={!!runningAction}
                title={cn ? '从 Kicktraq 抓取历史曲线并写库' : 'Import history curve from Kicktraq'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                <UploadCloud className={`h-3.5 w-3.5 ${runningAction === 'bulk:kicktraq_import' ? 'animate-spin' : ''}`} />
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
                <th className="text-right px-3 py-3 font-medium">{cn ? '筹款' : 'Pledged'}</th>
                <th className="text-right px-3 py-3 font-medium">{cn ? '支持者' : 'Backers'}</th>
                <th className="text-right px-3 py-3 font-medium">{cn ? '下线时间' : 'Closing'}</th>
                <th className="text-left px-3 py-3 font-medium">{cn ? '数据' : 'Data'}</th>
                <th className="text-right px-5 py-3 font-medium">{cn ? '操作' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(workbench?.rows ?? []).map(project => {
                const runningKs = runningAction === `kickstarter_sync:${project.id}`;
                const runningKt = runningAction === `kicktraq_import:${project.id}`;
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
                          onClick={() => runWorkbenchRequest(project.id, 'kickstarter_sync')}
                          disabled={!!runningAction}
                          title={cn ? '从 Kickstarter 重新抓取最新数据并写入数据库' : 'Re-scrape latest data from Kickstarter and write to DB'}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-ks-green px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-ks-green-dark disabled:opacity-50"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 flex-shrink-0 ${runningKs ? 'animate-spin' : ''}`} />
                          {cn ? '从 Kickstarter 抓取' : 'Kickstarter'}
                        </button>
                        <button
                          onClick={() => runWorkbenchRequest(project.id, 'kicktraq_import')}
                          disabled={!!runningAction}
                          title={cn ? '从 Kicktraq 抓取历史曲线并写入数据库' : 'Import history curve from Kicktraq and write to DB'}
                          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <UploadCloud className={`h-3.5 w-3.5 flex-shrink-0 ${runningKt ? 'animate-spin' : ''}`} />
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
    </div>
  );
}
