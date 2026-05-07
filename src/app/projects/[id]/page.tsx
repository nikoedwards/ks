'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Users, Target, TrendingUp, Calendar, Award } from 'lucide-react';
import DataSource from '@/components/DataSource';

interface Project {
  id: string;
  name: string;
  blurb: string;
  state: string;
  country: string;
  country_name: string;
  currency: string;
  category_parent: string;
  category_name: string;
  category_id: number;
  goal: number;
  pledged: number;
  usd_pledged: number;
  backers_count: number;
  staff_pick: number;
  created_at: number;
  launched_at: number;
  deadline: number;
  creator_name: string;
  source_url: string;
  slug: string;
}

const STATE_LABEL: Record<string, string> = {
  successful: '成功', failed: '失败', live: '进行中', canceled: '已取消', suspended: '已暂停',
};

const STATE_COLOR: Record<string, string> = {
  successful: 'bg-ks-green-light text-ks-green-dark border border-ks-green/20',
  failed: 'bg-red-50 text-red-600 border border-red-100',
  live: 'bg-blue-50 text-blue-600 border border-blue-100',
  canceled: 'bg-amber-50 text-amber-600 border border-amber-100',
  suspended: 'bg-purple-50 text-purple-600 border border-purple-100',
};

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString()}`;
}

function fmtDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function calcDuration(p: Project): number | null {
  if (!p.launched_at || !p.deadline) return null;
  return Math.round((p.deadline - p.launched_at) / 86400);
}

// Simulate a funding curve using an S-curve approximation based on total funding
function buildFundingCurve(p: Project): { day: number; pct: number; pledged: number }[] {
  const duration = calcDuration(p);
  if (!duration || duration <= 0) return [];

  const points = Math.min(duration, 60);
  const finalRate = p.goal > 0 ? (p.usd_pledged / p.goal) * 100 : 0;

  // Kickstarter campaigns typically see ~30% of funding in first 3 days and last 3 days
  // Use a blend: fast start, slow middle, fast end
  const curve: { day: number; pct: number; pledged: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points; // 0..1
    // Logistics-like: fast start + fast end
    let v: number;
    if (t < 0.1) {
      v = t * 3.5; // fast start
    } else if (t > 0.85) {
      const tail = (t - 0.85) / 0.15;
      v = 0.35 + tail * 0.65;
    } else {
      const mid = (t - 0.1) / 0.75;
      v = 0.35 + mid * 0.0;
    }
    // clamp, then scale by actual funding rate
    v = Math.min(1, Math.max(0, 0.35 + (t - 0.1) * (0.3 / 0.75) + (t > 0.85 ? (t - 0.85) / 0.15 * 0.65 : 0)));
    // simpler approach: sigmoid
    const sigmoid = 1 / (1 + Math.exp(-8 * (t - 0.5)));
    // blend: 40% start-biased, 60% sigmoid
    const blended = 0.4 * (t < 0.1 ? t * 3 : 0.3 + (t - 0.1) * (0.7 / 0.9)) + 0.6 * sigmoid;
    const cappedV = Math.min(1, Math.max(0, blended));
    curve.push({
      day: Math.round(t * duration),
      pct: Math.round(cappedV * finalRate * 10) / 10,
      pledged: Math.round(cappedV * p.usd_pledged),
    });
  }
  return curve;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/projects/${params.id}`)
      .then(r => { if (r.status === 404) { setNotFound(true); setLoading(false); return null; } return r.json(); })
      .then(d => { if (d) setProject(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params?.id]);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>;
  if (notFound) return (
    <div className="max-w-2xl mx-auto mt-20 text-center space-y-4">
      <p className="text-gray-400 text-lg">项目未找到</p>
      <button onClick={() => router.back()} className="text-ks-green text-sm hover:underline">返回列表</button>
    </div>
  );
  if (!project) return null;

  const fundingRate = project.goal > 0 ? (project.usd_pledged / project.goal) * 100 : 0;
  const duration = calcDuration(project);
  const avgDailyPledged = duration && duration > 0 ? project.usd_pledged / duration : null;
  const curve = buildFundingCurve(project);
  const ksUrl = project.source_url?.startsWith('https://www.kickstarter.com/projects/')
    ? project.source_url
    : null;
  const kicktraqUrl = project.slug
    ? `https://www.kicktraq.com/projects/${project.slug}/`
    : null;

  const barMax = curve.length > 0 ? Math.max(...curve.map(c => c.pct)) : 100;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回项目列表
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATE_COLOR[project.state] ?? 'bg-gray-100 text-gray-600'}`}>
                {STATE_LABEL[project.state] ?? project.state}
              </span>
              {project.staff_pick === 1 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-50 text-yellow-600 border border-yellow-100">
                  <Award className="w-3 h-3" /> Kickstarter 精选
                </span>
              )}
              <span className="text-xs text-gray-400">{project.category_parent} · {project.category_name}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 leading-snug">{project.name}</h1>
            {project.blurb && <p className="text-gray-500 mt-2 text-sm leading-relaxed">{project.blurb}</p>}
            <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
              {project.creator_name && <span>由 <span className="text-gray-600 font-medium">{project.creator_name}</span> 发起</span>}
              <span>{project.country_name || project.country}</span>
              <span>{project.currency}</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {ksUrl && (
              <a href={ksUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ks-green text-white text-xs font-semibold hover:bg-ks-green-dark transition-colors">
                <ExternalLink className="w-3.5 h-3.5" />
                Kickstarter
              </a>
            )}
            {kicktraqUrl && (
              <a href={kicktraqUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-xs font-semibold hover:bg-gray-200 transition-colors">
                <TrendingUp className="w-3.5 h-3.5" />
                Kicktraq
              </a>
            )}
          </div>
        </div>

        {/* Funding progress */}
        <div className="mt-6">
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="text-3xl font-black text-gray-900">{fmtUsd(project.usd_pledged)}</span>
              <span className="text-gray-400 text-sm ml-2">of {fmtUsd(project.goal)} goal</span>
            </div>
            <span className={`text-2xl font-black ${fundingRate >= 100 ? 'text-ks-green' : 'text-gray-500'}`}>
              {fundingRate >= 10000 ? '>10,000' : fundingRate.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className="h-3 rounded-full bg-ks-green transition-all"
              style={{ width: `${Math.min(100, fundingRate)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>目标: {fmtUsd(project.goal)}</span>
            <span>{fundingRate >= 100 ? '已超额完成' : '未达标'}</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: '支持人数', value: project.backers_count.toLocaleString() + ' 人' },
          { icon: Target, label: '众筹目标', value: fmtUsd(project.goal) },
          { icon: Calendar, label: '活动时长', value: duration ? `${duration} 天` : '—' },
          { icon: TrendingUp, label: '日均众筹', value: avgDailyPledged ? fmtUsd(avgDailyPledged) : '—' },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 bg-ks-green-light rounded-lg flex items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-ks-green" />
              </div>
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
            </div>
            <p className="text-lg font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h3 className="font-semibold text-gray-700 mb-4">活动时间线</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: '创建时间', date: fmtDate(project.created_at) },
            { label: '发起时间', date: fmtDate(project.launched_at) },
            { label: '截止时间', date: fmtDate(project.deadline) },
          ].map(({ label, date }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</span>
              <span className="text-sm font-medium text-gray-800">{date}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Simulated funding curve */}
      {curve.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-700">众筹进度曲线（模拟）</h3>
          </div>
          <p className="text-xs text-gray-400 mb-4">
            基于 Kickstarter 典型众筹节奏（快速起步 → 平稳推进 → 末期冲刺）的模拟估算，非真实逐日数据。
          </p>
          <div className="flex items-end gap-0.5 h-40 overflow-hidden">
            {curve.map((c, i) => (
              <div
                key={i}
                className="flex-1 min-w-0 rounded-t-sm transition-all"
                style={{
                  height: `${barMax > 0 ? (c.pct / barMax) * 100 : 0}%`,
                  backgroundColor: c.pct >= 100 ? '#05CE78' : '#d1fae5',
                  minHeight: '2px',
                }}
                title={`Day ${c.day}: ${c.pct.toFixed(1)}% · ${fmtUsd(c.pledged)}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>发起第 1 天</span>
            <span>第 {Math.round((duration ?? 0) / 2)} 天</span>
            <span>第 {duration ?? '?'} 天</span>
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-ks-green" /> 达成目标 ≥ 100%</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" /> 低于目标</span>
          </div>
        </div>
      )}

      {/* Note about real data */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <p className="text-xs text-amber-700 leading-relaxed">
          <span className="font-semibold">关于项目数据：</span>
          当前数据来源为 webrobots.io 提供的 Kickstarter 静态快照，仅包含项目最终状态，不含逐日众筹金额。
          如需查看真实逐日趋势，请访问{' '}
          {kicktraqUrl ? (
            <a href={kicktraqUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">Kicktraq</a>
          ) : 'Kicktraq'}。
          Kicksonar 将在后续版本中支持逐日数据采集。
        </p>
      </div>

      <DataSource />
    </div>
  );
}
