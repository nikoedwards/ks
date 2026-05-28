'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, ExternalLink, HardDrive, PlayCircle, RefreshCw, RadioTower, Search, ShieldCheck, Trash2, UploadCloud, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

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

function sourceLabel(source: string) {
  const labels: Record<string, string> = {
    webrobots: 'Webrobots',
    ks_live: 'KS Live',
    kicktraq_active: 'Kicktraq Active',
    kicktraq_full_scan: 'Kicktraq Full Scan',
  };
  return labels[source] ?? source;
}

function DiagnosticsSection({ diagnostics, cn, lang }: { diagnostics: DiagnosticsReport; cn: boolean; lang: string }) {
  const dbBytes = (diagnostics.database.fileBytes ?? 0) + (diagnostics.database.walBytes ?? 0) + (diagnostics.database.shmBytes ?? 0);
  const diskFreeBytes = diagnostics.storage.diskFreeBytes;
  const diskFreePct = diagnostics.storage.diskFreePct;
  const diskCritical = diagnostics.storage.isCritical;
  const workerOk = diagnostics.browserWorker.configured;
  const blockedState = diagnostics.crawlerStates.find(s => s.last_status === 'blocked');

  const fmtTimeLocal = (ts: number | null | undefined) => {
    if (!ts) return cn ? '暂无' : 'None';
    return new Date(ts * 1000).toLocaleString(lang === 'cn' ? 'zh-CN' : 'en-US');
  };

  return (
    <section className={`rounded-lg border p-5 ${diskCritical || !workerOk || blockedState ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-center gap-2 mb-4">
        <HardDrive className={`w-4 h-4 ${diskCritical ? 'text-red-500' : 'text-ks-green'}`} />
        <h2 className="font-semibold text-gray-800">{cn ? '存储与抓取诊断' : 'Storage & Crawler Diagnostics'}</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className={`rounded-lg p-4 border ${diskCritical ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-white'}`}>
          <p className="text-xs text-gray-500">{cn ? '磁盘可用空间' : 'Disk free space'}</p>
          <p className={`text-2xl font-bold mt-1 ${diskCritical ? 'text-red-700' : 'text-gray-900'}`}>
            {fmtBytes(diskFreeBytes)}
            {diskFreePct !== null && <span className="text-sm text-gray-500 font-normal ml-2">({diskFreePct}%)</span>}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {cn ? `数据目录: ${diagnostics.storage.dataDir}` : `Data dir: ${diagnostics.storage.dataDir}`}
          </p>
          {diskCritical && (
            <p className="text-xs text-red-600 mt-2 font-medium">
              {cn
                ? '⚠ 空间紧张：去 Railway 给 volume 扩容，或在下方点 Prune 清理日志'
                : '⚠ Critically low — expand the Railway volume or click Prune below to free space.'}
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
          <p className="text-xs text-gray-500">{cn ? 'Browser Worker' : 'Browser Worker'}</p>
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

      {diagnostics.crawlerStates.length > 0 && (
        <div className="mt-4 rounded-lg border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 text-xs font-semibold text-gray-600">
            {cn ? '抓取器状态（含 backoff）' : 'Crawler states (with backoff)'}
          </div>
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="text-left px-4 py-2 font-medium">{cn ? '来源 / 任务' : 'Source / Job'}</th>
                <th className="text-left px-3 py-2 font-medium">{cn ? '状态' : 'Status'}</th>
                <th className="text-left px-3 py-2 font-medium">{cn ? '上次完成' : 'Last completed'}</th>
                <th className="text-left px-3 py-2 font-medium">{cn ? '下次重试' : 'Next attempt'}</th>
                <th className="text-left px-4 py-2 font-medium">{cn ? '消息' : 'Message'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {diagnostics.crawlerStates.map(s => {
                const tone = s.last_status === 'completed' ? 'text-green-700'
                  : s.last_status === 'blocked' ? 'text-amber-700'
                  : s.last_status === 'error' ? 'text-red-700'
                  : 'text-gray-500';
                return (
                  <tr key={`${s.source}:${s.job_type}`}>
                    <td className="px-4 py-2 font-mono text-gray-700">{s.source} / {s.job_type}</td>
                    <td className={`px-3 py-2 font-semibold ${tone}`}>{s.last_status ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{fmtTimeLocal(s.last_completed_at)}</td>
                    <td className="px-3 py-2 text-gray-600">{s.next_attempt_at ? fmtTimeLocal(s.next_attempt_at) : '—'}</td>
                    <td className="px-4 py-2 text-gray-500 max-w-md truncate" title={s.message ?? ''}>{s.message ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'gray',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
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
      <p className="text-sm font-medium text-gray-700 mt-3">{label}</p>
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

  const cn = lang === 'cn';

  const loadWorkbench = async (filter = workbenchFilter, query = workbenchQuery) => {
    setWorkbenchLoading(true);
    try {
      const params = new URLSearchParams({ filter, limit: '25' });
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

  const runWorkbenchAction = (projectId: string, action: 'kickstarter_sync' | 'kicktraq_import') => {
    const debugAction = action === 'kickstarter_sync' ? 'official' : 'kicktraq';
    window.location.href = `/data-quality/debug?projectId=${encodeURIComponent(projectId)}&action=${debugAction}`;
  };

  const runWorkbenchRequest = async (projectId: string, action: 'kickstarter_basic_sync') => {
    const actionKey = `${action}:${projectId}`;
    setRunningAction(actionKey);
    setActionMessage(null);
    try {
      const res = await fetch('/api/data-quality/workbench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action }),
      });
      const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string; source?: string };
      if (!res.ok || !data.ok) {
        setActionMessage({ kind: 'error', text: data.error ?? data.message ?? 'Action failed.' });
      } else {
        setActionMessage({
          kind: 'success',
          text: `${data.message ?? 'Basic Kickstarter fields updated.'}${data.source ? ` | source=${data.source}` : ''}`,
        });
        await Promise.all([load(), loadWorkbench(workbenchFilter, workbenchQuery)]);
      }
    } catch {
      setActionMessage({ kind: 'error', text: 'Network error while running action.' });
    } finally {
      setRunningAction(null);
    }
  };

  const runBatchAction = async (action: 'kickstarter_basic_sync' | 'delete_projects') => {
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
          : (cn ? `批量基础更新完成：成功 ${data.succeeded ?? 0}，失败 ${data.failed ?? 0}。` : `Batch basic update finished: ${data.succeeded ?? 0} succeeded, ${data.failed ?? 0} failed.`);
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

  const coverage = report.totals.totalProjects
    ? Math.round((report.snapshots.projectsWithSnapshots / report.totals.totalProjects) * 1000) / 10
    : 0;

  const staleTone = report.snapshots.staleLiveProjects > 100 ? 'red' : report.snapshots.staleLiveProjects > 0 ? 'amber' : 'green';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? '数据质量' : 'Data Quality'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {cn ? '实时采集覆盖率、来源健康度和最近运行记录。' : 'Live crawl coverage, source health, and recent run history.'}
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatTile
          icon={Database}
          label={cn ? '项目总数' : 'Total projects'}
          value={fmtNum(report.totals.totalProjects)}
          hint={cn ? `${fmtNum(report.totals.liveProjects)} 个 live 项目` : `${fmtNum(report.totals.liveProjects)} live projects`}
          tone="blue"
        />
        <StatTile
          icon={Activity}
          label={cn ? '快照覆盖率' : 'Snapshot coverage'}
          value={`${coverage}%`}
          hint={cn ? `${fmtNum(report.snapshots.projectsWithSnapshots)} 个项目有快照` : `${fmtNum(report.snapshots.projectsWithSnapshots)} projects have snapshots`}
          tone="green"
        />
        <StatTile
          icon={Clock3}
          label={cn ? '24h 快照' : '24h snapshots'}
          value={fmtNum(report.snapshots.snapshots24h)}
          hint={cn ? `最近: ${fmtTime(report.snapshots.latestSnapshotAt, lang)}` : `Latest: ${fmtTime(report.snapshots.latestSnapshotAt, lang)}`}
          tone="gray"
        />
        <StatTile
          icon={AlertTriangle}
          label={cn ? '过期 live 项目' : 'Stale live projects'}
          value={fmtNum(report.snapshots.staleLiveProjects)}
          hint={cn ? '6 小时内没有新快照' : 'No new snapshot in 6 hours'}
          tone={staleTone}
        />
      </div>

      {report.diagnostics && (
        <DiagnosticsSection diagnostics={report.diagnostics} cn={cn} lang={lang} />
      )}

      <section className="bg-white border border-gray-100 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <RadioTower className="w-4 h-4 text-ks-green" />
          <h2 className="font-semibold text-gray-800">{cn ? '自动巡航覆盖' : 'Autopilot Coverage'}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500">{cn ? '可追踪 live' : 'Trackable live'}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{fmtNum(report.tracking.liveTrackable)}</p>
          </div>
          <div className="bg-green-50 rounded-lg p-4">
            <p className="text-xs text-green-700">{cn ? '已自动追踪' : 'Auto-tracked'}</p>
            <p className="text-2xl font-bold text-green-900 mt-1">{fmtNum(report.tracking.autoTrackedLive)}</p>
          </div>
          <div className="bg-amber-50 rounded-lg p-4">
            <p className="text-xs text-amber-700">{cn ? '待纳入' : 'Remaining'}</p>
            <p className="text-2xl font-bold text-amber-900 mt-1">{fmtNum(report.tracking.untrackedLive)}</p>
          </div>
          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs text-blue-700">{cn ? '到期待抓' : 'Due now'}</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{fmtNum(report.tracking.dueProjects)}</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          {cn
            ? '后台会分批纳入 live 项目并按优先级刷新 JSON、奖励档位和文案快照。'
            : 'The background tracker enrolls live projects in batches and refreshes JSON, reward tiers, and text snapshots by priority.'}
        </p>
      </section>

      <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-ks-green" />
              <h2 className="font-semibold text-gray-800">{cn ? '项目数据工作台' : 'Project Data Workbench'}</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {cn ? '所有写库调试都集中在这里执行；前台项目页只展示数据库结果。' : 'All write-side data operations live here; project pages only display database results.'}
            </p>
          </div>
          <form
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_140px_120px_120px_auto]"
            onSubmit={e => {
              e.preventDefault();
              loadWorkbench(workbenchFilter, workbenchQuery);
            }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                value={workbenchQuery}
                onChange={e => setWorkbenchQuery(e.target.value)}
                placeholder={cn ? '搜索项目 / slug' : 'Search project / slug'}
                className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm outline-none focus:border-ks-green sm:w-64"
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
              placeholder={cn ? '最低金额' : 'Min USD'}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-ks-green"
            />
            <input
              value={workbenchMaxPledged}
              onChange={e => setWorkbenchMaxPledged(e.target.value)}
              inputMode="numeric"
              placeholder={cn ? '最高金额' : 'Max USD'}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-ks-green"
            />
            <button
              type="submit"
              disabled={workbenchLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${workbenchLoading ? 'animate-spin' : ''}`} />
              {cn ? '筛选' : 'Filter'}
            </button>
          </form>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2">
          {[
            ['missing_collaborators', cn ? '缺合作者' : 'Missing collaborators'],
            ['missing_rewards', cn ? '缺奖励档位' : 'Missing rewards'],
            ['missing_snapshots', cn ? '缺快照' : 'Missing snapshots'],
            ['webrobots_only', cn ? '仅 WebRobots' : 'WebRobots only'],
            ['kicktraq_available', cn ? '可导入 Kicktraq' : 'Kicktraq ready'],
            ['recent_errors', cn ? '最近失败' : 'Recent errors'],
            ['all', cn ? '全部' : 'All'],
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
          <button
            onClick={toggleVisibleSelection}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100"
          >
            {allVisibleSelected ? (cn ? '取消本页' : 'Clear page') : (cn ? '选择本页' : 'Select page')}
          </button>
        </div>

        {selectedProjectIds.length > 0 && (
          <div className="mx-5 mt-4 flex flex-col gap-2 rounded-lg border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800 sm:flex-row sm:items-center sm:justify-between">
            <span>{cn ? `已选中 ${selectedProjectIds.length} 个项目` : `${selectedProjectIds.length} projects selected`}</span>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => runBatchAction('kickstarter_basic_sync')}
                disabled={!!runningAction}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-green-700 ring-1 ring-green-200 hover:bg-green-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningAction === 'bulk:kickstarter_basic_sync' ? 'animate-spin' : ''}`} />
                {cn ? '批量更新基础' : 'Update basics'}
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
                <th className="text-left px-5 py-3 font-medium">{cn ? '项目' : 'Project'}</th>
                <th className="text-right px-3 py-3 font-medium">{cn ? '快照' : 'Snapshots'}</th>
                <th className="text-right px-3 py-3 font-medium">{cn ? '奖励' : 'Rewards'}</th>
                <th className="text-right px-3 py-3 font-medium">{cn ? '合作者' : 'Collaborators'}</th>
                <th className="text-left px-3 py-3 font-medium">{cn ? '最近错误' : 'Last error'}</th>
                <th className="text-right px-5 py-3 font-medium">{cn ? '操作' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(workbench?.rows ?? []).map(project => {
                const runningBasic = runningAction === `kickstarter_basic_sync:${project.id}`;
                const runningKs = false;
                const runningKt = false;
                return (
                  <tr key={project.id} className="align-top">
                    <td className="px-5 py-4">
                      <div className="flex gap-3">
                        <input
                          type="checkbox"
                          checked={selectedProjectIds.includes(project.id)}
                          onChange={() => toggleProjectSelection(project.id)}
                          className="mt-4 h-4 w-4 flex-shrink-0 rounded border-gray-300 text-ks-green focus:ring-ks-green"
                        />
                        <div className="h-12 w-20 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                          {(project.image_thumb_url || project.image_url) && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={project.image_thumb_url || project.image_url || ''} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <a href={`/projects/${project.id}`} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:text-ks-green truncate">
                              {project.name}
                            </a>
                            <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                          </div>
                          <p className="mt-1 text-xs text-gray-400 truncate">{project.creator_slug && project.slug ? `${project.creator_slug}/${project.slug}` : project.id}</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] ${projectStateClass(project.state)}`}>{project.state}</span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">{project.data_source || 'unknown'}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-4 text-right">
                      <p className="font-semibold text-gray-900">{fmtNum(project.snapshot_count)}</p>
                      <p className="text-xs text-gray-400">{fmtTime(project.latest_snapshot_at, lang)}</p>
                    </td>
                    <td className="px-3 py-4 text-right font-semibold text-gray-900">{fmtNum(project.reward_count)}</td>
                    <td className="px-3 py-4 text-right font-semibold text-gray-900">{fmtNum(project.collaborator_count)}</td>
                    <td className="px-3 py-4 max-w-xs">
                      {project.last_error ? (
                        <p className="line-clamp-2 text-xs text-red-600" title={project.last_error}>{project.last_error}</p>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => runWorkbenchRequest(project.id, 'kickstarter_basic_sync')}
                          disabled={!!runningAction}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100 disabled:opacity-50"
                        >
                          <CheckCircle2 className={`h-3.5 w-3.5 ${runningBasic ? 'animate-pulse' : ''}`} />
                          {cn ? '更新基础' : 'Basic'}
                        </button>
                        <button
                          onClick={() => runWorkbenchAction(project.id, 'kickstarter_sync')}
                          disabled={!!runningAction}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-ks-green px-3 py-2 text-xs font-bold text-white hover:bg-ks-green-dark disabled:opacity-50"
                        >
                          <PlayCircle className={`h-3.5 w-3.5 ${runningKs ? 'animate-pulse' : ''}`} />
                          {cn ? '官方同步' : 'KS Sync'}
                        </button>
                        <button
                          onClick={() => runWorkbenchAction(project.id, 'kicktraq_import')}
                          disabled={!!runningAction}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <UploadCloud className={`h-3.5 w-3.5 ${runningKt ? 'animate-pulse' : ''}`} />
                          {cn ? '导入曲线' : 'Kicktraq'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!workbench?.rows?.length && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-400">
                    {workbenchLoading ? (cn ? '加载中...' : 'Loading...') : (cn ? '没有匹配项目。' : 'No matching projects.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          {cn
            ? `当前筛选共 ${fmtNum(workbench?.total ?? 0)} 个项目，最多显示 25 个。`
            : `${fmtNum(workbench?.total ?? 0)} matching projects, showing up to 25.`}
        </div>
      </section>

      <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RadioTower className="w-4 h-4 text-ks-green" />
            <h2 className="font-semibold text-gray-800">{cn ? '最近 KS Live 入库项目' : 'Recent KS Live Projects'}</h2>
          </div>
          <span className="text-xs text-gray-400">{cn ? '最多 20 个' : 'Latest 20'}</span>
        </div>
        <div className="divide-y divide-gray-50">
          {report.recentKsLiveProjects.map(project => (
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
          {report.recentRuns.map(run => (
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
      </section>

      {!!report.recentErrors.length && (
        <section className="bg-white border border-red-100 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-red-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="font-semibold text-gray-800">{cn ? '最近错误' : 'Recent errors'}</h2>
          </div>
          <div className="divide-y divide-red-50">
            {report.recentErrors.map(error => (
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
        </section>
      )}
    </div>
  );
}
