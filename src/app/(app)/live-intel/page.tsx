'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowUpRight, Clock3, Filter, Flame, Gauge, RefreshCw, Rocket, TrendingUp, Users, type LucideIcon } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import ImagePreview from '@/components/ImagePreview';

interface LiveProject {
  id: string;
  name: string;
  blurb: string | null;
  goal: number;
  country: string | null;
  currency: string | null;
  category_parent: string | null;
  category_name: string | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string | null;
  image_url: string | null;
  image_thumb_url: string | null;
  pledged_usd: number;
  live_backers_count: number;
  latest_snapshot_at: number | null;
  pledged_delta_24h: number;
  backers_delta_24h: number;
  pledged_delta_6h: number;
  backers_delta_6h: number;
  funded_pct: number;
  projected_usd: number;
}

interface CategoryIntel {
  category: string;
  live_projects: number;
  pledged_delta_24h: number;
  backers_delta_24h: number;
  avg_funded_pct: number;
  overfunded_projects: number;
}

interface LiveIntel {
  generatedAt: number;
  summary: {
    live_projects: number;
    pledged_delta_24h: number;
    backers_delta_24h: number;
    launched_24h: number;
    ending_24h: number;
    overfunded_projects: number;
  };
  fastestFunding: LiveProject[];
  fastestBackers: LiveProject[];
  newlyLaunched: LiveProject[];
  endingSoon: LiveProject[];
  overfunded: LiveProject[];
  categories: CategoryIntel[];
  allCategories?: { category: string }[];
}

function fmtUsd(value: number | null | undefined) {
  const v = Number(value ?? 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtNum(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString();
}

function fmtAge(ts: number | null | undefined, cn: boolean) {
  if (!ts) return cn ? '暂无' : 'None';
  const hours = Math.max(0, Math.round((Date.now() / 1000 - ts) / 3600));
  if (hours < 1) return cn ? '刚刚' : 'Just now';
  if (hours < 24) return cn ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return cn ? `${days} 天前` : `${days}d ago`;
}

function daysLeft(deadline: number | null | undefined, cn: boolean) {
  if (!deadline) return cn ? '未知' : 'Unknown';
  const days = Math.ceil((deadline - Date.now() / 1000) / 86400);
  if (days <= 0) return cn ? '今天结束' : 'Ends today';
  return cn ? `${days} 天` : `${days}d`;
}

function Stat({ icon: Icon, label, value, hint, tone }: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tone}`}>
          <Icon className="w-4 h-4" />
        </div>
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      </div>
      <p className="text-sm font-semibold text-gray-800 mt-3">{label}</p>
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );
}

function Thumb({ project }: { project: LiveProject }) {
  const src = project.image_thumb_url ?? project.image_url;
  if (src) {
    return (
      <ImagePreview src={src} className="block h-full w-full">
        <img
          src={src}
          alt=""
          className="w-full h-full object-cover bg-gray-100"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      </ImagePreview>
    );
  }
  return (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <Rocket className="w-6 h-6 text-gray-300" />
    </div>
  );
}

function ProjectCard({ project, rank, metric, subMetric, accent = 'green' }: {
  project: LiveProject;
  rank: number;
  metric: string;
  subMetric: string;
  accent?: 'green' | 'blue' | 'amber' | 'red';
}) {
  const accentCls = {
    green: 'text-ks-green bg-ks-green-light',
    blue: 'text-blue-600 bg-blue-50',
    amber: 'text-amber-700 bg-amber-50',
    red: 'text-red-600 bg-red-50',
  }[accent];

  return (
    <Link href={`/projects/${project.id}`} className="group block bg-white border border-gray-100 rounded-lg overflow-hidden hover:border-gray-200 hover:shadow-sm transition-all">
      <div className="flex gap-3 p-3">
        <div className="relative w-24 h-16 rounded-md overflow-hidden shrink-0">
          <Thumb project={project} />
          <span className="absolute left-1.5 top-1.5 h-5 min-w-5 px-1 rounded-full bg-black/65 text-white text-[11px] font-bold flex items-center justify-center">
            {rank}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-gray-900 leading-snug line-clamp-2 group-hover:text-ks-green transition-colors">
              {project.name}
            </h3>
            <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-ks-green shrink-0" />
          </div>
          <p className="text-xs text-gray-400 mt-1 truncate">{project.category_parent ?? 'Uncategorized'} · {project.country ?? '--'}</p>
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className={`px-2 py-1 rounded-md text-xs font-bold tabular-nums ${accentCls}`}>{metric}</span>
            <span className="text-xs text-gray-500 tabular-nums">{subMetric}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-gray-500" />
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function LiveIntelPage() {
  const [lang] = useLanguage();
  const cn = lang === 'cn';
  const [data, setData] = useState<LiveIntel | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryParent, setCategoryParent] = useState('');
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: '12',
        ...(categoryParent ? { categoryParent } : {}),
      });
      const res = await fetch(`/api/live-intel?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json() as LiveIntel;
      setData(json);
      const options = (json.allCategories?.length ? json.allCategories.map(c => c.category) : json.categories.map(c => c.category)).filter(Boolean);
      setCategoryOptions(prev => {
        const next = new Set(prev);
        for (const option of options) next.add(option);
        if (categoryParent) next.add(categoryParent);
        return [...next].sort((a, b) => a.localeCompare(b));
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [categoryParent]);

  const featured = useMemo(() => {
    const seen = new Set<string>();
    const rows = [...(data?.fastestFunding ?? []), ...(data?.fastestBackers ?? []), ...(data?.overfunded ?? [])];
    return rows.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    }).sort((a, b) => Number(!!(b.image_thumb_url ?? b.image_url)) - Number(!!(a.image_thumb_url ?? a.image_url))).slice(0, 4);
  }, [data]);

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto flex items-center gap-2 text-gray-500">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>{cn ? '正在生成实时情报...' : 'Building live intelligence...'}</span>
      </div>
    );
  }

  const maxCategoryDelta = Math.max(1, ...data.categories.map(c => Number(c.pledged_delta_24h ?? 0)));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? 'Live 情报' : 'Live Intel'}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {cn ? '实时发现正在起量、刚上线、即将结束和类目升温的 Kickstarter 项目。' : 'Spot Kickstarter projects that are rising, launching, ending, and heating up by category.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={categoryParent}
              onChange={(e) => setCategoryParent(e.target.value)}
              className="bg-transparent text-sm font-semibold outline-none"
            >
              <option value="">{cn ? '全部类目' : 'All categories'}</option>
              {categoryOptions.map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </label>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {cn ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
        <Stat icon={Activity} label={cn ? 'Live 项目' : 'Live projects'} value={fmtNum(data.summary.live_projects)} hint={cn ? '当前监控池' : 'Current monitor pool'} tone="bg-blue-50 text-blue-600" />
        <Stat icon={TrendingUp} label={cn ? '24h 增长' : '24h pledged'} value={fmtUsd(data.summary.pledged_delta_24h)} hint={cn ? '快照增量' : 'Snapshot delta'} tone="bg-ks-green-light text-ks-green" />
        <Stat icon={Users} label={cn ? '24h 支持者' : '24h backers'} value={`+${fmtNum(data.summary.backers_delta_24h)}`} hint={cn ? '支持者增量' : 'Backer delta'} tone="bg-purple-50 text-purple-600" />
        <Stat icon={Rocket} label={cn ? '24h 新上线' : 'New launches'} value={fmtNum(data.summary.launched_24h)} hint={cn ? '最近一天' : 'Last 24h'} tone="bg-gray-50 text-gray-700" />
        <Stat icon={Clock3} label={cn ? '24h 内结束' : 'Ending soon'} value={fmtNum(data.summary.ending_24h)} hint={cn ? '收官项目' : 'Next 24h'} tone="bg-amber-50 text-amber-700" />
        <Stat icon={Gauge} label={cn ? '已超募' : 'Overfunded'} value={fmtNum(data.summary.overfunded_projects)} hint={cn ? '完成率 >= 100%' : 'Funded >= 100%'} tone="bg-red-50 text-red-600" />
      </div>

      {!!featured.length && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-500" />
            <h2 className="font-semibold text-gray-900">{cn ? '重点项目' : 'Featured Movers'}</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {featured.map((project, i) => (
              <Link key={project.id} href={`/projects/${project.id}`} className="group bg-white border border-gray-100 rounded-lg overflow-hidden hover:shadow-sm transition-all">
                <div className="aspect-[16/9] bg-gray-100 overflow-hidden">
                  <Thumb project={project} />
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ks-green">#{i + 1}</span>
                    <span className="text-xs text-gray-400">{daysLeft(project.deadline, cn)}</span>
                  </div>
                  <h3 className="font-semibold text-gray-900 mt-2 line-clamp-2 group-hover:text-ks-green">{project.name}</h3>
                  <p className="text-xs text-gray-400 mt-1 truncate">{project.category_parent ?? 'Uncategorized'}</p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="bg-gray-50 rounded-md p-2">
                      <p className="text-[11px] text-gray-400">{cn ? '24h 金额' : '24h pledged'}</p>
                      <p className="font-bold text-gray-900">{fmtUsd(project.pledged_delta_24h)}</p>
                    </div>
                    <div className="bg-gray-50 rounded-md p-2">
                      <p className="text-[11px] text-gray-400">{cn ? '完成率' : 'Funded'}</p>
                      <p className="font-bold text-gray-900">{Number(project.funded_pct ?? 0).toFixed(0)}%</p>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title={cn ? '24h 筹资增长最快' : 'Fastest Funding Growth'} icon={TrendingUp}>
          <div className="grid gap-3">
            {data.fastestFunding.map((p, i) => (
              <ProjectCard key={p.id} project={p} rank={i + 1} metric={`+${fmtUsd(p.pledged_delta_24h)}`} subMetric={`${Number(p.funded_pct ?? 0).toFixed(0)}% ${cn ? '完成' : 'funded'}`} />
            ))}
          </div>
        </Section>

        <Section title={cn ? '24h 支持者增长最快' : 'Fastest Backer Growth'} icon={Users}>
          <div className="grid gap-3">
            {data.fastestBackers.map((p, i) => (
              <ProjectCard key={p.id} project={p} rank={i + 1} metric={`+${fmtNum(p.backers_delta_24h)}`} subMetric={`${fmtNum(p.live_backers_count)} ${cn ? '支持者' : 'backers'}`} accent="blue" />
            ))}
          </div>
        </Section>

        <Section title={cn ? '最新上线' : 'Newest Launches'} icon={Rocket}>
          <div className="grid gap-3">
            {data.newlyLaunched.map((p, i) => (
              <ProjectCard key={p.id} project={p} rank={i + 1} metric={fmtAge(p.launched_at, cn)} subMetric={fmtUsd(p.pledged_usd)} accent="amber" />
            ))}
          </div>
        </Section>

        <Section title={cn ? '即将结束' : 'Ending Soon'} icon={Clock3}>
          <div className="grid gap-3">
            {data.endingSoon.map((p, i) => (
              <ProjectCard key={p.id} project={p} rank={i + 1} metric={daysLeft(p.deadline, cn)} subMetric={`${Number(p.funded_pct ?? 0).toFixed(0)}% ${cn ? '完成' : 'funded'}`} accent={p.funded_pct >= 100 ? 'green' : 'red'} />
            ))}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Section title={cn ? '超募榜' : 'Overfunded Leaders'} icon={Gauge}>
          <div className="grid gap-3">
            {data.overfunded.slice(0, 8).map((p, i) => (
              <ProjectCard key={p.id} project={p} rank={i + 1} metric={`${Number(p.funded_pct ?? 0).toFixed(0)}%`} subMetric={fmtUsd(p.pledged_usd)} accent="green" />
            ))}
          </div>
        </Section>

        <section className="xl:col-span-2 bg-white border border-gray-100 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <Flame className="w-4 h-4 text-amber-500" />
            <h2 className="font-semibold text-gray-900">{cn ? '类目实时热度' : 'Category Heat'}</h2>
          </div>
          <div className="space-y-4">
            {data.categories.map(category => {
              const width = Math.max(4, Math.round((Number(category.pledged_delta_24h ?? 0) / maxCategoryDelta) * 100));
              return (
                <div key={category.category}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{category.category}</p>
                      <p className="text-xs text-gray-400">
                        {fmtNum(category.live_projects)} {cn ? '个 live 项目' : 'live projects'} · {fmtNum(category.overfunded_projects)} {cn ? '个超募' : 'overfunded'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900">{fmtUsd(category.pledged_delta_24h)}</p>
                      <p className="text-xs text-gray-400">+{fmtNum(category.backers_delta_24h)} {cn ? '支持者' : 'backers'}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-ks-green rounded-full" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
