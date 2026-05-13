'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Calendar, DollarSign, Filter, Medal, Users } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface LeaderboardProject {
  id: string;
  name: string;
  blurb: string | null;
  state: string;
  category_parent: string | null;
  category_name: string | null;
  country: string | null;
  launched_at: number | null;
  image_url: string | null;
  image_thumb_url: string | null;
  pledged_usd: number;
  backers_count: number;
  goal: number;
  funded_pct: number;
}

interface CategoryOption {
  category_parent: string;
  category_name: string | null;
  total: number;
}

interface LeaderboardData {
  byPledged: LeaderboardProject[];
  byBackers: LeaderboardProject[];
  categories: CategoryOption[];
  summary: {
    total_projects: number;
    total_pledged_usd: number;
    total_backers: number;
    avg_funded_pct: number;
  };
}

function fmtUsd(value: number) {
  const v = Number(value ?? 0);
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtNum(value: number) {
  return Number(value ?? 0).toLocaleString();
}

function yearStart(yearsAgo = 3) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function toTs(date: string, end = false) {
  if (!date) return undefined;
  const d = new Date(`${date}T${end ? '23:59:59' : '00:00:00'}`);
  return Math.floor(d.getTime() / 1000);
}

function Thumb({ project }: { project: LeaderboardProject }) {
  const src = project.image_thumb_url ?? project.image_url;
  if (src) return <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />;
  return <div className="h-full w-full bg-gray-100" />;
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'bg-amber-400 text-white' : rank === 2 ? 'bg-slate-300 text-white' : rank === 3 ? 'bg-orange-400 text-white' : 'bg-gray-100 text-gray-500';
  return <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-black ${cls}`}>{rank}</span>;
}

function RankingList({ title, icon, projects, metric, cn }: {
  title: string;
  icon: React.ReactNode;
  projects: LeaderboardProject[];
  metric: 'pledged' | 'backers';
  cn: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-bold text-gray-900">{title}</h2>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
        {projects.map((project, index) => (
          <Link key={project.id} href={`/projects/${project.id}`}
            className={`group flex items-center gap-4 border-b border-gray-50 p-3 transition-colors hover:bg-gray-50 ${index < 3 ? 'bg-amber-50/30' : ''}`}>
            <RankBadge rank={index + 1} />
            <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-gray-100">
              <Thumb project={project} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <h3 className="line-clamp-2 text-sm font-semibold text-gray-900 group-hover:text-ks-green">{project.name}</h3>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-ks-green" />
              </div>
              <p className="mt-1 truncate text-xs text-gray-400">
                {project.category_parent ?? 'Uncategorized'} / {project.category_name ?? '-'} / {project.country ?? '--'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-md bg-ks-green-light px-2 py-1 font-bold text-ks-green-dark">{fmtUsd(project.pledged_usd)}</span>
                <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-600">{fmtNum(project.backers_count)} {cn ? '支持者' : 'backers'}</span>
                <span className="text-gray-400">{Number(project.funded_pct ?? 0).toFixed(0)}% {cn ? '完成' : 'funded'}</span>
              </div>
            </div>
            <div className="w-28 shrink-0 text-right">
              <p className="text-lg font-black tabular-nums text-gray-900">
                {metric === 'pledged' ? fmtUsd(project.pledged_usd) : fmtNum(project.backers_count)}
              </p>
              <p className="text-[11px] text-gray-400">{metric === 'pledged' ? (cn ? '总金额' : 'pledged') : (cn ? '支持者' : 'backers')}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function LeaderboardPage() {
  const [lang] = useLanguage();
  const cn = lang === 'cn';
  const [dateFrom, setDateFrom] = useState(yearStart(3));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [categoryParent, setCategoryParent] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const parentOptions = useMemo(() => {
    const parents = new Map<string, number>();
    for (const c of data?.categories ?? []) parents.set(c.category_parent, (parents.get(c.category_parent) ?? 0) + c.total);
    return [...parents.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const childOptions = useMemo(() => {
    return (data?.categories ?? []).filter(c => !categoryParent || c.category_parent === categoryParent);
  }, [data, categoryParent]);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: '25',
      ...(toTs(dateFrom) ? { dateFrom: String(toTs(dateFrom)) } : {}),
      ...(toTs(dateTo, true) ? { dateTo: String(toTs(dateTo, true)) } : {}),
      ...(categoryParent ? { categoryParent } : {}),
      ...(categoryName ? { categoryName } : {}),
    });
    const res = await fetch(`/api/leaderboard?${params.toString()}`, { cache: 'no-store' });
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCategoryName(''); }, [categoryParent]);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? '排行榜' : 'Leaderboard'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {cn ? '按统一美元金额和支持者数量查看 Kickstarter 项目排名。' : 'Rank Kickstarter projects by normalized USD pledged and backer count.'}
          </p>
        </div>
        <button onClick={load} className="rounded-lg bg-ks-green px-4 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark">
          {cn ? '应用筛选' : 'Apply Filters'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-gray-100 bg-white p-4 shadow-sm lg:grid-cols-4">
        <label className="space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '开始日期' : 'From'}</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '结束日期' : 'To'}</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '大类' : 'Parent Category'}</span>
          <select value={categoryParent} onChange={e => setCategoryParent(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">{cn ? '全部大类' : 'All parent categories'}</option>
            {parentOptions.map(([parent, total]) => <option key={parent} value={parent}>{parent} ({total})</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '二级类目' : 'Subcategory'}</span>
          <select value={categoryName} onChange={e => setCategoryName(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="">{cn ? '全部二级类目' : 'All subcategories'}</option>
            {childOptions.map(c => <option key={`${c.category_parent}-${c.category_name}`} value={c.category_name ?? ''}>{c.category_name ?? '-'} ({c.total})</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-400">{cn ? '项目数' : 'Projects'}</p>
          <p className="mt-2 text-2xl font-black text-gray-900">{fmtNum(data?.summary?.total_projects ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-400">{cn ? '总筹资额' : 'Total pledged'}</p>
          <p className="mt-2 text-2xl font-black text-ks-green">{fmtUsd(data?.summary?.total_pledged_usd ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-gray-400">{cn ? '总支持者' : 'Total backers'}</p>
          <p className="mt-2 text-2xl font-black text-blue-600">{fmtNum(data?.summary?.total_backers ?? 0)}</p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-gray-100 bg-white p-12 text-center text-gray-400">{cn ? '加载中...' : 'Loading...'}</div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <RankingList cn={cn} title={cn ? '众筹总金额榜' : 'Top Pledged'} icon={<DollarSign className="h-5 w-5 text-ks-green" />} projects={data?.byPledged ?? []} metric="pledged" />
          <RankingList cn={cn} title={cn ? '支持者数量榜' : 'Top Backers'} icon={<Users className="h-5 w-5 text-blue-600" />} projects={data?.byBackers ?? []} metric="backers" />
        </div>
      )}

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <div className="flex items-center gap-2 font-semibold"><Medal className="h-4 w-4" />{cn ? '统计说明' : 'Ranking note'}</div>
        <p className="mt-1 text-xs leading-relaxed">
          {cn
            ? '榜单使用 usd_pledged 与实时快照中的有效金额，统一按美元排序；Kicktraq 的非美元原币快照不会参与美元榜单排序。'
            : 'Rankings use usd_pledged plus valid live snapshots normalized to USD. Non-USD Kicktraq raw snapshots are excluded from USD ranking.'}
        </p>
      </div>
    </div>
  );
}
