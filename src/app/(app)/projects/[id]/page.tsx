'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, ExternalLink, TrendingUp, Calendar, Award, Heart,
  Activity, FileText, Layers, RefreshCw, Radio, Gift, Users,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend, ReferenceLine,
} from 'recharts';
import DataSource from '@/components/DataSource';
import ImagePreview from '@/components/ImagePreview';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import type { FundingPrediction, DeviationPoint } from '@/lib/prediction';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string; name: string; blurb: string; state: string;
  country: string; country_name: string; currency: string;
  category_parent: string; category_name: string; category_id: number;
  goal: number; pledged: number; usd_pledged: number; backers_count: number;
  staff_pick: number; created_at: number; launched_at: number; deadline: number;
  creator_name: string; creator_slug?: string; creator_url?: string; source_url: string; slug: string;
  image_url?: string | null; image_thumb_url?: string | null;
  similar?: SimilarProject[];
}

interface SimilarProject {
  id: string; name: string; blurb: string; state: string;
  category_parent: string; category_name: string;
  usd_pledged: number; goal: number; backers_count: number;
  launched_at: number; source_url: string; slug: string;
  image_url?: string | null; image_thumb_url?: string | null;
}

interface Snapshot {
  captured_at: number; pledged_usd: number; backers_count: number;
  days_to_go: number; comments_count: number; updates_count: number;
  state: string; source: string;
}

interface KicktraqDebug {
  images?: Array<{ kind: string; url: string; status: number; contentType: string; bytes: number; dataUrl: string }>;
  modelOutput?: string;
  structuredRows?: Array<{ date: string; pledged_usd: number; backers: number; comments?: number }>;
  writtenSnapshots?: Array<{
    date: string;
    captured_at: number;
    pledged_usd: number;
    backers_count: number;
    comments_count: number;
    daily_pledged_usd: number;
    daily_backers: number;
    daily_comments: number;
    source: string;
  }>;
}

interface KicktraqStatusPayload {
  ok?: boolean;
  status?: 'running' | 'complete' | 'failed';
  phase?: string;
  progress?: number;
  message?: string;
  debug?: KicktraqDebug;
  diagnostics?: { debug?: KicktraqDebug };
  structuredDays?: KicktraqDebug['structuredRows'];
  writtenSnapshots?: KicktraqDebug['writtenSnapshots'];
}

interface SyncResultPayload {
  ok?: boolean;
  full?: boolean;
  source?: string;
  rewardCount?: number;
  collaboratorCount?: number;
  message?: string;
  error?: string;
  detail?: string | null;
  recentErrors?: Array<{ message?: string; job_type?: string | null; status_code?: number | null }>;
}

interface Reward {
  reward_id: string; title: string; description: string;
  amount_usd: number; backers_count: number; limit_count: number | null; is_limited: number;
}

interface TextChange {
  field: string; captured_at: number; content: string;
}

interface Collaborator {
  collaborator_key: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  is_service_agency?: number;
  captured_at: number;
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

const TAB_IDS = ['overview', 'curve', 'rewards', 'changes', 'collaborators', 'similar'] as const;
type TabId = typeof TAB_IDS[number];
type CurveMetric = 'pledged' | 'backers' | 'comments';
type CurveMode = 'daily' | 'cumulative';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(v: number, currency = 'USD') {
  const symbols: Record<string, string> = { USD: '$', HKD: 'HK$', AUD: 'A$', CAD: 'C$', GBP: '£', EUR: '€', JPY: '¥' };
  const prefix = symbols[currency] ?? `${currency} `;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toLocaleString()}`;
}

function fmtUsd(v: number) {
  return fmtMoney(v, 'USD');
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

function daysLeftAt(deadline: number | null | undefined, capturedAt: number) {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline - capturedAt) / 86400));
}

function avg(values: number[]) {
  const usable = values.filter(v => Number.isFinite(v));
  return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : 0;
}

function calcDuration(p: Project): number | null {
  if (!p.launched_at || !p.deadline) return null;
  return Math.round((p.deadline - p.launched_at) / 86400);
}

function fmtTimeLeft(deadline: number | null, lang: string) {
  if (!deadline) return null;
  const seconds = deadline - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return lang === 'cn' ? '已结束' : 'Ended';
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return lang === 'cn' ? `${days} 天` : `${days}d`;
  const hours = Math.max(1, Math.floor(seconds / 3600));
  return lang === 'cn' ? `${hours} 小时` : `${hours}h`;
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

function KicktraqDebugConsole({
  lang,
  debug,
  importing,
  phase,
  progress,
  message,
  onRefresh,
}: {
  lang: string;
  debug: KicktraqDebug | null;
  importing: boolean;
  phase: string;
  progress: number;
  message: string;
  onRefresh: () => void;
}) {
  const cn = lang === 'cn';
  const images = debug?.images ?? [];
  const structuredRows = debug?.structuredRows ?? [];
  const writtenSnapshots = debug?.writtenSnapshots ?? [];
  const hasDebug = images.length > 0 || !!debug?.modelOutput || structuredRows.length > 0 || writtenSnapshots.length > 0;

  if (!hasDebug && !importing && !message) return null;

  return (
    <div className="rounded-2xl border border-blue-100 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-blue-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-black text-gray-900">{cn ? 'Kicktraq 导入 Debug 台' : 'Kicktraq Import Debug Console'}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${importing ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
              {importing ? (cn ? '运行中' : 'Running') : (cn ? '最近记录' : 'Latest record')}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            {cn
              ? '临时调试：核对原始图片、模型识别输出、结构化结果和最终写库结果。'
              : 'Temporary debug surface for raw images, model output, structured rows, and database writes.'}
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {cn ? '刷新 Debug' : 'Refresh debug'}
        </button>
      </div>

      <div className="px-5 pt-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-semibold text-gray-500">
            {phase || (cn ? '等待导入任务' : 'Waiting for import')}
            {message ? <span className="ml-2 font-normal text-gray-400">{message}</span> : null}
          </p>
          <span className="text-xs font-bold text-blue-600">{Math.round(progress)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-50">
          <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-3">
        <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-xs font-black uppercase tracking-wide text-gray-500">{cn ? '1. 原始图片' : '1. Raw images'}</h4>
            <span className="text-[11px] font-semibold text-gray-400">{images.length}</span>
          </div>
          {images.length ? (
            <div className="space-y-3">
              {images.map((img, i) => (
                <div key={`${img.kind}-${i}`} className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="mb-2 flex flex-wrap gap-2 text-[10px] text-gray-500">
                    <span className="font-bold text-gray-800">{img.kind}</span>
                    <span>{img.status}</span>
                    <span>{img.contentType}</span>
                    <span>{img.bytes.toLocaleString()} bytes</span>
                  </div>
                  <img src={img.dataUrl} alt={`${img.kind} chart`} className="max-h-56 w-full rounded border border-gray-100 object-contain" />
                  <p className="mt-2 break-all text-[10px] text-gray-400">{img.url}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-white px-3 py-4 text-xs text-gray-400">{cn ? '暂无图片输入。' : 'No image input captured yet.'}</p>
          )}
        </section>

        <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <h4 className="mb-3 text-xs font-black uppercase tracking-wide text-gray-500">{cn ? '2. 模型识别输出' : '2. Model output'}</h4>
          <pre className="max-h-[420px] overflow-auto rounded-lg bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100 whitespace-pre-wrap">
            {debug?.modelOutput || (cn ? '暂无模型输出。' : 'No model output captured yet.')}
          </pre>
        </section>

        <section className="rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-xs font-black uppercase tracking-wide text-gray-500">{cn ? '3. 结构化/写库' : '3. Structured / written'}</h4>
            <span className="text-[11px] font-semibold text-gray-400">{structuredRows.length} / {writtenSnapshots.length}</span>
          </div>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-[11px] font-bold text-gray-500">{cn ? '模型结构化结果' : 'Structured rows'}</p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-950">
                {JSON.stringify(structuredRows, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-bold text-gray-500">{cn ? '最终写库结果' : 'Database writes'}</p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-blue-50 p-3 text-[11px] leading-relaxed text-blue-950">
                {JSON.stringify(writtenSnapshots, null, 2)}
              </pre>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

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
    { id: 'collaborators' as TabId, label: tr.tabCollaborators, icon: Users },
    { id: 'similar' as TabId, label: tr.tabSimilar, icon: Layers },
  ];

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const [tracking, setTracking] = useState<TrackingSettings | null>(null);
  const [platformTracking, setPlatformTracking] = useState<TrackingSettings | null>(null);
  const [trackLoading, setTrackLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [autoSyncAttempted, setAutoSyncAttempted] = useState(false);
  const [ktImporting, setKtImporting] = useState(false);
  const [ktProgress, setKtProgress] = useState(0);
  const [ktPhase, setKtPhase] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncNotice, setSyncNotice] = useState<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [curveModes, setCurveModes] = useState<Record<CurveMetric, CurveMode>>({
    pledged: 'daily',
    backers: 'daily',
    comments: 'daily',
  });

  // Snapshot data
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [textHistory, setTextHistory] = useState<TextChange[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [prediction, setPrediction] = useState<FundingPrediction | null>(null);
  const [deviationSeries, setDeviationSeries] = useState<DeviationPoint[]>([]);

  const [ktDebug, setKtDebug] = useState<KicktraqDebug | null>(null);

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
  const loadProject = useCallback(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`)
      .then(r => { if (r.status === 404) { setNotFound(true); setLoading(false); return null; } return r.json(); })
      .then(d => { if (d) setProject(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

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
  const loadSnapshots = useCallback(async () => {
    if (!id) return;
    try {
      const r = await fetch(`/api/snapshots/${id}`);
      const d = await r.json();
      setSnapshots(d.snapshots ?? []);
      setRewards(d.rewards ?? []);
      setTextHistory(d.textHistory ?? []);
      setCollaborators(d.collaborators ?? []);
      setPrediction(d.prediction ?? null);
      setDeviationSeries(d.deviationSeries ?? []);
    } catch {}
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
      setTracking(prev => prev ? { ...prev, is_tracking: 1 } : { is_tracking: 1, track_rewards: 0, track_comments: 0, analyze_comments: 0, track_text_diff: 1, priority: 1, last_fetched: null });
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
    if (!id) return;
    setScraping(true);
    setSyncError('');
    setSyncNotice(null);
    try {
      const res = await fetch(`/api/track/${id}`, { method: 'POST' });
      const data = await res.json().catch(() => ({})) as SyncResultPayload;
      const recentDetail = data.recentErrors?.map(e => e.message).filter(Boolean).slice(0, 2).join(' | ');
      const detail = data.detail ?? recentDetail ?? data.message ?? data.error ?? null;
      if (!res.ok || !data.ok) {
        const text = detail ?? 'Sync failed';
        setSyncError(text);
        setSyncNotice({ kind: 'error', text });
      } else {
        setSyncNotice({
          kind: 'success',
          text: data.message ?? 'Synced latest Kickstarter basic fields.',
        });
      }
      await new Promise(r => setTimeout(r, 500));
      await loadProject();
      await loadSnapshots();
      await loadTracking();
    } catch {
      const text = 'Network error - please try again.';
      setSyncError(text);
      setSyncNotice({ kind: 'error', text });
    }
    setScraping(false);
  };

  const [ktError, setKtError] = useState('');
  const [ktNoData, setKtNoData] = useState(false);
  const [ktNoDataMessage, setKtNoDataMessage] = useState('');
  const [ktInfo, setKtInfo] = useState('');
  const applyKicktraqPayload = useCallback((payload: KicktraqStatusPayload) => {
    const baseDebug = payload.debug ?? payload.diagnostics?.debug ?? null;
    const mergedDebug = baseDebug || payload.structuredDays || payload.writtenSnapshots
      ? {
          ...(baseDebug ?? {}),
          structuredRows: payload.structuredDays ?? baseDebug?.structuredRows,
          writtenSnapshots: payload.writtenSnapshots ?? baseDebug?.writtenSnapshots,
        }
      : null;
    if (mergedDebug) setKtDebug(mergedDebug);
    if (typeof payload.progress === 'number') setKtProgress(Math.max(0, Math.min(100, payload.progress)));
    if (payload.phase) setKtPhase(payload.phase);
    if (payload.status === 'running') {
      setKtImporting(true);
      setKtInfo(lang === 'cn' ? 'Kicktraq 导入任务正在服务器运行。' : 'Kicktraq import is running on the server.');
    } else if (payload.status === 'complete') {
      setKtImporting(false);
      setKtNoData(false);
      setKtInfo(lang === 'cn' ? `导入完成${payload.structuredDays?.length ? `，${payload.structuredDays.length} 条结构化数据已写入。` : '。'}` : 'Import complete.');
    } else if (payload.status === 'failed') {
      setKtImporting(false);
      setKtNoData(true);
      setKtInfo('');
      setKtNoDataMessage(friendlyKicktraqMessage(payload.message));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const loadCachedKicktraqDebug = useCallback(async () => {
    if (!id || !user) return null;
    try {
      const debugRes = await fetch(`/api/kicktraq/${id}`);
      if (!debugRes.ok) return null;
      const cached = await debugRes.json() as KicktraqStatusPayload;
      applyKicktraqPayload(cached);
      return cached;
    } catch {
      return null;
    }
  }, [applyKicktraqPayload, id, user]);

  useEffect(() => {
    loadCachedKicktraqDebug();
  }, [loadCachedKicktraqDebug]);

  useEffect(() => {
    if (!ktImporting) return;
    const timer = window.setInterval(async () => {
      const cached = await loadCachedKicktraqDebug();
      if (cached?.status === 'complete') {
        await loadSnapshots();
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [ktImporting, loadCachedKicktraqDebug, loadSnapshots]);

  const friendlyKicktraqMessage = (message?: string) => {
    if (message?.includes('cannot read OPENAI_API_KEY') || message?.includes('cannot read')) {
      return lang === 'cn'
        ? '当前线上服务还没有读到 OCR Key。请确认变量加在同一个 Railway Service/Environment，并重新部署或 Restart 后再导入。'
        : 'OCR is not active in the running Railway service. Make sure the key is on this service/environment, then redeploy or restart and import again.';
    }
    if (message?.includes('OCR is configured')) {
      return lang === 'cn'
        ? 'OCR 已启用，但这张 Kicktraq 图表没有解析出可用数据，可能是图表被拦截、图片不可读或项目暂无公开 daily chart。'
        : 'OCR is active, but no usable daily rows were extracted. Kicktraq may have blocked the chart image, returned an unreadable image, or not exposed a public daily chart.';
    }
    return message ?? '';
  };
  const importKicktraq = async () => {
    if (!user) { showLogin(); return; }
    if (!id) return;
    setKtImporting(true);
    setKtError('');
    setKtNoData(false);
    setKtNoDataMessage('');
    setKtInfo(lang === 'cn' ? '正在连接 Kicktraq 并读取图表...' : 'Connecting to Kicktraq and reading charts...');
    setKtProgress(8);
    setKtPhase(lang === 'cn' ? '准备导入' : 'Preparing import');
    setKtDebug(null);
    try {
      const res = await fetch(`/api/kicktraq/${id}`, { method: 'POST' });
      const data = await res.json() as KicktraqStatusPayload & { noData?: boolean; days?: number };
      applyKicktraqPayload({ ...data, status: data.ok ? 'complete' : data.noData ? 'failed' : data.status });
      if (data.ok) {
        await loadSnapshots();
      } else if (data.noData) {
        setKtNoData(true);
        setKtNoDataMessage(friendlyKicktraqMessage(data.message));
      } else {
        setKtError(data.message ?? 'Import failed');
      }
    } catch {
      await new Promise(r => setTimeout(r, 1200));
      await loadSnapshots();
      const cached = await loadCachedKicktraqDebug();
      if (!cached || cached.status !== 'running') setKtImporting(false);
      setKtInfo(lang === 'cn'
        ? '导入请求连接中断，但后台可能已经写入成功；已自动刷新快照并尝试读取调试信息。'
        : 'The import request disconnected, but the server may have completed it. Snapshots were refreshed and debug data was retried.');
    }
  };

  // ── Chart data ─────────────────────────────────────────────────────────────

  const filteredSnapshots = snapshots;

  const snapshotWithDeltas = filteredSnapshots.map((s, i, arr) => {
    const prev = arr[i - 1];
    return {
      ...s,
      daily_pledged: prev ? s.pledged_usd - prev.pledged_usd : s.pledged_usd,
      daily_backers: prev ? s.backers_count - prev.backers_count : s.backers_count,
      daily_comments: prev ? s.comments_count - prev.comments_count : s.comments_count,
    };
  });

  const chartData = snapshotWithDeltas.map(s => ({
    date: fmtDate(s.captured_at, lang),
    ts: s.captured_at,
    pledgedTotal: Math.max(0, Math.round(s.pledged_usd)),
    pledgedDaily: Math.max(0, Math.round(s.daily_pledged)),
    backersTotal: Math.max(0, s.backers_count),
    backersDaily: Math.max(0, s.daily_backers),
    commentsTotal: Math.max(0, s.comments_count),
    commentsDaily: Math.max(0, s.daily_comments),
    source: s.source,
  }));

  const avgPledgedDaily = avg(chartData.map(d => d.pledgedDaily));
  const avgBackersDaily = avg(chartData.map(d => d.backersDaily));
  const avgCommentsDaily = avg(chartData.map(d => d.commentsDaily));

  // Prediction deviation: actual cumulative vs the model's one-step-ahead pace
  // expectation at each snapshot, plus the signed deviation curve.
  const deviationChartData = deviationSeries.map(d => ({
    date: fmtDate(d.ts, lang),
    ts: d.ts,
    actual: d.actualUsd,
    expected: d.expectedUsd,
    deviation: d.deviationUsd,
    deviationPct: d.deviationPct,
  }));

  const setCurveMode = (metric: CurveMetric, mode: CurveMode) => {
    setCurveModes(prev => ({ ...prev, [metric]: mode }));
  };

  const curveModeLabel = (mode: CurveMode) => (
    mode === 'daily'
      ? (lang === 'cn' ? '新增数据' : 'New')
      : (lang === 'cn' ? '加总数据' : 'Cumulative')
  );

  // Table data: most recent first, delta columns
  const tableData = [...filteredSnapshots].reverse().map((s, i, arr) => {
    const prev = arr[i + 1];
    return {
      ...s,
      delta_pledged: prev ? s.pledged_usd - prev.pledged_usd : null,
      delta_backers: prev ? s.backers_count - prev.backers_count : null,
      delta_comments: prev ? s.comments_count - prev.comments_count : null,
      calculated_days_left: daysLeftAt(project?.deadline, s.captured_at),
    };
  });

  // ── Loading / not found ────────────────────────────────────────────────────

  const goBackToProjectList = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/projects');
  };

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{tr.loading}</div>;
  if (notFound) return (
    <div className="max-w-2xl mx-auto mt-20 text-center space-y-4">
      <p className="text-gray-400 text-lg">{tr.notFound}</p>
      <button onClick={goBackToProjectList} className="text-ks-green text-sm hover:underline">{tr.backToList}</button>
    </div>
  );
  if (!project) return null;

  const newestSnapshots = [...snapshots].reverse();
  const nativeCurrency = project.currency || 'USD';
  const latestNativeKicktraqSnapshot = nativeCurrency !== 'USD'
    ? newestSnapshots.find(s => s.source === 'kicktraq_active' && s.pledged_usd > 0)
    : null;
  const latestUsdSnapshot = newestSnapshots.find(s => s.pledged_usd > 0 && !(s.source === 'kicktraq_active' && nativeCurrency !== 'USD'));
  const nativeKicktraqLooksCurrent = !!latestNativeKicktraqSnapshot
    && Math.abs(project.usd_pledged - latestNativeKicktraqSnapshot.pledged_usd) / Math.max(1, latestNativeKicktraqSnapshot.pledged_usd) < 0.02;
  const displayCurrency = nativeKicktraqLooksCurrent ? nativeCurrency : 'USD';
  const displayPledged = nativeKicktraqLooksCurrent
    ? latestNativeKicktraqSnapshot!.pledged_usd
    : Math.max(Number(project.usd_pledged ?? 0), Number(latestUsdSnapshot?.pledged_usd ?? 0));
  const displayBackers = nativeKicktraqLooksCurrent
    ? latestNativeKicktraqSnapshot?.backers_count ?? project.backers_count
    : Math.max(Number(project.backers_count ?? 0), Number(latestUsdSnapshot?.backers_count ?? 0));
  const inferredGoalUsd = nativeCurrency !== 'USD' && project.pledged > 0 && project.usd_pledged > 0 && project.usd_pledged < project.pledged
    ? project.goal * (project.usd_pledged / project.pledged)
    : project.goal;
  const displayGoal = nativeKicktraqLooksCurrent ? project.goal : inferredGoalUsd;
  const displayGoalText = displayGoal > 0 ? fmtMoney(displayGoal, displayCurrency) : (lang === 'cn' ? '未知' : 'unknown');
  const fundingRate = displayGoal > 0 ? (displayPledged / displayGoal) * 100 : 0;
  const duration = calcDuration(project);
  const avgDailyPledged = duration && duration > 0 ? displayPledged / duration : null;
  const timeLeft = fmtTimeLeft(project.deadline, lang);
  const grade = fundingGrade(fundingRate);
  const ksUrl = project.source_url?.startsWith('https://www.kickstarter.com/projects/') ? project.source_url : null;
  const creatorUrl = project.creator_url || (project.creator_slug ? `https://www.kickstarter.com/profile/${project.creator_slug}` : null);
  const kicktraqUrl = project.creator_slug && project.slug ? `https://www.kicktraq.com/projects/${project.creator_slug}/${project.slug}/` : null;
  const heroImage = project.image_url || project.image_thumb_url;
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

  const totalRewardBackers = rewards.reduce((sum, r) => sum + r.backers_count, 0);
  const totalRewardValue = rewards.reduce((sum, r) => sum + r.amount_usd * r.backers_count, 0);
  const topReward = [...rewards].sort((a, b) => b.backers_count - a.backers_count)[0] ?? null;
  const limitedRewardCount = rewards.filter(r => r.is_limited || r.limit_count).length;
  const rewardPriceBands = [
    { label: '< 50', min: 0, max: 50 },
    { label: '50-99', min: 50, max: 100 },
    { label: '100-249', min: 100, max: 250 },
    { label: '250-499', min: 250, max: 500 },
    { label: '500+', min: 500, max: Infinity },
  ].map(band => {
    const rows = rewards.filter(r => r.amount_usd >= band.min && r.amount_usd < band.max);
    return {
      ...band,
      skuCount: rows.length,
      backers: rows.reduce((sum, r) => sum + r.backers_count, 0),
    };
  });
  const maxBandBackers = Math.max(1, ...rewardPriceBands.map(b => b.backers));
  const maxRewardBackers = Math.max(1, ...rewards.map(r => r.backers_count));

  return (
    <div className="max-w-6xl mx-auto space-y-0">
      {/* Back */}
      <button onClick={goBackToProjectList}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-4">
        <ArrowLeft className="w-4 h-4" />{tr.back}
      </button>

      {/* ── Hero header (Social Blade style) ───────────────────────────────── */}
      <div className="bg-gray-900 rounded-t-2xl px-4 pt-5 pb-0 sm:px-6 sm:pt-6">
        {/* Top row */}
        <div className="flex flex-col items-start justify-between gap-4 mb-4 lg:flex-row">
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
              {project.creator_name && creatorUrl ? (
                <a href={creatorUrl} target="_blank" rel="noopener noreferrer"
                  className="text-gray-300 font-medium hover:text-ks-green transition-colors">
                  {project.creator_name}
                </a>
              ) : project.creator_name ? (
                <span className="text-gray-300 font-medium">{project.creator_name}</span>
              ) : null}
              <span>{project.country_name || project.country}</span>
              <span>{project.currency}</span>
              {sharedLastFetched && (
                <span className="flex items-center gap-1 text-ks-green/80">
                  <Radio className="w-3 h-3" /> {tr.lastSynced} {fmtDateTime(sharedLastFetched)}
                </span>
              )}
            </div>
          </div>

          <div className="w-full shrink-0 space-y-3 lg:w-[420px]">
            {heroImage && (
              <div className="overflow-hidden rounded-xl border border-white/10 bg-gray-800 shadow-lg">
                <ImagePreview src={heroImage} className="block h-full w-full">
                  <img src={heroImage} alt={project.name} className="aspect-video w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                </ImagePreview>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 flex-wrap justify-end">
              <button onClick={toggleFavorite}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                  isFavorited ? 'bg-red-900/40 text-red-400 border-red-800/40 hover:bg-red-900/60'
                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-red-900/30 hover:text-red-400'
                }`}>
                <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
                {isFavorited ? tr.saved : tr.saveBtn}
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
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-8 pb-0 overflow-x-auto">
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{fmtMoney(displayPledged, displayCurrency)}</p>
            <p className="text-xs text-gray-500">{tr.pledgedOf(displayGoalText)}</p>
          </div>
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{fundingRate >= 10000 ? '>10K' : fundingRate.toFixed(0)}%</p>
            <p className="text-xs text-gray-500">{tr.fundedLabel}</p>
          </div>
          <div className="shrink-0">
            <p className="text-3xl font-black text-white">{displayBackers.toLocaleString()}</p>
            <p className="text-xs text-gray-500">{tr.backersLabel}</p>
          </div>
          {timeLeft && (
            <div className="shrink-0">
              <p className="text-3xl font-black text-white">{timeLeft}</p>
              <p className="text-xs text-gray-500">{lang === 'cn' ? '剩余时间' : 'time left'}</p>
            </div>
          )}
          {avgDailyPledged && (
            <div className="shrink-0">
              <p className="text-3xl font-black text-white">{fmtMoney(avgDailyPledged, displayCurrency)}</p>
              <p className="text-xs text-gray-500">{tr.avgPerDay}</p>
            </div>
          )}
          {prediction && project.state === 'live' && (
            <div className="shrink-0" title={tr.predictionHint}>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-black text-ks-green">{fmtMoney(prediction.predictedFinalUsd, 'USD')}</p>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  prediction.confidenceLabel === 'high' ? 'bg-ks-green/20 text-ks-green'
                    : prediction.confidenceLabel === 'medium' ? 'bg-amber-400/20 text-amber-300'
                    : 'bg-gray-600/40 text-gray-300'
                }`}>{tr.confidenceLevels[prediction.confidenceLabel]}</span>
              </div>
              <p className="text-xs text-gray-500">
                {tr.predictedFinal}
                {inferredGoalUsd > 0 && <> · {tr.predictedOfGoal((prediction.predictedFinalUsd / inferredGoalUsd * 100).toFixed(0))}</>}
              </p>
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
      <div className="bg-gray-50 rounded-b-2xl border-x border-b border-gray-200 p-4 sm:p-6 space-y-6">
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
              <StatCard label={tr.backersLabel} value={displayBackers.toLocaleString()}
                sub={duration ? `${(displayBackers / Math.max(1, duration)).toFixed(1)}${tr.dayAvgSuffix}` : undefined} />
              <StatCard label={tr.totalRaisedLabel} value={fmtMoney(displayPledged, displayCurrency)} sub={tr.goalPrefix(displayGoalText)} />
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
                        <th className="text-left px-4 py-3">{lang === 'cn' ? '快照时间' : 'Snapshot Time'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '累计已筹' : 'Total Pledged'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '筹款增量' : 'Pledged Change'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '累计支持者' : 'Total Backers'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '支持者增量' : 'Backer Change'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '剩余天数' : 'Days Left'}</th>
                        <th className="text-right px-4 py-3">{lang === 'cn' ? '评论增量' : 'Comment Change'}</th>
                        <th className="text-center px-4 py-3">{lang === 'cn' ? '数据来源' : 'Source'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableData.map((s, i) => (
                        <tr key={s.captured_at} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                          <td className="px-4 py-2.5 text-gray-600">{fmtDateTime(s.captured_at)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{fmtMoney(s.pledged_usd, s.source === 'kicktraq_active' && nativeCurrency !== 'USD' ? nativeCurrency : 'USD')}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${s.delta_pledged == null ? 'text-gray-400' : s.delta_pledged >= 0 ? 'text-ks-green' : 'text-red-500'}`}>
                            {s.delta_pledged == null ? '—' : `${s.delta_pledged >= 0 ? '+' : ''}${fmtMoney(s.delta_pledged, s.source === 'kicktraq_active' && nativeCurrency !== 'USD' ? nativeCurrency : 'USD')}`}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700">{s.backers_count.toLocaleString()}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${s.delta_backers == null ? 'text-gray-400' : s.delta_backers >= 0 ? 'text-ks-green' : 'text-red-500'}`}>
                            {s.delta_backers == null ? '—' : `${s.delta_backers >= 0 ? '+' : ''}${s.delta_backers.toLocaleString()}`}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{s.calculated_days_left ?? '-'}</td>
                          <td className={`px-4 py-2.5 text-right font-semibold ${s.delta_comments == null ? 'text-gray-400' : s.delta_comments >= 0 ? 'text-ks-green' : 'text-red-500'}`}>
                            {s.delta_comments == null ? '—' : `${s.delta_comments >= 0 ? '+' : ''}${s.delta_comments.toLocaleString()}`}
                          </td>
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
                <div className="hidden">
                  <button onClick={triggerScrape} disabled={scraping}
                    title={lang === 'cn' ? '立刻从 Kickstarter 项目 JSON 抓取一次最新快照和奖励。' : 'Fetch the latest Kickstarter JSON snapshot and rewards once.'}
                    className="flex items-center gap-2 px-4 py-2 bg-ks-green text-white rounded-lg text-sm font-semibold hover:bg-ks-green-dark disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
                    {scraping ? tr.fetchingFromKS : tr.fetchFromKS}
                  </button>
                  <button onClick={importKicktraq} disabled={ktImporting}
                    title={lang === 'cn' ? '尝试从 Kicktraq 的公开日图表读取历史逐日数据；不是所有项目都有可读取数据。' : 'Try to import public daily chart data from Kicktraq. Not every project exposes readable data.'}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                    <TrendingUp className={`w-4 h-4 ${ktImporting ? 'animate-pulse' : ''}`} />
                    {ktImporting
                      ? (lang === 'cn' ? '正在读取图表数据...' : 'Reading chart data...')
                      : tr.importFromKT}
                  </button>
                </div>
                {false && ktError && (
                  <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 max-w-md mx-auto">{ktError}</p>
                )}
                {false && ktNoData && (
                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 max-w-md mx-auto">
                    {lang === 'cn'
                      ? (ktNoDataMessage || 'Kicktraq 的逐日图表没有可解析数据；如果页面只有图片图表，需要配置 OCR key 后再导入。')
                      : 'Kicktraq chart data loads via browser-side JS and cannot be fetched server-side. Use "Fetch from Kickstarter" to start collecting daily snapshots.'}
                  </p>
                )}
                <p className="text-xs text-gray-400">
                  {lang === 'cn'
                    ? 'Kicktraq 导入适合已经被 Kicktraq 收录并公开 dailychart 的项目；如果没有数据，按钮会返回原因。'
                    : 'Kicktraq import works for projects indexed by Kicktraq with public dailychart data; if no data is available, the button returns the reason.'}
                </p>
              </div>
            )}

            {/* Tracking settings panel */}
            <div className="hidden">
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

              <div className="border-t border-gray-100 pt-4">
                <p className="text-sm text-gray-500">
                  {lang === 'cn'
                    ? '进行中的项目会自动进入平台追踪队列，后台会持续同步快照、奖励和文案变化。'
                    : 'Live projects enter the shared tracking queue automatically. The crawler keeps syncing snapshots, rewards, and text changes in the background.'}
                </p>
              </div>
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
            </div>

            {hasRealData && chartData.length > 1 ? (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-6">
                {/* Pledged chart */}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                      {curveModes.pledged === 'daily'
                        ? (lang === 'cn'
                          ? `每日新增金额 · 平均 ${fmtMoney(avgPledgedDaily, displayCurrency)}`
                          : `Daily pledged change · Avg ${fmtMoney(avgPledgedDaily, displayCurrency)}`)
                        : (lang === 'cn' ? '累计众筹金额' : 'Cumulative pledged')}
                    </p>
                    <div className="rounded-lg bg-gray-100 p-1">
                      {(['daily', 'cumulative'] as const).map(mode => (
                        <button key={mode} onClick={() => setCurveMode('pledged', mode)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${curveModes.pledged === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                          {curveModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>
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
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtMoney(v as number, displayCurrency)} width={65} />
                      <Tooltip formatter={(v: number) => [fmtMoney(v, displayCurrency), curveModes.pledged === 'daily' ? (lang === 'cn' ? '金额增量' : 'Pledged Change') : (lang === 'cn' ? '累计金额' : 'Total Pledged')]} />
                      {curveModes.pledged === 'daily' && (
                        <ReferenceLine y={avgPledgedDaily} stroke="#64748b" strokeDasharray="5 5" label={{ value: lang === 'cn' ? '平均' : 'Avg', fontSize: 10, fill: '#64748b' }} />
                      )}
                      <Area type="monotone" dataKey={curveModes.pledged === 'daily' ? 'pledgedDaily' : 'pledgedTotal'} stroke="#05CE78" strokeWidth={2} fill="url(#gPledged)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Backers chart */}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                      {curveModes.backers === 'daily'
                        ? (lang === 'cn'
                          ? `每日新增 Backer · 平均 ${Math.round(avgBackersDaily).toLocaleString()}`
                          : `Daily backer change · Avg ${Math.round(avgBackersDaily).toLocaleString()}`)
                        : (lang === 'cn' ? '累计支持者' : 'Cumulative backers')}
                    </p>
                    <div className="rounded-lg bg-gray-100 p-1">
                      {(['daily', 'cumulative'] as const).map(mode => (
                        <button key={mode} onClick={() => setCurveMode('backers', mode)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${curveModes.backers === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                          {curveModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={45} />
                      <Tooltip formatter={(v: number) => [Number(v).toLocaleString(), curveModes.backers === 'daily' ? (lang === 'cn' ? '支持者增量' : 'Backer Change') : (lang === 'cn' ? '累计支持者' : 'Total Backers')]} />
                      {curveModes.backers === 'daily' && (
                        <ReferenceLine y={avgBackersDaily} stroke="#6366f1" strokeDasharray="5 5" label={{ value: lang === 'cn' ? '平均' : 'Avg', fontSize: 10, fill: '#6366f1' }} />
                      )}
                      <Line type="monotone" dataKey={curveModes.backers === 'daily' ? 'backersDaily' : 'backersTotal'} stroke="#6366f1" strokeWidth={2} dot={false} name={curveModes.backers === 'daily' ? (lang === 'cn' ? '支持者增量' : 'Backer Change') : (lang === 'cn' ? '累计支持者' : 'Total Backers')} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Comments chart */}
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
                      {curveModes.comments === 'daily'
                        ? (lang === 'cn'
                          ? `每日新增 Comments · 平均 ${Math.round(avgCommentsDaily).toLocaleString()}`
                          : `Daily comment change · Avg ${Math.round(avgCommentsDaily).toLocaleString()}`)
                        : (lang === 'cn' ? '累计评论数' : 'Cumulative comments')}
                    </p>
                    <div className="rounded-lg bg-gray-100 p-1">
                      {(['daily', 'cumulative'] as const).map(mode => (
                        <button key={mode} onClick={() => setCurveMode('comments', mode)}
                          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${curveModes.comments === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                          {curveModeLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} width={45} />
                      <Tooltip formatter={(v: number) => [Number(v).toLocaleString(), curveModes.comments === 'daily' ? (lang === 'cn' ? '评论增量' : 'Comment Change') : (lang === 'cn' ? '累计评论' : 'Total Comments')]} />
                      {curveModes.comments === 'daily' && (
                        <ReferenceLine y={avgCommentsDaily} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: lang === 'cn' ? '平均' : 'Avg', fontSize: 10, fill: '#f59e0b' }} />
                      )}
                      <Line type="monotone" dataKey={curveModes.comments === 'daily' ? 'commentsDaily' : 'commentsTotal'} stroke="#f59e0b" strokeWidth={2} dot={false} name={curveModes.comments === 'daily' ? (lang === 'cn' ? '评论增量' : 'Comment Change') : (lang === 'cn' ? '累计评论' : 'Total Comments')} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Prediction deviation chart */}
                {deviationChartData.length > 1 && (
                  <div className="border-t border-gray-100 pt-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">{tr.predictionDeviation}</p>
                    </div>
                    {/* Actual cumulative vs. learned-pace expectation */}
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={deviationChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtMoney(v as number, 'USD')} width={65} />
                        <Tooltip formatter={(v: number, n) => [fmtMoney(v, 'USD'), n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="actual" stroke="#05CE78" strokeWidth={2} dot={false} name={tr.predictionActual} />
                        <Line type="monotone" dataKey="expected" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" dot={false} name={tr.predictionExpected} />
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Signed deviation curve (actual − expected) */}
                    <ResponsiveContainer width="100%" height={160}>
                      <AreaChart data={deviationChartData} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gDeviation" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtMoney(v as number, 'USD')} width={65} />
                        <Tooltip formatter={(v: number) => [fmtMoney(v, 'USD'), tr.predictionDeviationLabel]} />
                        <ReferenceLine y={0} stroke="#94a3b8" />
                        <Area type="monotone" dataKey="deviation" stroke="#6366f1" strokeWidth={2} fill="url(#gDeviation)" name={tr.predictionDeviationLabel} />
                      </AreaChart>
                    </ResponsiveContainer>
                    <p className="mt-2 text-[11px] text-gray-400">{tr.predictionHint}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
                <p className="text-gray-400 text-sm">
                  {hasRealData ? tr.notEnoughDataChart : tr.syncToSeeCurve}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── REWARDS ── */}
        {activeTab === 'rewards' && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-700">{tr.rewardTiersLabel}</h3>
            {rewards.length ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label={lang === 'cn' ? 'SKU 数量' : 'SKU Count'} value={rewards.length.toLocaleString()} sub={lang === 'cn' ? `${limitedRewardCount} 个限量档位` : `${limitedRewardCount} limited tiers`} />
                  <StatCard label={lang === 'cn' ? '档位支持者' : 'Reward Backers'} value={totalRewardBackers.toLocaleString()} sub={lang === 'cn' ? '来自奖励档位数据' : 'from reward tiers'} />
                  <StatCard label={lang === 'cn' ? '档位均价' : 'Avg Tier Price'} value={fmtMoney(rewards.reduce((sum, r) => sum + r.amount_usd, 0) / Math.max(1, rewards.length), nativeCurrency)} sub={lang === 'cn' ? '简单平均' : 'simple average'} />
                  <StatCard label={lang === 'cn' ? '估算档位金额' : 'Tier Value Est.'} value={fmtMoney(totalRewardValue, nativeCurrency)} sub={lang === 'cn' ? '价格 × backer' : 'price x backers'} />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-800">{lang === 'cn' ? '价格带分布' : 'Price Band Distribution'}</h4>
                    <div className="mt-4 space-y-3">
                      {rewardPriceBands.map(band => (
                        <div key={band.label}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-600">{band.label}</span>
                            <span className="text-gray-400">{band.skuCount} SKU · {band.backers.toLocaleString()} backers</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-ks-green" style={{ width: `${(band.backers / maxBandBackers) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-800">{lang === 'cn' ? 'Backer 集中度' : 'Backer Concentration'}</h4>
                    {topReward && (
                      <p className="mt-1 text-xs text-gray-400">
                        {lang === 'cn'
                          ? `最热档位：${topReward.title || 'Untitled'}，${topReward.backers_count.toLocaleString()} 位支持者。`
                          : `Top tier: ${topReward.title || 'Untitled'}, ${topReward.backers_count.toLocaleString()} backers.`}
                      </p>
                    )}
                    <div className="mt-4 space-y-3">
                      {[...rewards].sort((a, b) => b.backers_count - a.backers_count).slice(0, 5).map(r => (
                        <div key={`top-${r.reward_id}`}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                            <span className="truncate font-semibold text-gray-600">{r.title || fmtMoney(r.amount_usd, nativeCurrency)}</span>
                            <span className="shrink-0 text-gray-400">{r.backers_count.toLocaleString()}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${(r.backers_count / maxRewardBackers) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {rewards.map(r => {
                  const fillPct = r.limit_count ? Math.min(100, (r.backers_count / r.limit_count) * 100) : null;
                  return (
                    <div key={r.reward_id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg font-black text-ks-green">{fmtMoney(r.amount_usd, nativeCurrency)}</span>
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
                <p className="text-gray-400 text-sm">{tr.noRewardData}</p>
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
        {activeTab === 'collaborators' && (
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-gray-700">{lang === 'cn' ? '项目合作者' : 'Collaborators'}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {lang === 'cn'
                  ? '从 Kickstarter Creator 数据中识别到的合作方、服务商和参与者。'
                  : 'Collaborators, vendors, and partners detected from Kickstarter creator data.'}
              </p>
            </div>
            {collaborators.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {collaborators.map(c => (
                  <a
                    key={c.collaborator_key}
                    href={c.profile_url ?? undefined}
                    target={c.profile_url ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    className={`flex items-center gap-3 rounded-xl border p-4 shadow-sm transition-all hover:border-ks-green/30 hover:shadow-md ${
                      c.is_service_agency ? 'border-emerald-200 bg-emerald-50/70' : 'border-gray-100 bg-white'
                    }`}
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-sm font-black text-gray-400">
                      {c.avatar_url ? (
                        <img src={c.avatar_url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      ) : c.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="block truncate text-sm font-bold text-gray-900">{c.name}</span>
                        {c.is_service_agency ? (
                          <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                            {lang === 'cn' ? '服务商 Agency' : 'Agency'}
                          </span>
                        ) : null}
                      </span>
                      <span className="block truncate text-xs text-gray-400">
                        {c.is_service_agency ? (lang === 'cn' ? '本次项目众筹服务商' : 'Crowdfunding service provider') : (c.role || (lang === 'cn' ? '合作者' : 'Collaborator'))}
                      </span>
                    </span>
                    {c.profile_url && <ExternalLink className="ml-auto h-4 w-4 text-gray-300" />}
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm">
                <p className="text-sm text-gray-400">
                  {lang === 'cn'
                    ? '暂未抓取到合作者数据。若 Kickstarter 页面被服务器环境拦截，下一次成功同步后会自动补充。'
                    : 'No collaborator data has been captured yet. A successful Kickstarter sync will fill this when the page exposes it.'}
                </p>
              </div>
            )}
          </div>
        )}

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
                  const similarImage = s.image_thumb_url || s.image_url;
                  return (
                    <button key={s.id} onClick={() => window.open(`/projects/${s.id}`, '_blank', 'noopener,noreferrer')}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 text-left hover:shadow-md hover:border-ks-green/30 transition-all">
                      <div className="flex items-start gap-3">
                        {similarImage ? (
                          <ImagePreview src={similarImage} className="shrink-0">
                            <img src={similarImage} alt={s.name} className="h-16 w-24 rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />
                          </ImagePreview>
                        ) : (
                          <div className="h-16 w-24 shrink-0 rounded-lg bg-gray-100" />
                        )}
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

      {false && ktDebug && (
        <div className="fixed bottom-4 right-4 z-50 w-[min(620px,calc(100vw-2rem))] max-h-[78vh] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-gray-900">{lang === 'cn' ? 'Kicktraq 导入调试' : 'Kicktraq Import Debug'}</h3>
              <p className="text-[11px] text-gray-400">{lang === 'cn' ? '临时面板：图片、模型输出、结构化结果' : 'Temporary panel: images, model output, structured rows'}</p>
            </div>
            <button onClick={() => setKtDebug(null)} className="rounded-lg px-2 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-100">
              {lang === 'cn' ? '关闭' : 'Close'}
            </button>
          </div>
          <div className="max-h-[68vh] space-y-4 overflow-y-auto p-4">
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {lang === 'cn' ? '1. 原始图片数据' : '1. Raw Image Data'}
              </h4>
              {ktDebug?.images?.length ? (
                <div className="space-y-3">
                  {ktDebug?.images?.map((img, i) => (
                    <div key={`${img.kind}-${i}`} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-gray-500">
                        <span className="font-semibold text-gray-800">{img.kind}</span>
                        <span>{img.status}</span>
                        <span>{img.contentType}</span>
                        <span>{img.bytes.toLocaleString()} bytes</span>
                      </div>
                      <img src={img.dataUrl} alt={`${img.kind} chart`} className="max-h-56 w-full rounded border border-gray-200 bg-white object-contain" />
                      <p className="mt-2 break-all text-[10px] text-gray-400">{img.url}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">{lang === 'cn' ? '没有捕获到图片。' : 'No images captured.'}</p>
              )}
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {lang === 'cn' ? '2. 模型原始输出' : '2. Model Raw Output'}
              </h4>
              <pre className="max-h-56 overflow-auto rounded-lg bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-100 whitespace-pre-wrap">
                {ktDebug?.modelOutput || (lang === 'cn' ? '没有捕获到模型输出。' : 'No model output captured.')}
              </pre>
            </section>

            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                {lang === 'cn' ? '3. 结构化数据' : '3. Structured Rows'}
              </h4>
              <pre className="max-h-56 overflow-auto rounded-lg bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-950">
                {JSON.stringify(ktDebug?.structuredRows ?? [], null, 2)}
              </pre>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
