'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, TrendingUp, Calendar, Award, Heart,
  Activity, Gift, FileText, Layers, RefreshCw, Radio,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; blurb: string; state: string;
  country: string; country_name: string; currency: string;
  category_parent: string; category_name: string; category_id: number;
  goal: number; pledged: number; usd_pledged: number; backers_count: number;
  staff_pick: number; created_at: number; launched_at: number; deadline: number;
  creator_name: string; source_url: string; slug: string;
  similar?: SimilarProject[];
}

interface SimilarProject {
  id: string; name: string; blurb: string; state: string;
  category_parent: string; category_name: string;
  usd_pledged: number; goal: number; backers_count: number;
  launched_at: number; source_url: string; slug: string;
}

interface Snapshot {
  captured_at: number; pledged_usd: number; backers_count: number;
  days_to_go: number; comments_count: number; updates_count: number;
  state: string; source: string;
}

interface Reward {
  reward_id: string; title: string; description: string;
  amount_usd: number; backers_count: number; limit_count: number | null; is_limited: number;
}

interface TextChange {
  field: string; captured_at: number; content: string;
}

interface TrackingSettings {
  is_tracking: number; track_rewards: number; track_comments: number;
  analyze_comments: number; track_text_diff: number; priority: number;
  subscriber_count?: number; priority_score?: number;
  last_fetched: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, string> = {
  successful: 'bg-ks-green-light text-ks-green-dark border border-ks-green/20',
  failed: 'bg-red-50 text-red-600 border border-red-100',
  live: 'bg-blue-50 text-blue-600 border border-blue-100',
  canceled: 'bg-amber-50 text-amber-600 border border-amber-100',
  suspended: 'bg-purple-50 text-purple-600 border border-purple-100',
};

const TAB_IDS = ['overview', 'curve', 'rewards', 'changes', 'similar'] as const;
type TabId = typeof TAB_IDS[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

function fmtDate(ts: number | null, lang: string) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(lang === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtDateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function calcDuration(p: Project): number | null {
  if (!p.launched_at || !p.deadline) return null;
  return Math.round((p.deadline - p.launched_at) / 86400);
}

function fundingGrade(rate: number): { grade: string; color: string } {
  if (rate >= 1000) return { grade: 'A++', color: 'bg-emerald-600' };
  if (rate >= 500) return { grade: 'A+', color: 'bg-emerald-500' };
  if (rate >= 200) return { grade: 'A', color: 'bg-green-500' };
  if (rate >= 100) return { grade: 'B+', color: 'bg-lime-500' };
  if (rate >= 75) return { grade: 'B', color: 'bg-yellow-400' };
  if (rate >= 50) return { grade: 'C', color: 'bg-orange-400' };
  return { grade: 'D', color: 'bg-red-500' };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-black text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  if (before === after) return <span className="text-gray-600 text-sm">{after}</span>;
  return (
    <div className="space-y-1 text-sm">
      <p className="text-red-500 line-through opacity-70">{before}</p>
      <p className="text-gray-800">{after}</p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lang] = useLanguage();
  const tr = t[lang].projectDetail;
  const stateTr = t[lang].states;
  const { user, showLogin } = useAuth();

  const TABS = [
    { id: 'overview' as TabId, label: tr.tabOverview, icon: Activity },
    { id: 'curve' as TabId, label: tr.tabCurve, icon: TrendingUp },
    { id: 'rewards' as TabId, label: tr.tabRewards, icon: Gift },
    { id: 'changes' as TabId, label: tr.tabChanges, icon: FileText },
    { id: 'similar' as TabId, label: tr.tabSimilar, icon: Layers },
  ];

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>('overview');

  // Tracking
  const [tracking, setTracking] = useState<TrackingSettings | null>(null);
  const [platformTracking, setPlatformTracking] = useState<TrackingSettings | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [ktImporting, setKtImporting] = useState(false);

  // Snapshot data
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [textHistory, setTextHistory] = useState<TextChange[]>([]);

  // Chart range
  const [chartRange, setChartRange] = useState<'all' | '30d' | '14d'>('all');

  const id = params?.id;
  const detailCopy = lang === 'cn' ? {
    sharedTitle: '平台共享追踪',
    sharedActive: '该项目已经进入共享追踪队列',
    sharedInactive: '该项目尚未进入共享追踪队列',
    subscribers: (n: number) => `${n} 人正在追踪`,
    sharedHint: '同步、奖励、文案等数据会全平台共享，后续用户无需重复抓取。',
    joinTracking: '点击 Track 后，你的监控偏好会合并到平台抓取策略里。',
    personalTitle: '我的追踪设置',
    nextCadence: (label: string) => `当前建议频率：${label}`,
  } : {
    sharedTitle: 'Shared tracking',
    sharedActive: 'This project is already in the shared tracking queue',
    sharedInactive: 'This project is not in the shared tracking queue yet',
    subscribers: (n: number) => `${n} tracker${n === 1 ? '' : 's'}`,
    sharedHint: 'Sync, reward, and text-change data is shared platform-wide so future users do not repeat the same crawl.',
    joinTracking: 'Click Track to merge your monitoring preferences into the platform crawl strategy.',
    personalTitle: 'My tracking settings',
    nextCadence: (label: string) => `Current suggested cadence: ${label}`,
  };

  // ── Fetch project ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`)
      .then(r => { if (r.status === 404) { setNotFound(true); setLoading(false); return null; } return r.json(); })
      .then(d => { if (d) setProject(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  // ── Fetch favorites ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    fetch('/api/favorites').then(r => r.json()).then(d => {
      setIsFavorited(((d.ids ?? []) as string[]).includes(id));
    }).catch(() => {});
  }, [user, id]);

  // ── Fetch tracking settings ────────────────────────────────────────────────
  const loadTracking = useCallback(() => {
    if (!id) return;
    fetch(`/api/track/${id}`).then(r => r.json()).then(d => {
      setTracking(d.settings);
      setPlatformTracking(d.platformSettings);
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    loadTracking();
  }, [loadTracking]);

  // ── Fetch snapshot data ────────────────────────────────────────────────────
  const loadSnapshots = useCallback(() => {
    if (!id) return;
    fetch(`/api/snapshots/${id}`).then(r => r.json()).then(d => {
      setSnapshots(d.snapshots ?? []);
      setRewards(d.rewards ?? []);
      setTextHistory(d.textHistory ?? []);
    }).catch(() => {});
  }, [id]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const toggleFavorite = async () => {
    if (!user) { showLogin(); return; }
    if (!project) return;
    if (isFavorited) {
      await fetch(`/api/favorites/${project.id}`, { method: 'DELETE' });
      setIsFavorited(false);
    } else {
      await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) });
      setIsFavorited(true);
    }
  };

  const toggleTracking = async () => {
    if (!user) { showLogin(); return; }
    if (!id) return;
    setTrackLoading(true);
    if (tracking?.is_tracking) {
      await fetch(`/api/track/${id}`, { method: 'DELETE' });
      setTracking(prev => prev ? { ...prev, is_tracking: 0 } : null);
    } else {
      await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: id }) });
      setTracking(prev => prev ? { ...prev, is_tracking: 1 } : { is_tracking: 1, track_rewards: 1, track_comments: 0, analyze_comments: 0, track_text_diff: 1, priority: 1, last_fetched: null });
    }
    await loadTracking();
    setTrackLoading(false);
  };

  const updateTrackSetting = async (key: string, value: number) => {
    if (!id) return;
    await fetch(`/api/track/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [key]: value }) });
    setTracking(prev => prev ? { ...prev, [key]: value } : null);
    await loadTracking();
  };

  const triggerScrape = async () => {
    if (!user) { showLogin(); return; }
    if (!id) return;
    setScraping(true);
    await fetch(`/api/track/${id}`, { method: 'POST' });
    await new Promise(r => setTimeout(r, 1500));
    loadSnapshots();
    await loadTracking();
    setScraping(false);
  };

  const [ktError, setKtError] = useState('');
  const importKicktraq = async () => {
    if (!user) { showLogin(); return; }
    if (!id) return;
    setKtImporting(true);
    setKtError('');
    try {
      const res = await fetch(`/api/kicktraq/${id}`, { method: 'POST' });
      const data = await res.json() as { ok: boolean; days?: number; message?: string };
      if (data.ok) { loadSnapshots(); }
      else { setKtError(data.message ?? 'Import failed'); }
    } catch {
      setKtError('Network error — please try again.');
    }
    setKtImporting(false);
  };

  // ── Chart data ─────────────────────────────────────────────────────────────

  const filteredSnapshots = (() => {
    if (!snapshots.length) return [];
    const cutoff = chartRange === '30d' ? Date.now() / 1000 - 30 * 86400
      : chartRange === '14d' ? Date.now() / 1000 - 14 * 86400
      : 0;
    return snapshots.filter(s => s.captured_at >= cutoff);
  })();

  const chartData = filteredSnapshots.map(s => ({
    date: fmtDate(s.captured_at, lang),
    ts: s.captured_at,
    pledged: Math.round(s.pledged_usd),
    backers: s.backers_count,
    comments: s.comments_count,
    updates: s.updates_count,
    source: s.source,
  }));

  // Table data: most recent first, delta columns
  const tableData = [...filteredSnapshots].reverse().map((s, i, arr) => {
    const prev = arr[i + 1];
    return {
      ...s,
      delta_pledged: prev ? s.pledged_usd - prev.pledged_usd : null,
      delta_backers: prev ? s.backers_count - prev.backers_count : null,
    };
  });

  // ── Loading / not found ────────────────────────────────────────────────────

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{tr.loading}</div>;
  if (notFound) return (
    <div className="max-w-2xl mx-auto mt-20 text-center space-y-4">
      <p className="text-gray-400 text-lg">{tr.notFound}</p>
      <button onClick={() => router.back()} className="text-ks-green text-sm hover:underline">{tr.backToList}</button>
    </div>
  );
  if (!project) return null;

  const fundingRate = project.goal > 0 ? (project.usd_pledged / project.goal) * 100 : 0;
  const duration = calcDuration(project);
  const avgDailyPledged = duration && duration > 0 ? project.usd_pledged / duration : null;
  const grade = fundingGrade(fundingRate);
  const ksUrl = project.source_url?.startsWith('https://www.kickstarter.com/projects/') ? project.source_url : null;
  const kicktraqUrl = project.slug ? `https://www.kicktraq.com/projects/${project.slug}/` : null;
  const hasRealData = snapshots.length > 0;
  const sharedTrackingActive = !!platformTracking?.is_tracking;
  const subscriberCount = platformTracking?.subscriber_count ?? 0;
  const sharedLastFetched = platformTracking?.last_fetched ?? tracking?.last_fetched ?? null;
  const cadenceLabel = (platformTracking?.priority === 2 || (platformTracking?.priority_score ?? 0) >= 20)
    ? tr.every1h
    : (subscriberCount >= 2 || (platformTracking?.priority_score ?? 0) >= 8)
      ? (lang === 'cn' ? '每 2 小时' : 'Every 2h')
      : tr.every4h;

  // Text diff: group by field, pair consecutive entries
  const textByField: Record<string, TextChange[]> = {};
  for (const tc of textHistory) {
    if (!textByField[tc.field]) textByField[tc.field] = [];
    textByField[tc.field].push(tc);
  }

  return (
    <div className="max-w-6xl mx-auto space-y-0">
      {/* Back */}
      <button onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-4">
        <ArrowLeft className="w-4 h-4" />{tr.back}
      </button>

      {/* ── Hero header (Social Blade style) ───────────────────────────────── */}
      <div className="bg-gray-900 rounded-t-2xl px-6 pt-6 pb-0">
        {/* Top row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATE_COLOR[project.state] ?? 'bg-gray-700 text-gray-300'}`}>
                {stateTr[project.state as keyof typeof stateTr] ?? project.state}
              </span>
              {project.staff_pick === 1 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-900/40 text-yellow-400 border border-yellow-800/40">
                  <Award className="w-3 h-3" /> {tr.staffPick}
                </span>
              )}
              <span className="text-xs text-gray-500">{project.category_parent} · {project.category_name}</span>
            </div>
            <h1 className="text-2xl font-bold text-white leading-snug">{project.name}</h1>
            {project.blurb && <p className="text-gray-400 mt-1 text-sm leading-relaxed">{project.blurb}</p>}
            <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
              {project.creator_name && <span className="text-gray-300 font-medium">{project.creator_name}</span>}
              <span>{project.country_name || project.country}</span>
              <span>{project.currency}</span>
              {sharedLastFetched && (
                <span className="flex items-center gap-1 text-ks-green/80">
                  <Radio className="w-3 h-3" /> {tr.lastSynced} {fmtDateTime(sharedLastFetched)}
                </span>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <button onClick={toggleFavorite}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isFavorited ? 'bg-red-900/40 text-red-400 border-red-800/40 hover:bg-red-900/60'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-red-900/30 hover:text-red-400'
              }`}>
              <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
              {isFavorited ? tr.saved : tr.saveBtn}
            </button>

            <button onClick={toggleTracking} disabled={trackLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                tracking?.is_tracking
                  ? 'bg-ks-green/20 text-ks-green border-ks-green/30 hover:bg-ks-green/30'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-ks-green/10 hover:text-ks-green'
              }`}>
              <Radio className={`w-3.5 h-3.5 ${tracking?.is_tracking ? 'animate-pulse' : ''}`} />
              {tracking?.is_tracking ? tr.trackingBtn : tr.trackBtn}
            </button>

            <button onClick={triggerScrape} disabled={scraping}
              title={tr.syncNow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700 text-xs font-semibold transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${scraping ? 'animate-spin' : ''}`} />
              {scraping ? tr.syncingBtn : tr.syncNow}
            </button>

            {ksUrl && (
              <a href={ksUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ks-green text-white text-xs font-semibold hover:bg-ks-green-dark transition-colors">
                <ExternalLink className="w-3.5 h-3.5" /> Kickstarter
              </a>
            )}
            {kicktraqUrl && (
              <a href={kicktraqUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs font-semibold hover:bg-gray-700 transition-colors border border-gray-700">
                <TrendingUp className="w-3.5 h-3.5" /> Kicktraq
              </a>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-8 pb-0 overflow-x-auto">
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{fmtUsd(project.usd_pledged)}</p>
            <p className="text-xs text-gray-500">{tr.pledgedOf(fmtUsd(project.goal))}</p>
          </div>
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{fundingRate >= 10000 ? '>10K' : fundingRate.toFixed(0)}%</p>
            <p className="text-xs text-gray-500">{tr.fundedLabel}</p>
          </div>
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{project.backers_count.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{tr.backersLabel}</p>
          </div>
          {duration && (
            <div className="shrink-0">
              <p className="text-3xl font-black text-white">{duration}</p>
              <p className="text-xs text-gray-500">{tr.dayCampaign}</p>
            </div>
          )}
          {avgDailyPledged && (
            <div className="shrink-0">
              <p className="text-3xl font-black text-white">{fmtUsd(avgDailyPledged)}</p>
              <p className="text-xs text-gray-500">{tr.avgPerDay}</p>
            </div>
          )}
        </div>

        {/* Funding progress bar */}
        <div className="mt-4 mb-0">
          <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
            <div className="h-2 rounded-full bg-ks-green transition-all" style={{ width: `${Math.min(100, fundingRate)}%` }} />
          </div>
        </div>

        {/* Tab navigation */}
        <div className="flex items-center gap-0 mt-4 overflow-x-auto">
          {TABS.map(({ id: tabId, label, icon: Icon }) => (
            <button key={tabId} onClick={() => setActiveTab(tabId)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tabId
                  ? 'text-ks-green border-ks-green'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="bg-gray-50 rounded-b-2xl border-x border-b border-gray-200 p-6 space-y-6">

        {/* ── OVERVIEW ── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Grade + rank cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className={`${grade.color} rounded-xl p-4 text-white flex flex-col items-center justify-center`}>
                <p className="text-4xl font-black">{grade.grade}</p>
                <p className="text-xs font-semibold opacity-80 mt-1">{tr.fundingGrade}</p>
              </div>
              <StatCard label={tr.fundingRateLabel} value={`${fundingRate >= 10000 ? '>10,000' : fundingRate.toFixed(0)}%`}
                sub={fundingRate >= 100 ? tr.exceeded : tr.belowGoal} />
              <StatCard label={tr.backersLabel} value={project.backers_count.toLocaleString()}
                sub={avgDailyPledged ? `${(project.backers_count / (duration ?? 1)).toFixed(1)}${tr.dayAvgSuffix}` : undefined} />
              <StatCard label={tr.totalRaisedLabel} value={fmtUsd(project.usd_pledged)} sub={tr.goalPrefix(fmtUsd(project.goal))} />
            </div>

            {/* Timeline */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
              <h3 className="font-semibold text-gray-700 mb-4 text-sm uppercase tracking-wide">{tr.timeline}</h3>
              <div className="grid grid-cols-3 gap-6">
                {[
                  { label: tr.timelineCreated, date: fmtDate(project.created_at, lang) },
                  { label: tr.timelineLaunched, date: fmtDate(project.launched_at, lang) },
                  { label: tr.timelineDeadline, date: fmtDate(project.deadline, lang) },
                ].map(({ label, date }) => (
                  <div key={label}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{date}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily metrics table (real data) or Kicktraq import prompt */}
            {hasRealData ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-700 text-sm">{tr.snapshotTitle}</h3>
                  <span className="text-xs text-gray-400">{tr.snapshotRecords(snapshots.length)}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-gray-500 font-semibold uppercase tracking-wide">
                        <th className="text-left px-4 py-3">{tr.colDate}</th>
                        <th className="text-right px-4 py-3">{tr.colPledged}</th>
                        <th className="text-right px-4 py-3">{tr.colChange}</th>
                        <th className="text-right px-4 py-3">{tr.colBackers}</th>
                        <th className="text-right px-4 py-3">{tr.colDelta}</th>
                        <th className="text-right px-4 py-3">{tr.colDaysLeft}</th>
                        <th className="text-right px-4 py-3">{tr.colComments}</th>
                        <th className="text-right px-4 py-3">{tr.colUpdates}</th>
                        <th className="text-center px-4 py-3">{tr.colSource}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.slice(0, 30).map((s, i) => (
                        <tr key={s.captured_at} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                          <td className="px-4 py-2.5 text-gray-600">{fmtDateTime(s.captured_at)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtUsd(s.pledged_usd)}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${s.delta_pledged == null ? 'text-gray-400' : s.delta_pledged >= 0 ? 'text-ks-green' : 'text-red-500'}`}>
                            {s.delta_pledged == null ? '—' : `${s.delta_pledged >= 0 ? '+' : ''}${fmtUsd(s.delta_pledged)}`}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{s.backers_count.toLocaleString()}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${s.delta_backers == null ? 'text-gray-400' : s.delta_backers >= 0 ? 'text-ks-green' : 'text-red-500'}`}>
                            {s.delta_backers == null ? '—' : `${s.delta_backers >= 0 ? '+' : ''}${s.delta_backers.toLocaleString()}`}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{s.days_to_go}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{s.comments_count}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{s.updates_count}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.source === 'kicktraq' ? 'bg-blue-50 text-blue-600' : 'bg-ks-green-light text-ks-green-dark'}`}>
                              {s.source === 'kicktraq' ? 'KT' : 'KS'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center space-y-4">
                <p className="text-gray-500 text-sm">{tr.noHistoricalData}</p>
                <div className="flex justify-center gap-3">
                  <button onClick={triggerScrape} disabled={scraping}
                    className="flex items-center gap-2 px-4 py-2 bg-ks-green text-white rounded-lg text-sm font-semibold hover:bg-ks-green-dark disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
                    {scraping ? tr.fetchingFromKS : tr.fetchFromKS}
                  </button>
                  <button onClick={importKicktraq} disabled={ktImporting}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    <TrendingUp className={`w-4 h-4 ${ktImporting ? 'animate-pulse' : ''}`} />
                    {ktImporting ? tr.importingFromKT : tr.importFromKT}
                  </button>
                </div>
                {ktError && (
                  <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 max-w-md mx-auto">{ktError}</p>
                )}
                <p className="text-xs text-gray-400">{tr.kicktraqHint}</p>
              </div>
            )}

            {/* Tracking settings panel */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Radio className={`w-4 h-4 ${sharedTrackingActive ? 'text-ks-green animate-pulse' : 'text-gray-300'}`} />
                    <h3 className="font-semibold text-gray-800 text-sm">{detailCopy.sharedTitle}</h3>
                  </div>
                  <p className="text-sm text-gray-600 mt-2">
                    {sharedTrackingActive ? detailCopy.sharedActive : detailCopy.sharedInactive}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">{detailCopy.sharedHint}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${sharedTrackingActive ? 'bg-ks-green-light text-ks-green-dark' : 'bg-gray-100 text-gray-500'}`}>
                    {detailCopy.subscribers(subscriberCount)}
                  </span>
                  {sharedTrackingActive && (
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">
                      {cadenceLabel}
                    </span>
                  )}
                </div>
              </div>

              {tracking?.is_tracking ? (
                <div className="border-t border-gray-100 pt-5">
                  <h4 className="font-semibold text-gray-700 text-sm mb-4">{detailCopy.personalTitle}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      { key: 'track_rewards', label: tr.trackRewardsLabel },
                      { key: 'track_text_diff', label: tr.trackTextDiffLabel },
                      { key: 'track_comments', label: tr.trackCommentsLabel },
                      { key: 'analyze_comments', label: tr.trackAILabel },
                    ].map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <div className="relative">
                          <input type="checkbox"
                            checked={!!(tracking[key as keyof TrackingSettings])}
                            onChange={e => updateTrackSetting(key, e.target.checked ? 1 : 0)}
                            className="sr-only peer" />
                          <div className="w-9 h-5 bg-gray-200 rounded-full peer-checked:bg-ks-green transition-colors" />
                          <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-4 transition-transform" />
                        </div>
                        <span className="text-sm text-gray-700">{label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-gray-600">{tr.updateFreq}</span>
                    {[{ v: 1, label: tr.every4h }, { v: 2, label: tr.every1h }].map(({ v, label }) => (
                      <button key={v} onClick={() => updateTrackSetting('priority', v)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border ${tracking.priority === v ? 'bg-ks-green text-white border-ks-green' : 'bg-white text-gray-600 border-gray-200'}`}>
                        {label}
                      </button>
                    ))}
                    <span className="text-xs text-gray-400">{detailCopy.nextCadence(cadenceLabel)}</span>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-100 pt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-gray-500">{detailCopy.joinTracking}</p>
                  <button onClick={toggleTracking} disabled={trackLoading}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-ks-green text-white text-sm font-semibold hover:bg-ks-green-dark disabled:opacity-50">
                    <Radio className="w-4 h-4" />
                    {tr.trackBtn}
                  </button>
                </div>
              )}
            </div>

            <DataSource />
          </div>
        )}

        {/* ── FUNDING CURVE ── */}
        {activeTab === 'curve' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-700">
                {hasRealData ? tr.liveCurve : tr.simulatedCurve}
                {!hasRealData && <span className="ml-2 text-xs font-normal text-amber-600">{tr.noRealDataYet}</span>}
              </h3>
              {hasRealData && (
                <div className="flex gap-2">
                  {(['all', '30d', '14d'] as const).map(r => (
                    <button key={r} onClick={() => setChartRange(r)}
                      className={`px-3 py-1 rounded text-xs font-semibold ${chartRange === r ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {r === 'all' ? tr.chartAll : r.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {hasRealData && chartData.length > 1 ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-6">
                {/* Pledged chart */}
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">{tr.amountPledgedLabel}</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gPledged" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#05CE78" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#05CE78" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtUsd(v as number)} width={65} />
                      <Tooltip formatter={(v: number) => [fmtUsd(v), 'Pledged']} />
                      <Area type="monotone" dataKey="pledged" stroke="#05CE78" strokeWidth={2} fill="url(#gPledged)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Backers + engagement chart */}
                <div>
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-3">{tr.backersEngagement}</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={45} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="backers" stroke="#6366f1" strokeWidth={2} dot={false} name="Backers" />
                      <Line type="monotone" dataKey="comments" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Comments" />
                      <Line type="monotone" dataKey="updates" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Updates" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-gray-400 text-sm mb-4">
                  {hasRealData ? tr.notEnoughDataChart : tr.syncToSeeCurve}
                </p>
                <button onClick={triggerScrape} disabled={scraping}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-ks-green text-white rounded-lg text-sm font-semibold hover:bg-ks-green-dark disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
                  {scraping ? tr.syncingBtn : tr.syncNow}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── REWARDS ── */}
        {activeTab === 'rewards' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-700">{tr.rewardTiersLabel}</h3>
            {rewards.length ? (
              <div className="space-y-3">
                {rewards.map(r => {
                  const fillPct = r.limit_count ? Math.min(100, (r.backers_count / r.limit_count) * 100) : null;
                  return (
                    <div key={r.reward_id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg font-black text-ks-green">${r.amount_usd}</span>
                            {r.title && <span className="font-semibold text-gray-800">{r.title}</span>}
                            {r.is_limited ? (
                              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-100">{tr.limitedLabel}</span>
                            ) : null}
                          </div>
                          {r.description && <p className="text-sm text-gray-500 leading-relaxed">{r.description}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xl font-black text-gray-900">{r.backers_count.toLocaleString()}</p>
                          <p className="text-xs text-gray-400">{tr.backersUnit2}</p>
                          {r.limit_count && (
                            <p className="text-xs text-gray-400">{tr.leftOf(r.limit_count - r.backers_count, r.limit_count)}</p>
                          )}
                        </div>
                      </div>
                      {fillPct !== null && (
                        <div className="mt-3">
                          <div className="w-full bg-gray-100 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-amber-400 transition-all" style={{ width: `${fillPct}%` }} />
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{tr.claimedPct(fillPct.toFixed(0))}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-gray-400 text-sm mb-4">{tr.noRewardData}</p>
                <button onClick={triggerScrape} disabled={scraping}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-ks-green text-white rounded-lg text-sm font-semibold hover:bg-ks-green-dark disabled:opacity-50">
                  <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
                  {scraping ? tr.syncingBtn : tr.syncNow}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── TEXT CHANGES ── */}
        {activeTab === 'changes' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-700">{tr.textChangeHistoryLabel}</h3>
            {Object.keys(textByField).length ? (
              <div className="space-y-6">
                {Object.entries(textByField).map(([field, changes]) => (
                  <div key={field} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                      <h4 className="font-semibold text-gray-700 capitalize text-sm">{field}</h4>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {changes.map((change, i) => {
                        const prev = changes[i - 1];
                        return (
                          <div key={change.captured_at} className="px-5 py-4">
                            <p className="text-xs text-gray-400 mb-2">{fmtDateTime(change.captured_at)}</p>
                            {prev ? (
                              <DiffBlock before={prev.content} after={change.content} />
                            ) : (
                              <p className="text-sm text-gray-600">{change.content}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-gray-400 text-sm mb-2">{tr.noTextHistory}</p>
                <p className="text-xs text-gray-400">{tr.enableTrackingHint}</p>
              </div>
            )}
          </div>
        )}

        {/* ── SIMILAR PROJECTS ── */}
        {activeTab === 'similar' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-700">{tr.similarProjectsLabel}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{tr.similarDesc}</p>
            </div>
            {project.similar?.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {project.similar.map(s => {
                  const sRate = s.goal > 0 ? (s.usd_pledged / s.goal) * 100 : 0;
                  const sg = fundingGrade(sRate);
                  return (
                    <button key={s.id} onClick={() => router.push(`/projects/${s.id}`)}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md hover:border-ks-green/30 transition-all">
                      <div className="flex items-start gap-3">
                        <div className={`${sg.color} w-10 h-10 rounded-lg flex items-center justify-center shrink-0`}>
                          <span className="text-white text-xs font-black">{sg.grade}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${STATE_COLOR[s.state] ?? 'bg-gray-100 text-gray-500'}`}>
                              {s.state}
                            </span>
                            <span className="text-[10px] text-gray-400">{s.category_name}</span>
                          </div>
                          <p className="text-sm font-semibold text-gray-800 leading-snug line-clamp-2">{s.name}</p>
                          <p className="text-xs text-gray-400 mt-1 line-clamp-1">{s.blurb}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className={`font-bold ${sRate >= 100 ? 'text-ks-green' : 'text-gray-600'}`}>
                          {tr.fundedPct(sRate.toFixed(0))}
                        </span>
                        <span className="text-gray-400">{fmtUsd(s.usd_pledged)}</span>
                      </div>
                      <div className="mt-1.5 w-full bg-gray-100 rounded-full h-1">
                        <div className="h-1 rounded-full bg-ks-green" style={{ width: `${Math.min(100, sRate)}%` }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-gray-400 text-sm">{tr.noSimilarFound}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
