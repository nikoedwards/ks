'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Users, Target, TrendingUp, Calendar, Award, Heart } from 'lucide-react';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';

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

function fmtDate(ts: number | null, lang: string) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString(lang === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function calcDuration(p: Project): number | null {
  if (!p.launched_at || !p.deadline) return null;
  return Math.round((p.deadline - p.launched_at) / 86400);
}

function buildFundingCurve(p: Project): { day: number; pct: number; pledged: number }[] {
  const duration = calcDuration(p);
  if (!duration || duration <= 0) return [];
  const points = Math.min(duration, 60);
  const finalRate = p.goal > 0 ? (p.usd_pledged / p.goal) * 100 : 0;
  const curve: { day: number; pct: number; pledged: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const tFrac = i / points;
    const sigmoid = 1 / (1 + Math.exp(-8 * (tFrac - 0.5)));
    const blended = 0.4 * (tFrac < 0.1 ? tFrac * 3 : 0.3 + (tFrac - 0.1) * (0.7 / 0.9)) + 0.6 * sigmoid;
    const cappedV = Math.min(1, Math.max(0, blended));
    curve.push({
      day: Math.round(tFrac * duration),
      pct: Math.round(cappedV * finalRate * 10) / 10,
      pledged: Math.round(cappedV * p.usd_pledged),
    });
  }
  return curve;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [lang] = useLanguage();
  const tr = t[lang].projectDetail;
  const stateTr = t[lang].states;
  const { user, showLogin } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/projects/${params.id}`)
      .then(r => { if (r.status === 404) { setNotFound(true); setLoading(false); return null; } return r.json(); })
      .then(d => { if (d) setProject(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [params?.id]);

  useEffect(() => {
    if (!user || !params?.id) return;
    fetch('/api/favorites').then(r => r.json()).then(d => {
      setIsFavorited(((d.ids ?? []) as string[]).includes(params.id));
    }).catch(() => {});
  }, [user, params?.id]);

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
  const curve = buildFundingCurve(project);
  const ksUrl = project.source_url?.startsWith('https://www.kickstarter.com/projects/')
    ? project.source_url : null;
  const kicktraqUrl = project.slug ? `https://www.kicktraq.com/projects/${project.slug}/` : null;
  const barMax = curve.length > 0 ? Math.max(...curve.map(c => c.pct)) : 100;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <button onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        {tr.back}
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATE_COLOR[project.state] ?? 'bg-gray-100 text-gray-600'}`}>
                {stateTr[project.state as keyof typeof stateTr] ?? project.state}
              </span>
              {project.staff_pick === 1 && (
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-50 text-yellow-600 border border-yellow-100">
                  <Award className="w-3 h-3" /> {tr.staffPick}
                </span>
              )}
              <span className="text-xs text-gray-400">{project.category_parent} · {project.category_name}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 leading-snug">{project.name}</h1>
            {project.blurb && <p className="text-gray-500 mt-2 text-sm leading-relaxed">{project.blurb}</p>}
            <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
              {project.creator_name && (
                <span>
                  {lang === 'cn'
                    ? tr.createdBy(project.creator_name)
                    : <><span className="text-gray-600 font-medium">{project.creator_name}</span> {tr.createdBy('')}</>}
                </span>
              )}
              <span>{project.country_name || project.country}</span>
              <span>{project.currency}</span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0 items-start">
            {/* Favorite button */}
            <button
              onClick={toggleFavorite}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isFavorited
                  ? 'bg-red-50 text-red-500 border-red-100 hover:bg-red-100'
                  : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-red-50 hover:text-red-500 hover:border-red-100'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${isFavorited ? 'fill-current' : ''}`} />
              {isFavorited
                ? (lang === 'cn' ? '已收藏' : 'Saved')
                : (lang === 'cn' ? '收藏' : 'Save')}
            </button>
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
              <span className="text-gray-400 text-sm ml-2">{tr.fundingOf(fmtUsd(project.goal))}</span>
            </div>
            <span className={`text-2xl font-black ${fundingRate >= 100 ? 'text-ks-green' : 'text-gray-500'}`}>
              {fundingRate >= 10000 ? '>10,000' : fundingRate.toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div className="h-3 rounded-full bg-ks-green transition-all" style={{ width: `${Math.min(100, fundingRate)}%` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
            <span>{tr.goalLabel(fmtUsd(project.goal))}</span>
            <span>{fundingRate >= 100 ? tr.exceeded : tr.belowGoal}</span>
          </div>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: tr.backers, value: tr.backersUnit(project.backers_count.toLocaleString()) },
          { icon: Target, label: tr.goal, value: fmtUsd(project.goal) },
          { icon: Calendar, label: tr.duration, value: duration ? tr.daysUnit(duration) : '—' },
          { icon: TrendingUp, label: tr.dailyAvg, value: avgDailyPledged ? fmtUsd(avgDailyPledged) : '—' },
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
        <h3 className="font-semibold text-gray-700 mb-4">{tr.timeline}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { label: tr.timelineCreated, date: fmtDate(project.created_at, lang) },
            { label: tr.timelineLaunched, date: fmtDate(project.launched_at, lang) },
            { label: tr.timelineDeadline, date: fmtDate(project.deadline, lang) },
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
          <h3 className="font-semibold text-gray-700 mb-1">{tr.curveName}</h3>
          <p className="text-xs text-gray-400 mb-4">{tr.curveNote}</p>
          <div className="flex items-end gap-0.5 h-40 overflow-hidden">
            {curve.map((c, i) => (
              <div key={i} className="flex-1 min-w-0 rounded-t-sm transition-all"
                style={{ height: `${barMax > 0 ? (c.pct / barMax) * 100 : 0}%`, backgroundColor: c.pct >= 100 ? '#05CE78' : '#d1fae5', minHeight: '2px' }}
                title={`${lang === 'cn' ? '第' : 'Day'} ${c.day}: ${c.pct.toFixed(1)}% · ${fmtUsd(c.pledged)}`}
              />
            ))}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{tr.dayFirst}</span>
            <span>{tr.dayMid(Math.round((duration ?? 0) / 2))}</span>
            <span>{tr.dayLast(duration ?? 0)}</span>
          </div>
          <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-ks-green" /> {tr.legendMet}</span>
            <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-100" /> {tr.legendBelow}</span>
          </div>
        </div>
      )}

      {/* Note */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
        <p className="text-xs text-amber-700 leading-relaxed">
          <span className="font-semibold">{tr.dataTitle}</span>
          {tr.dataBody}{' '}
          {kicktraqUrl ? (
            <a href={kicktraqUrl} target="_blank" rel="noopener noreferrer" className="underline font-medium">Kicktraq</a>
          ) : 'Kicktraq'}
          {tr.dataBody2}
        </p>
      </div>

      <DataSource />
    </div>
  );
}
