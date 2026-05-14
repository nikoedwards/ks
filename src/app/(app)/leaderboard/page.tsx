'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  DollarSign,
  Filter,
  Image as ImageIcon,
  Share2,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import ImagePreview from '@/components/ImagePreview';

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

interface LeaderboardCreator {
  creator_key: string;
  creator_name: string;
  creator_slug: string | null;
  project_count: number;
  total_pledged_usd: number;
  avg_pledged_usd: number;
  total_backers: number;
  best_project_id: string | null;
  best_project_name: string | null;
  best_project_image_url: string | null;
  best_project_thumb_url: string | null;
  category_parent: string | null;
  country: string | null;
}

interface CategoryOption {
  category_parent: string;
  category_name: string | null;
  total: number;
}

interface LeaderboardData {
  byPledged: LeaderboardProject[];
  byBackers: LeaderboardProject[];
  creatorsByPledged: LeaderboardCreator[];
  creatorsByCount: LeaderboardCreator[];
  creatorsByAverage: LeaderboardCreator[];
  categories: CategoryOption[];
  generatedAt: number;
  summary: {
    total_projects: number;
    total_pledged_usd: number;
    total_backers: number;
    avg_funded_pct: number;
  };
}

type Metric = 'pledged' | 'backers' | 'creator';
type CreatorMetric = 'pledged' | 'count' | 'average';
type ActiveYear = number | 'custom' | 'lifetime';

const PAGE_SIZE = 20;

const CATEGORY_CN: Record<string, string> = {
  Art: '艺术',
  Comics: '漫画',
  Crafts: '手工',
  Dance: '舞蹈',
  Design: '设计',
  Fashion: '时尚',
  Film: '电影',
  Food: '食品',
  Games: '游戏',
  Journalism: '新闻',
  Music: '音乐',
  Photography: '摄影',
  Publishing: '出版',
  Technology: '科技',
  Theater: '剧场',
  Hardware: '硬件',
  '3D Printing': '3D 打印',
  'DIY Electronics': 'DIY 电子',
  Gadgets: '智能硬件',
  'Tabletop Games': '桌游',
  'Video Games': '电子游戏',
  'Graphic Novels': '图像小说',
  Anthologies: '合集',
};

function categoryNameForShare(name: string | null | undefined, cn: boolean) {
  const label = name?.trim();
  if (!label) return cn ? '全类目' : 'All Categories';
  return cn ? CATEGORY_CN[label] ?? label : label;
}

function loadCanvasImage(src: string) {
  return new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
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

function currentYear() {
  return new Date().getFullYear();
}

function yearRange(year: number) {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function toTs(date: string, end = false) {
  if (!date) return undefined;
  const d = new Date(`${date}T${end ? '23:59:59' : '00:00:00'}`);
  return Math.floor(d.getTime() / 1000);
}

function Thumb({ project }: { project: LeaderboardProject }) {
  const src = project.image_thumb_url ?? project.image_url;
  if (src) return (
    <ImagePreview src={src} className="block h-full w-full">
      <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
    </ImagePreview>
  );
  return <div className="h-full w-full bg-gray-100" />;
}

function rankClass(rank: number) {
  if (rank === 1) return 'bg-amber-400 text-white';
  if (rank === 2) return 'bg-slate-300 text-white';
  if (rank === 3) return 'bg-orange-400 text-white';
  return 'bg-gray-100 text-gray-500';
}

export default function LeaderboardPage() {
  const [lang] = useLanguage();
  const cn = lang === 'cn';
  const yearNow = currentYear();
  const defaultRange = yearRange(yearNow);
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);
  const [activeYear, setActiveYear] = useState<ActiveYear>(yearNow);
  const [categoryParent, setCategoryParent] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [metric, setMetric] = useState<Metric>('pledged');
  const [creatorMetric, setCreatorMetric] = useState<CreatorMetric>('pledged');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareImage, setShareImage] = useState('');
  const [shareLang, setShareLang] = useState<'cn' | 'en'>(cn ? 'cn' : 'en');
  const [shareGenerating, setShareGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const metricParam = params.get('metric');
    const yearParam = params.get('year');
    if (metricParam === 'backers' || metricParam === 'creator') setMetric(metricParam);
    if (metricParam === 'creator-pledged') { setMetric('creator'); setCreatorMetric('pledged'); }
    if (metricParam === 'creator-count') { setMetric('creator'); setCreatorMetric('count'); }
    if (metricParam === 'creator-average') { setMetric('creator'); setCreatorMetric('average'); }
    const creatorMetricParam = params.get('creatorMetric');
    if (creatorMetricParam === 'pledged' || creatorMetricParam === 'count' || creatorMetricParam === 'average') setCreatorMetric(creatorMetricParam);
    if (yearParam === 'lifetime') {
      setActiveYear('lifetime');
      setDateFrom('');
      setDateTo('');
    } else if (yearParam && /^\d{4}$/.test(yearParam)) {
      const y = Number(yearParam);
      const range = yearRange(y);
      setActiveYear(y);
      setDateFrom(range.from);
      setDateTo(range.to);
    } else {
      const from = params.get('from');
      const to = params.get('to');
      if (from && to) {
        setActiveYear('custom');
        setDateFrom(from);
        setDateTo(to);
      }
    }
    setCategoryParent(params.get('categoryParent') ?? '');
    setCategoryName(params.get('categoryName') ?? '');
    setInitialized(true);
  }, []);

  const parentOptions = useMemo(() => {
    const parents = new Map<string, number>();
    for (const c of data?.categories ?? []) parents.set(c.category_parent, (parents.get(c.category_parent) ?? 0) + c.total);
    return [...parents.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const childOptions = useMemo(() => {
    return (data?.categories ?? []).filter(c => !categoryParent || c.category_parent === categoryParent);
  }, [data, categoryParent]);

  const creatorMetrics = metric === 'creator';
  const projects = metric === 'backers' ? data?.byBackers ?? [] : data?.byPledged ?? [];
  const creators = creatorMetric === 'count'
    ? data?.creatorsByCount ?? []
    : creatorMetric === 'average'
    ? data?.creatorsByAverage ?? []
    : data?.creatorsByPledged ?? [];
  const rows = creatorMetrics ? creators : projects;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCreators = creators.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const categoryLabel = categoryNameForShare(categoryName || categoryParent, cn);
  const titleKind = creatorMetrics ? (cn ? 'Creator 榜单' : 'Creator Leaderboard') : (cn ? '项目榜单' : 'Projects');
  const title = cn
    ? `${activeYear === 'custom' ? '自定义区间' : `${activeYear}年`} ${categoryLabel} Kickstarter TOP100 ${titleKind}`
    : `${activeYear === 'custom' ? 'Custom Range' : activeYear} ${categoryLabel} Kickstarter Top 100 ${titleKind}`;
  const rangeLabel = activeYear === 'lifetime'
    ? (cn ? '历史至今' : 'Lifetime')
    : activeYear === 'custom'
      ? (cn ? '自定义区间' : 'Custom Range')
      : (cn ? `${activeYear}年` : String(activeYear));
  const displayTitle = cn
    ? `${rangeLabel} ${categoryLabel} Kickstarter TOP100 ${titleKind}`
    : `${rangeLabel} ${categoryLabel} Kickstarter Top 100 ${titleKind}`;
  const dataDate = data?.generatedAt
    ? new Date(data.generatedAt * 1000).toLocaleString(cn ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString(cn ? 'zh-CN' : 'en-US');

  const load = async () => {
    setLoading(true);
    setPage(1);
    const params = new URLSearchParams({
      limit: '100',
      ...(activeYear !== 'lifetime' && toTs(dateFrom) ? { dateFrom: String(toTs(dateFrom)) } : {}),
      ...(activeYear !== 'lifetime' && toTs(dateTo, true) ? { dateTo: String(toTs(dateTo, true)) } : {}),
      ...(categoryParent ? { categoryParent } : {}),
      ...(categoryName ? { categoryName } : {}),
    });
    const res = await fetch(`/api/leaderboard?${params.toString()}`, { cache: 'no-store' });
    const json = await res.json();
    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    if (initialized) load();
  }, [initialized, dateFrom, dateTo, categoryParent, categoryName]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyYear = (year: number) => {
    const range = yearRange(year);
    setActiveYear(year);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const applyLifetime = () => {
    setActiveYear('lifetime');
    setDateFrom('');
    setDateTo('');
  };

  const switchMetric = (next: Metric) => {
    if (next === 'creator') applyLifetime();
    if (next !== 'creator' && activeYear === 'lifetime') applyYear(yearNow);
    setMetric(next);
    setPage(1);
  };

  const shareUrl = () => {
    const url = new URL(window.location.href);
    url.pathname = '/leaderboard';
    url.search = '';
    if (activeYear === 'lifetime') url.searchParams.set('year', 'lifetime');
    else if (activeYear !== 'custom') url.searchParams.set('year', String(activeYear));
    else {
      url.searchParams.set('from', dateFrom);
      url.searchParams.set('to', dateTo);
    }
    url.searchParams.set('metric', metric);
    if (metric === 'creator') url.searchParams.set('creatorMetric', creatorMetric);
    if (categoryParent) url.searchParams.set('categoryParent', categoryParent);
    if (categoryName) url.searchParams.set('categoryName', categoryName);
    return url.toString();
  };

  const copyShareLink = async () => {
    await navigator.clipboard?.writeText(shareUrl());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const translateTitles = async (rows: LeaderboardProject[], targetLang: 'cn' | 'en') => {
    if (targetLang !== 'cn') return rows.map(r => r.name);
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: rows.map(r => r.name), target: 'zh-CN' }),
      });
      if (!res.ok) return rows.map(r => r.name);
      const json = await res.json() as { translations?: string[] };
      return rows.map((r, i) => json.translations?.[i] || r.name);
    } catch {
      return rows.map(r => r.name);
    }
  };

  const generateShareImage = async (langOverride = shareLang) => {
    setShareGenerating(true);
    setShareOpen(true);
    setShareImage('');
    const rows = projects.slice(0, 20);
    const names = await translateTitles(rows, langOverride);
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1680;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const kickstarterLogo = await loadCanvasImage('/kickstarter-logo.svg');

    ctx.fillStyle = '#51d88a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d9ff92';
    ctx.beginPath();
    ctx.arc(950, 80, 170, 0, Math.PI * 2);
    ctx.fill();

    const isCnShare = langOverride === 'cn';
    const shareCategory = categoryNameForShare(categoryName || categoryParent, isCnShare);
    const generatedLabel = isCnShare ? `数据时间：${dataDate}` : `Data as of ${dataDate}`;

    ctx.fillStyle = '#09351f';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText('Kicksonar x', 64, 78);
    if (kickstarterLogo) {
      ctx.drawImage(kickstarterLogo, 256, 34, 330, 72);
    } else {
      ctx.fillStyle = '#05ce78';
      ctx.font = '900 26px Arial, sans-serif';
      ctx.fillText('KICKSTARTER', 286, 76);
    }
    ctx.font = '900 82px Arial, sans-serif';
    ctx.fillText(activeYear === 'custom' ? 'CUSTOM' : activeYear === 'lifetime' ? 'LIFETIME' : `${activeYear}`, 64, 190);
    ctx.font = '900 62px Arial, sans-serif';
    ctx.fillText(isCnShare ? `${shareCategory} TOP100 项目榜单` : `${shareCategory} TOP100`, 64, 285);
    ctx.fillStyle = '#0f3f29';
    ctx.fillRect(64, 330, 720, 82);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 40px Arial, sans-serif';
    ctx.fillText(metric === 'pledged' ? (isCnShare ? '按众筹总金额排序' : 'Ranked by Pledged Amount') : (isCnShare ? '按支持者数量排序' : 'Ranked by Backers'), 96, 383);
    ctx.fillStyle = '#0f3f29';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText(generatedLabel, 64, 445);

    ctx.fillStyle = '#f3fff4';
    ctx.strokeStyle = '#baff82';
    ctx.lineWidth = 6;
    const tableX = 54;
    const tableY = 500;
    const tableW = 972;
    const rowH = 48;
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, rowH * 21 + 70, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dff7df';
    ctx.fillRect(tableX + 10, tableY + 14, tableW - 20, 58);
    ctx.fillStyle = '#0f2f20';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText(isCnShare ? '序号' : '#', 82, tableY + 52);
    ctx.fillText(isCnShare ? '产品' : 'Project', 175, tableY + 52);
    ctx.fillText(isCnShare ? '金额' : 'Pledged', 720, tableY + 52);
    ctx.fillText(isCnShare ? '支持者' : 'Backers', 865, tableY + 52);

    rows.forEach((project, i) => {
      const y = tableY + 98 + i * rowH;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f5fbf3';
      ctx.fillRect(tableX + 10, y - 30, tableW - 20, rowH);
      ctx.fillStyle = '#0f2f20';
      ctx.font = '500 22px Arial, sans-serif';
      ctx.fillText(String(i + 1), 92, y);
      const translatedName = names[i] || project.name;
      const maxNameLength = isCnShare ? 24 : 32;
      const name = translatedName.length > maxNameLength ? `${translatedName.slice(0, maxNameLength - 1)}...` : translatedName;
      ctx.fillText(name, 175, y);
      ctx.textAlign = 'right';
      ctx.fillText(fmtUsd(project.pledged_usd), 805, y);
      ctx.fillText(fmtNum(project.backers_count), 985, y);
      ctx.textAlign = 'left';
    });

    ctx.fillStyle = '#0f2f20';
    ctx.font = '700 24px Arial, sans-serif';
    const note = isCnShare
      ? '注：金额已统一换算为美元，包含全球 Kickstarter 公开项目。'
      : 'Note: Amounts are normalized to USD for public Kickstarter projects.';
    ctx.fillText(note, 64, 1620);
    setShareImage(canvas.toDataURL('image/png'));
    setShareGenerating(false);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? '排行榜' : 'Leaderboard'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {cn ? '按单年、类目和统一美元金额查看 Kickstarter TOP100 项目。' : 'Rank Kickstarter projects by year, category, normalized USD pledged, and backers.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={copyShareLink} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            <Copy className="h-4 w-4" />{copied ? (cn ? '已复制' : 'Copied') : (cn ? '复制链接' : 'Copy Link')}
          </button>
          <button onClick={() => generateShareImage(shareLang)} className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-3 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark">
            <Share2 className="h-4 w-4" />{cn ? '生成分享图' : 'Share Image'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-100/80 bg-white/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {[yearNow, yearNow - 1, yearNow - 2].map(year => (
              <button
                key={year}
                onClick={() => applyYear(year)}
                className={`rounded-full px-5 py-2 text-sm font-black transition-colors ${
                  activeYear === year ? 'bg-gray-900 text-white' : 'bg-gray-100/80 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {year}
              </button>
            ))}
            <button
              onClick={() => setActiveYear('custom')}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeYear === 'custom' ? 'bg-gray-900 text-white' : 'bg-gray-100/80 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cn ? '自定义' : 'Custom'}
            </button>
            <button
              onClick={applyLifetime}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeYear === 'lifetime' ? 'bg-gray-900 text-white' : 'bg-gray-100/80 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {cn ? '历史至今' : 'Lifetime'}
            </button>
          </div>
          <button onClick={load} className="rounded-lg bg-ks-green px-3 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark">
            {cn ? '应用筛选' : 'Apply'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 text-sm lg:grid-cols-4">
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '开始日期' : 'From'}</span>
            <input type="date" value={dateFrom} onChange={e => { setActiveYear('custom'); setDateFrom(e.target.value); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2" />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '结束日期' : 'To'}</span>
            <input type="date" value={dateTo} onChange={e => { setActiveYear('custom'); setDateTo(e.target.value); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2" />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '大类' : 'Parent Category'}</span>
            <select value={categoryParent} onChange={e => { setCategoryParent(e.target.value); setCategoryName(''); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2">
              <option value="">{cn ? '全部大类' : 'All parent categories'}</option>
              {parentOptions.map(([parent, total]) => <option key={parent} value={parent}>{parent} ({total})</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '二级类目' : 'Subcategory'}</span>
            <select value={categoryName} onChange={e => setCategoryName(e.target.value)} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2">
              <option value="">{cn ? '全部二级类目' : 'All subcategories'}</option>
              {childOptions.map(c => <option key={`${c.category_parent}-${c.category_name}`} value={c.category_name ?? ''}>{c.category_name ?? '-'} ({c.total})</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-100 bg-white/70 p-3">
          <p className="text-xs font-semibold text-gray-400">{cn ? '项目数' : 'Projects'}</p>
          <p className="mt-1 text-xl font-black text-gray-900">{fmtNum(data?.summary?.total_projects ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white/70 p-3">
          <p className="text-xs font-semibold text-gray-400">{cn ? '总筹资额' : 'Total pledged'}</p>
          <p className="mt-1 text-xl font-black text-ks-green">{fmtUsd(data?.summary?.total_pledged_usd ?? 0)}</p>
        </div>
        <div className="rounded-lg border border-gray-100 bg-white/70 p-3">
          <p className="text-xs font-semibold text-gray-400">{cn ? '总支持者' : 'Total backers'}</p>
          <p className="mt-1 text-xl font-black text-blue-600">{fmtNum(data?.summary?.total_backers ?? 0)}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-gray-900">{displayTitle}</h2>
            <p className="text-xs text-gray-400">{cn ? '最多显示前 100 名，每页 20 个项目。' : 'Up to 100 projects, 20 per page.'}</p>
          </div>
          <div className="flex flex-wrap rounded-lg bg-gray-100 p-1">
            <button onClick={() => switchMetric('pledged')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold ${metric === 'pledged' ? 'bg-white text-ks-green shadow-sm' : 'text-gray-500'}`}>
              <DollarSign className="h-4 w-4" />{cn ? '总金额' : 'Pledged'}
            </button>
            <button onClick={() => switchMetric('backers')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold ${metric === 'backers' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}>
              <Users className="h-4 w-4" />{cn ? '支持者' : 'Backers'}
            </button>
            <button onClick={() => switchMetric('creator')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold ${metric === 'creator' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              <Users className="h-4 w-4" />{cn ? '发起者' : 'Creators'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400">{cn ? '加载中...' : 'Loading...'}</div>
        ) : creatorMetrics ? (
          <>
            <div className="grid grid-cols-1 gap-3 border-b border-gray-100 p-5 md:grid-cols-3">
              {([
                ['pledged', cn ? 'Creator 累计众筹金额榜' : 'Total pledged', cn ? '单次平均金额 × 众筹次数' : 'Average per launch × launch count'],
                ['count', cn ? 'Creator 众筹次数榜' : 'Launch count', cn ? '按项目发起次数排序' : 'Ranked by number of launches'],
                ['average', cn ? 'Creator 单次平均金额榜' : 'Average pledged', cn ? '按单次平均融资金额排序' : 'Ranked by average pledged amount'],
              ] as [CreatorMetric, string, string][]).map(([key, label, hint]) => (
                <button
                  key={key}
                  onClick={() => { setCreatorMetric(key); setPage(1); }}
                  className={`rounded-lg border p-4 text-left transition-all ${creatorMetric === key ? 'border-ks-green bg-ks-green-light/60 shadow-sm' : 'border-gray-100 bg-gray-50/70 hover:bg-gray-100'}`}
                >
                  <p className="text-sm font-black text-gray-900">{label}</p>
                  <p className="mt-1 text-xs text-gray-400">{hint}</p>
                </button>
              ))}
            </div>
            <div className="divide-y divide-gray-50">
              {pageCreators.map((creator, index) => {
                const rank = (page - 1) * PAGE_SIZE + index + 1;
                const preview = creator.best_project_thumb_url ?? creator.best_project_image_url;
                const creatorTotal = Number(creator.avg_pledged_usd ?? 0) * Number(creator.project_count ?? 0);
                return (
                  <div key={creator.creator_key} className={`grid grid-cols-[44px_88px_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50 ${rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                  <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-black ${rankClass(rank)}`}>{rank}</span>
                  <Link href={creator.best_project_id ? `/projects/${creator.best_project_id}` : '/projects'} className="h-16 w-24 overflow-hidden rounded-md bg-gray-100">
                    {preview ? (
                      <ImagePreview src={preview} className="block h-full w-full">
                        <img src={preview} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                      </ImagePreview>
                    ) : <div className="h-full w-full bg-gray-100" />}
                  </Link>
                  <span className="min-w-0">
                    <span className="flex items-start gap-2">
                      <span className="line-clamp-1 text-sm font-bold text-gray-900">{creator.creator_name}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-400">
                      {creator.best_project_name ?? (cn ? '代表项目未知' : 'Representative project unknown')} / {creator.category_parent ?? 'Uncategorized'} / {creator.country ?? '--'}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-md bg-ks-green-light px-2 py-1 font-bold text-ks-green-dark">{fmtUsd(creatorTotal)}</span>
                      <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-600">{fmtNum(creator.project_count)} {cn ? '次众筹' : 'projects'}</span>
                      <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">{fmtUsd(creator.avg_pledged_usd)} {cn ? '单次均额' : 'avg'}</span>
                    </span>
                  </span>
                  <span className="w-32 text-right">
                    <span className="block text-xl font-black tabular-nums text-gray-900">
                      {creatorMetric === 'count' ? fmtNum(creator.project_count) : creatorMetric === 'average' ? fmtUsd(creator.avg_pledged_usd) : fmtUsd(creatorTotal)}
                    </span>
                    <span className="text-xs text-gray-400">
                      {creatorMetric === 'count' ? (cn ? '众筹次数' : 'launches') : creatorMetric === 'average' ? (cn ? '单次均额' : 'avg pledged') : (cn ? '累计金额' : 'total pledged')}
                    </span>
                  </span>
                </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="divide-y divide-gray-50">
            {pageProjects.map((project, index) => {
              const rank = (page - 1) * PAGE_SIZE + index + 1;
              return (
                <Link key={project.id} href={`/projects/${project.id}`} className={`group grid grid-cols-[44px_88px_1fr_auto] items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50 ${rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                  <span className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-black ${rankClass(rank)}`}>{rank}</span>
                  <span className="h-16 w-24 overflow-hidden rounded-md bg-gray-100">
                    <Thumb project={project} />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-start gap-2">
                      <span className="line-clamp-2 text-sm font-bold text-gray-900 group-hover:text-ks-green">{project.name}</span>
                      <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-ks-green" />
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-400">
                      {project.category_parent ?? 'Uncategorized'} / {project.category_name ?? '-'} / {project.country ?? '--'}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-md bg-ks-green-light px-2 py-1 font-bold text-ks-green-dark">{fmtUsd(project.pledged_usd)}</span>
                      <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-600">{fmtNum(project.backers_count)} {cn ? '支持者' : 'backers'}</span>
                      <span className="py-1 text-gray-400">{Number(project.funded_pct ?? 0).toFixed(0)}% {cn ? '完成' : 'funded'}</span>
                    </span>
                  </span>
                  <span className="w-28 text-right">
                    <span className="block text-xl font-black tabular-nums text-gray-900">
                      {metric === 'pledged' ? fmtUsd(project.pledged_usd) : fmtNum(project.backers_count)}
                    </span>
                    <span className="text-xs text-gray-400">{metric === 'pledged' ? (cn ? '总金额' : 'pledged') : (cn ? '支持者' : 'backers')}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-400">
            {cn ? `第 ${page} / ${totalPages} 页` : `Page ${page} of ${totalPages}`}
          </p>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))} className="rounded-md border border-gray-200 p-2 text-gray-500 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))} className="rounded-md border border-gray-200 p-2 text-gray-500 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
        {cn
          ? '统计口径：榜单使用 usd_pledged 与有效实时快照金额，统一按美元排序；Kicktraq 的非美元原币快照不会直接参与美元排序。'
          : 'Ranking note: pledged amounts are normalized to USD using usd_pledged and valid live snapshots; non-USD Kicktraq raw snapshots are excluded from USD ranking.'}
      </div>

      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShareOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-lg bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900">{cn ? '分享榜单' : 'Share Leaderboard'}</h3>
                <p className="text-xs text-gray-400">{cn ? '复制链接，或保存生成的榜单图片。' : 'Copy the link or save the generated leaderboard image.'}</p>
              </div>
              <button onClick={() => setShareOpen(false)} className="text-gray-400 hover:text-gray-700">×</button>
            </div>
            <div className="mt-4 flex gap-2">
              <div className="flex rounded-lg bg-gray-100 p-1">
                {(['cn', 'en'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => { setShareLang(l); generateShareImage(l); }}
                    className={`rounded-md px-3 py-1.5 text-sm font-bold ${shareLang === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    {l === 'cn' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
              <button onClick={copyShareLink} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                <Copy className="h-4 w-4" />{copied ? (cn ? '已复制' : 'Copied') : (cn ? '复制链接' : 'Copy Link')}
              </button>
              {shareImage && (
                <a href={shareImage} download={`kicksonar-leaderboard-${activeYear}-${metric}.png`} className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-3 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark">
                  <Download className="h-4 w-4" />{cn ? '保存图片' : 'Save Image'}
                </a>
              )}
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
              {shareImage ? (
                <img src={shareImage} alt="" className="w-full" />
              ) : (
                <div className="flex h-80 items-center justify-center text-gray-400">
                  <ImageIcon className="mr-2 h-5 w-5" />{shareGenerating ? (cn ? '正在生成...' : 'Generating...') : (cn ? '等待生成' : 'Ready')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
