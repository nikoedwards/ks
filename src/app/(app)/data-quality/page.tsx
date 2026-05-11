'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, RadioTower, ShieldCheck, type LucideIcon } from 'lucide-react';
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
}

function fmtNum(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function fmtTime(ts: number | null | undefined, lang: string) {
  if (!ts) return lang === 'cn' ? '暂无' : 'None';
  return new Date(ts * 1000).toLocaleString(lang === 'cn' ? 'zh-CN' : 'en-US');
}

function statusClass(status: string) {
  if (status === 'completed') return 'bg-green-50 text-green-700';
  if (status === 'blocked') return 'bg-amber-50 text-amber-700';
  if (status === 'running') return 'bg-blue-50 text-blue-700';
  return 'bg-red-50 text-red-700';
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
  const [loading, setLoading] = useState(true);

  const cn = lang === 'cn';

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
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

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
                  {error.status_code && <span className="text-xs text-red-600">HTTP {error.status_code}</span>}
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
