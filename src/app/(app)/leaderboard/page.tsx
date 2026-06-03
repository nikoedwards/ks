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
  Send,
  Share2,
  Trophy,
  Users,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import ImagePreview from '@/components/ImagePreview';
import { useAuthGate } from '@/components/AuthGate';
import { useAuth } from '@/contexts/AuthContext';

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
  agenciesByPledged: LeaderboardCreator[];
  agenciesByCount: LeaderboardCreator[];
  agenciesByAverage: LeaderboardCreator[];
  categories: CategoryOption[];
  generatedAt: number;
  summary: {
    total_projects: number;
    total_pledged_usd: number;
    total_backers: number;
    avg_funded_pct: number;
  };
}

type Metric = 'pledged' | 'backers' | 'creator' | 'agency';
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

function stateLabel(state: string, cn: boolean) {
  const labels: Record<string, { cn: string; en: string }> = {
    live: { cn: '进行中', en: 'Live' },
    successful: { cn: '成功', en: 'Successful' },
    failed: { cn: '失败', en: 'Failed' },
    canceled: { cn: '已下线', en: 'Offline' },
    suspended: { cn: '已下线', en: 'Offline' },
  };
  return cn ? (labels[state]?.cn ?? state) : (labels[state]?.en ?? state);
}

function statePillClass(state: string) {
  if (state === 'live') return 'border-blue-100 bg-blue-50 text-blue-600';
  if (state === 'successful') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (state === 'failed') return 'border-red-100 bg-red-50 text-red-600';
  return 'border-gray-100 bg-gray-50 text-gray-500';
}

function TrendMark({ state }: { state: string }) {
  const up = state === 'live' || state === 'successful';
  return <span className={`ml-1 text-sm font-black ${up ? 'text-emerald-500' : 'text-red-500'}`}>{up ? '↗' : '↘'}</span>;
}

export default function LeaderboardPage() {
  const [lang] = useLanguage();
  const cn = lang === 'cn';
  const { user, isLoading: authLoading } = useAuth();
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
  const [yearFallbackApplied, setYearFallbackApplied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareImages, setShareImages] = useState<string[]>([]);
  const [shareIndex, setShareIndex] = useState(0);
  const [shareCount, setShareCount] = useState(20);
  const [shareLang, setShareLang] = useState<'cn' | 'en'>(cn ? 'cn' : 'en');
  const [shareGenerating, setShareGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  // Whether the device can open the native share sheet (mobile WeChat / 小红书 /
  // IG / X picker). Detected client-side to avoid SSR hydration mismatch.
  const [nativeShareReady, setNativeShareReady] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);

  useEffect(() => {
    setNativeShareReady(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    if (initialized || authLoading) return;
    // Guests get the default first view only; gated deep-link params (metric,
    // year, range, category) are ignored so a shared URL can't bypass the gate.
    if (!user) { setInitialized(true); return; }
    const params = new URLSearchParams(window.location.search);
    const metricParam = params.get('metric');
    const yearParam = params.get('year');
    if (metricParam === 'backers' || metricParam === 'creator' || metricParam === 'agency') setMetric(metricParam);
    if (metricParam === 'creator-pledged') { setMetric('creator'); setCreatorMetric('pledged'); }
    if (metricParam === 'creator-count') { setMetric('creator'); setCreatorMetric('count'); }
    if (metricParam === 'creator-average') { setMetric('creator'); setCreatorMetric('average'); }
    if (metricParam === 'agency-pledged') { setMetric('agency'); setCreatorMetric('pledged'); }
    if (metricParam === 'agency-count') { setMetric('agency'); setCreatorMetric('count'); }
    if (metricParam === 'agency-average') { setMetric('agency'); setCreatorMetric('average'); }
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
  }, [authLoading, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const parentOptions = useMemo(() => {
    const parents = new Map<string, number>();
    for (const c of data?.categories ?? []) parents.set(c.category_parent, (parents.get(c.category_parent) ?? 0) + c.total);
    return [...parents.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const childOptions = useMemo(() => {
    return (data?.categories ?? []).filter(c => !categoryParent || c.category_parent === categoryParent);
  }, [data, categoryParent]);

  const creatorMetrics = metric === 'creator' || metric === 'agency';
  const agencyMetrics = metric === 'agency';
  const projects = metric === 'backers' ? data?.byBackers ?? [] : data?.byPledged ?? [];
  const creators = creatorMetric === 'count'
    ? (agencyMetrics ? data?.agenciesByCount ?? [] : data?.creatorsByCount ?? [])
    : creatorMetric === 'average'
    ? (agencyMetrics ? data?.agenciesByAverage ?? [] : data?.creatorsByAverage ?? [])
    : (agencyMetrics ? data?.agenciesByPledged ?? [] : data?.creatorsByPledged ?? []);
  const rows = creatorMetrics ? creators : projects;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageProjects = projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageCreators = creators.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const categoryLabel = categoryNameForShare(categoryName || categoryParent, cn);
  const titleKind = agencyMetrics ? (cn ? '服务商榜单' : 'Agency Leaderboard') : creatorMetrics ? (cn ? 'Creator 榜单' : 'Creator Leaderboard') : (cn ? '项目榜单' : 'Projects');
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

    // On first load, if current year has no data, silently fall back to the previous year
    if (!yearFallbackApplied && activeYear === yearNow && (json.summary?.total_projects ?? 0) === 0) {
      setYearFallbackApplied(true);
      applyYear(yearNow - 1);
      return;
    }

    setData(json);
    setLoading(false);
  };

  useEffect(() => {
    if (initialized) load();
  }, [initialized, dateFrom, dateTo, categoryParent, categoryName]); // eslint-disable-line react-hooks/exhaustive-deps

  const gate = useAuthGate();

  // Internal (ungated) primitives so gated handlers can compose them.
  const applyYearRaw = (year: number) => {
    const range = yearRange(year);
    setActiveYear(year);
    setDateFrom(range.from);
    setDateTo(range.to);
  };
  const applyLifetimeRaw = () => {
    setActiveYear('lifetime');
    setDateFrom('');
    setDateTo('');
  };

  // Leaderboard browsing beyond the default first view is gated: changing year,
  // range, category, metric dimension, or page requires login.
  const applyYear = (year: number) => gate(() => applyYearRaw(year));
  const applyLifetime = () => gate(() => applyLifetimeRaw());

  const switchMetric = (next: Metric) => gate(() => {
    if (next === 'creator' || next === 'agency') applyLifetimeRaw();
    if (next !== 'creator' && next !== 'agency' && activeYear === 'lifetime') applyYearRaw(yearNow);
    setMetric(next);
    setPage(1);
  });

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
    if (metric === 'creator' || metric === 'agency') url.searchParams.set('creatorMetric', creatorMetric);
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

  // Renders a single share image for one page of 20 ranks and returns a PNG data URL.
  const renderSharePart = (
    rows: LeaderboardProject[],
    names: string[],
    startRank: number,
    part: number,
    totalParts: number,
    isCnShare: boolean,
    kickstarterLogo: HTMLImageElement | null,
  ): string => {
    const rowH = 48;
    const tableX = 54;
    const tableY = 505;
    const tableW = 972;
    const tableInnerTop = 70;
    const tableHeight = tableInnerTop + 28 + rows.length * rowH + 26;

    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = Math.max(900, tableY + tableHeight + 110);
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#51d88a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d9ff92';
    ctx.beginPath();
    ctx.arc(950, 80, 170, 0, Math.PI * 2);
    ctx.fill();

    const shareCategory = categoryNameForShare(categoryName || categoryParent, isCnShare);
    // Format the date in the SHARE language (not the page language), otherwise an
    // EN image generated while the UI is in Chinese shows a Chinese date.
    const shareLocale = isCnShare ? 'zh-CN' : 'en-US';
    const shareDate = data?.generatedAt
      ? new Date(data.generatedAt * 1000).toLocaleDateString(shareLocale, { year: 'numeric', month: 'short', day: 'numeric' })
      : new Date().toLocaleDateString(shareLocale);
    const generatedLabel = isCnShare ? `数据时间：${shareDate}` : `Data as of ${shareDate}`;

    // Header lockup on a white rounded chip for clean contrast; logo at native ratio.
    const headerText = 'Kicksonar x';
    ctx.font = '700 34px Arial, sans-serif';
    const headerTextW = ctx.measureText(headerText).width;
    const logoH = 52;
    const logoRatio = kickstarterLogo && kickstarterLogo.naturalWidth && kickstarterLogo.naturalHeight
      ? kickstarterLogo.naturalWidth / kickstarterLogo.naturalHeight
      : 3840 / 561;
    const logoW = Math.round(logoH * logoRatio);
    const chipPadX = 28;
    const chipGap = 16;
    const chipX = 48;
    const chipY = 30;
    const chipH = 88;
    const chipW = chipPadX * 2 + headerTextW + chipGap + logoW;
    const centerY = chipY + chipH / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(9, 53, 31, 0.18)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chipW, chipH, 22);
    ctx.fill();
    ctx.restore();

    const contentX = chipX + chipPadX;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#09351f';
    ctx.font = '700 34px Arial, sans-serif';
    ctx.fillText(headerText, contentX, centerY);
    if (kickstarterLogo) {
      ctx.drawImage(kickstarterLogo, contentX + headerTextW + chipGap, centerY - logoH / 2, logoW, logoH);
    } else {
      ctx.fillStyle = '#05ce78';
      ctx.font = '900 30px Arial, sans-serif';
      ctx.fillText('KICKSTARTER', contentX + headerTextW + chipGap, centerY);
    }
    ctx.textBaseline = 'alphabetic';
    // Extra breathing room below the chip so the big year no longer kisses it.
    ctx.fillStyle = '#09351f';
    ctx.font = '900 82px Arial, sans-serif';
    ctx.fillText(activeYear === 'custom' ? 'CUSTOM' : activeYear === 'lifetime' ? 'LIFETIME' : `${activeYear}`, 64, 218);
    ctx.font = '900 60px Arial, sans-serif';
    ctx.fillText(isCnShare ? `${shareCategory} TOP100 项目榜单` : `${shareCategory} TOP100`, 64, 300);
    ctx.fillStyle = '#0f3f29';
    ctx.fillRect(64, 338, 760, 78);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 38px Arial, sans-serif';
    const rankByLabel = metric === 'pledged' ? (isCnShare ? '按众筹总金额排序' : 'Ranked by Pledged Amount') : (isCnShare ? '按支持者数量排序' : 'Ranked by Backers');
    const partLabel = totalParts > 1 ? (isCnShare ? `（第 ${part}/${totalParts} 张 · 第 ${startRank}-${startRank + rows.length - 1} 名）` : ` (Part ${part}/${totalParts} · #${startRank}-${startRank + rows.length - 1})`) : '';
    ctx.fillText(rankByLabel, 92, 389);
    ctx.fillStyle = '#0f3f29';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText(`${generatedLabel}${partLabel}`, 64, 448);

    ctx.fillStyle = '#f3fff4';
    ctx.strokeStyle = '#baff82';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(tableX, tableY, tableW, tableHeight, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dff7df';
    ctx.fillRect(tableX + 10, tableY + 14, tableW - 20, 58);
    ctx.fillStyle = '#0f2f20';
    ctx.font = '700 24px Arial, sans-serif';
    ctx.fillText(isCnShare ? '序号' : '#', 78, tableY + 52);
    ctx.fillText(isCnShare ? '产品' : 'Project', 185, tableY + 52);
    ctx.textAlign = 'right';
    ctx.fillText(isCnShare ? '金额' : 'Pledged', 805, tableY + 52);
    ctx.fillText(isCnShare ? '支持者' : 'Backers', 985, tableY + 52);
    ctx.textAlign = 'left';

    const medals = ['🥇', '🥈', '🥉'];
    rows.forEach((project, i) => {
      const rank = startRank + i;
      const y = tableY + tableInnerTop + 28 + i * rowH;
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f5fbf3';
      ctx.fillRect(tableX + 10, y - 30, tableW - 20, rowH);

      // Rank cell: medals for top 3, a distinct green token for 4–10, plain number otherwise.
      const rankCx = 96;
      if (rank <= 3) {
        ctx.textAlign = 'center';
        ctx.font = '30px "Segoe UI Emoji", "Apple Color Emoji", Arial, sans-serif';
        ctx.fillText(medals[rank - 1], rankCx, y + 2);
        ctx.textAlign = 'left';
      } else if (rank <= 10) {
        ctx.save();
        ctx.fillStyle = '#0f3f29';
        ctx.beginPath();
        ctx.arc(rankCx, y - 8, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#d9ff92';
        ctx.font = '700 20px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(rank), rankCx, y - 7);
        ctx.restore();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      } else {
        ctx.fillStyle = '#5a7a68';
        ctx.font = '500 22px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(rank), rankCx, y);
        ctx.textAlign = 'left';
      }

      // Live marker: a small labelled pill (dot + 进行中/LIVE) before the name.
      // Clearer than a bare dot but kept soft (pale fill, no loud color block).
      const nameX = 185;
      let liveDotPad = 0;
      if (project.state === 'live') {
        const tag = isCnShare ? '进行中' : 'LIVE';
        ctx.font = '700 15px Arial, sans-serif';
        const tagW = ctx.measureText(tag).width;
        const padX = 9, dotR = 3.5, dotGap = 6, pillH = 24;
        const pillW = padX + dotR * 2 + dotGap + tagW + padX;
        const pillY = y - 7 - pillH / 2;
        ctx.fillStyle = '#d4f7e0';
        ctx.beginPath();
        ctx.roundRect(nameX, pillY, pillW, pillH, pillH / 2);
        ctx.fill();
        ctx.fillStyle = '#16a34a';
        ctx.beginPath();
        ctx.arc(nameX + padX + dotR, y - 7, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0a7a43';
        ctx.textBaseline = 'middle';
        ctx.fillText(tag, nameX + padX + dotR * 2 + dotGap, y - 6);
        ctx.textBaseline = 'alphabetic';
        liveDotPad = pillW + 12;
      }

      ctx.fillStyle = '#0f2f20';
      ctx.font = '500 22px Arial, sans-serif';
      const translatedName = names[i] || project.name;
      // Truncate by measured width (not a fixed char count) so names fill the
      // column up to just before the right-aligned Pledged column (x=805).
      const nameStartX = nameX + liveDotPad;
      const nameMaxWidth = 690 - nameStartX;
      let name = translatedName;
      if (ctx.measureText(name).width > nameMaxWidth) {
        while (name.length > 1 && ctx.measureText(`${name}…`).width > nameMaxWidth) {
          name = name.slice(0, -1);
        }
        name = `${name.trimEnd()}…`;
      }
      ctx.fillText(name, nameStartX, y);
      ctx.textAlign = 'right';
      ctx.fillText(fmtUsd(project.pledged_usd), 805, y);
      ctx.fillText(fmtNum(project.backers_count), 985, y);
      ctx.textAlign = 'left';
    });

    const noteY = tableY + tableHeight + 44;
    ctx.fillStyle = '#0f2f20';
    ctx.font = '700 24px Arial, sans-serif';
    const note = isCnShare
      ? '注：金额已统一换算为美元，包含全球 Kickstarter 公开项目。'
      : 'Note: Amounts normalized to USD for public Kickstarter projects.';
    ctx.fillText(note, 64, noteY);
    return canvas.toDataURL('image/png');
  };

  const generateShareImage = async (langOverride = shareLang, count = shareCount) => {
    setShareGenerating(true);
    setShareOpen(true);
    setShareImages([]);
    setShareIndex(0);
    setShareHint(null);
    const isCnShare = langOverride === 'cn';
    const totalRows = projects.slice(0, count);
    const names = await translateTitles(totalRows, langOverride);
    const kickstarterLogo = await loadCanvasImage('/Kickstarter-Logo3.svg');
    const totalParts = Math.max(1, Math.ceil(totalRows.length / 20));
    const images: string[] = [];
    for (let part = 0; part < totalParts; part++) {
      const start = part * 20;
      const pageRows = totalRows.slice(start, start + 20);
      const pageNames = names.slice(start, start + 20);
      images.push(renderSharePart(pageRows, pageNames, start + 1, part + 1, totalParts, isCnShare, kickstarterLogo));
    }
    setShareImages(images);
    setShareGenerating(false);
  };

  const downloadAllShareImages = () => {
    shareImages.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = img;
        a.download = `kicksonar-leaderboard-${activeYear}-${metric}-${i * 20 + 1}-${i * 20 + 20}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 350);
    });
  };

  const currentShareFileName = () =>
    `kicksonar-leaderboard-${activeYear}-${metric}-${shareIndex * 20 + 1}-${shareIndex * 20 + 20}.png`;

  // Localized caption that travels with the image when a platform accepts text.
  const shareCaption = () => {
    const cnShare = shareLang === 'cn';
    const cat = categoryParent ? `${categoryParent}${categoryName ? ` · ${categoryName}` : ''} ` : '';
    return cnShare
      ? `Kicksonar ${activeYear} ${cat}Kickstarter TOP${shareCount} 榜单（金额已统一换算为美元）`
      : `Kicksonar ${activeYear} ${cat}Kickstarter Top ${shareCount} — pledged normalized to USD.`;
  };

  const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File | null> => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      return new File([blob], filename, { type: 'image/png' });
    } catch {
      return null;
    }
  };

  const downloadCurrentShareImage = () => {
    const img = shareImages[shareIndex];
    if (!img) return;
    const a = document.createElement('a');
    a.href = img;
    a.download = currentShareFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyCurrentImageToClipboard = async (): Promise<boolean> => {
    const img = shareImages[shareIndex];
    if (!img || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    try {
      const blob = await (await fetch(img)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  };

  // Try the native share sheet with the actual image file. On mobile this is the
  // one-tap "open the app and pick a recipient" flow (WeChat / 小红书 / IG / X / FB).
  const tryNativeImageShare = async (): Promise<'shared' | 'aborted' | 'unsupported'> => {
    const img = shareImages[shareIndex];
    if (!img || typeof navigator.share !== 'function') return 'unsupported';
    const file = await dataUrlToFile(img, currentShareFileName());
    const payload: ShareData = { title: 'Kicksonar', text: shareCaption() };
    if (file && navigator.canShare?.({ files: [file] })) payload.files = [file];
    else return 'unsupported';
    try {
      await navigator.share(payload);
      return 'shared';
    } catch (err) {
      return (err as Error)?.name === 'AbortError' ? 'aborted' : 'unsupported';
    }
  };

  type SharePlatform = { id: string; label: string; color: string; web?: 'x' | 'facebook' | 'weibo' };
  const CN_PLATFORMS: SharePlatform[] = [
    { id: 'wechat', label: '微信', color: '#07C160' },
    { id: 'xiaohongshu', label: '小红书', color: '#FF2442' },
    { id: 'weibo', label: '微博', color: '#E6162D', web: 'weibo' },
  ];
  const EN_PLATFORMS: SharePlatform[] = [
    { id: 'x', label: 'X', color: '#000000', web: 'x' },
    { id: 'facebook', label: 'Facebook', color: '#1877F2', web: 'facebook' },
    { id: 'instagram', label: 'Instagram', color: '#E4405F' },
  ];

  const shareToPlatform = async (platform: SharePlatform) => {
    setShareHint(null);
    const cnShare = shareLang === 'cn';
    // 1) Prefer the native sheet so the chosen app opens directly (mobile).
    const result = await tryNativeImageShare();
    if (result === 'shared' || result === 'aborted') return;

    // 2) Desktop / unsupported fallback. Platforms with a web share endpoint open
    //    a prefilled compose window; the image is downloaded so it can be attached.
    const url = encodeURIComponent(shareUrl());
    const text = encodeURIComponent(shareCaption());
    if (platform.web === 'x') {
      window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener');
      downloadCurrentShareImage();
      setShareHint(cnShare ? '已打开 X 发文窗口，并下载了图片，请在发文时附上图片。' : 'Opened X — the image was downloaded, attach it to your post.');
      return;
    }
    if (platform.web === 'facebook') {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener');
      downloadCurrentShareImage();
      setShareHint(cnShare ? '已打开 Facebook 分享窗口，并下载了图片，请在发帖时上传图片。' : 'Opened Facebook — the image was downloaded, upload it to your post.');
      return;
    }
    if (platform.web === 'weibo') {
      window.open(`https://service.weibo.com/share/share.php?url=${url}&title=${text}`, '_blank', 'noopener');
      downloadCurrentShareImage();
      setShareHint('已打开微博分享窗口，并下载了图片，请在发布时上传图片。');
      return;
    }
    // 3) WeChat / 小红书 / Instagram have no desktop web image-share: save + copy,
    //    then guide the user. (On mobile, step 1 already handled them.)
    const copiedImg = await copyCurrentImageToClipboard();
    downloadCurrentShareImage();
    setShareHint(
      cnShare
        ? `图片已${copiedImg ? '复制并' : ''}下载，请打开「${platform.label}」上传分享。手机端点任意按钮可直接唤起 App 选择「${platform.label}」。`
        : `Image ${copiedImg ? 'copied & ' : ''}downloaded — open ${platform.label} and upload it. On mobile, tap any button to open the app picker directly.`,
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cn ? '排行榜' : 'Leaderboard'}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {cn ? '按单年、类目和统一美元金额查看 Kickstarter TOP100 项目。' : 'Rank Kickstarter projects by year, category, normalized USD pledged, and backers.'}
          </p>
          <Link
            href="/awards"
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-100/60 px-3 py-1 text-xs font-bold text-amber-700 transition-colors hover:from-amber-100 hover:to-amber-200/70"
          >
            <Trophy className="h-3.5 w-3.5" />
            {cn ? '声纳奖 · 年度颁奖' : 'Kicksonar Awards'}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
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
              onClick={() => gate(() => setActiveYear('custom'))}
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
          <button onClick={() => gate(load)} className="rounded-lg bg-ks-green px-3 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark">
            {cn ? '应用筛选' : 'Apply'}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 text-sm lg:grid-cols-4">
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '开始日期' : 'From'}</span>
            <input type="date" value={dateFrom} onChange={e => { const v = e.target.value; gate(() => { setActiveYear('custom'); setDateFrom(v); }); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2" />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Calendar className="h-3.5 w-3.5" />{cn ? '结束日期' : 'To'}</span>
            <input type="date" value={dateTo} onChange={e => { const v = e.target.value; gate(() => { setActiveYear('custom'); setDateTo(v); }); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2" />
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '大类' : 'Parent Category'}</span>
            <select value={categoryParent} onChange={e => { const v = e.target.value; gate(() => { setCategoryParent(v); setCategoryName(''); }); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2">
              <option value="">{cn ? '全部大类' : 'All parent categories'}</option>
              {parentOptions.map(([parent, total]) => <option key={parent} value={parent}>{parent} ({total})</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-400"><Filter className="h-3.5 w-3.5" />{cn ? '二级类目' : 'Subcategory'}</span>
            <select value={categoryName} onChange={e => { const v = e.target.value; gate(() => setCategoryName(v)); }} className="w-full rounded-md border border-gray-200 bg-white px-3 py-2">
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
            <button onClick={() => switchMetric('agency')} className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-bold ${metric === 'agency' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              <Users className="h-4 w-4" />{cn ? '服务商' : 'Agencies'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-400">{cn ? '加载中...' : 'Loading...'}</div>
        ) : creatorMetrics ? (
          <>
            <div className="grid grid-cols-1 gap-3 border-b border-gray-100 p-5 md:grid-cols-3">
              {([
                ['pledged', agencyMetrics ? (cn ? '服务商累计众筹金额榜' : 'Agency total pledged') : (cn ? 'Creator 累计众筹金额榜' : 'Creator total pledged'), cn ? '单次平均金额 × 众筹次数' : 'Average per launch × launch count'],
                ['count', agencyMetrics ? (cn ? '服务商项目次数榜' : 'Agency project count') : (cn ? 'Creator 众筹次数榜' : 'Creator launch count'), cn ? '按项目次数排序' : 'Ranked by number of projects'],
                ['average', agencyMetrics ? (cn ? '服务商单次平均金额榜' : 'Agency average pledged') : (cn ? 'Creator 单次平均金额榜' : 'Creator average pledged'), cn ? '按单次平均融资金额排序' : 'Ranked by average pledged amount'],
              ] as [CreatorMetric, string, string][]).map(([key, label, hint]) => (
                <button
                  key={key}
                  onClick={() => gate(() => { setCreatorMetric(key); setPage(1); })}
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
                  <div key={creator.creator_key} className={`grid grid-cols-[32px_60px_1fr_auto] items-center gap-3 px-3 py-4 transition-colors hover:bg-gray-50 sm:grid-cols-[44px_88px_1fr_auto] sm:gap-4 sm:px-5 ${rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                  <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-xs font-black sm:h-9 sm:min-w-9 sm:px-2 sm:text-sm ${rankClass(rank)}`}>{rank}</span>
                  <Link href={creator.best_project_id ? `/projects/${creator.best_project_id}` : '/projects'} target="_blank" rel="noopener noreferrer" className="h-12 w-[60px] overflow-hidden rounded-md bg-gray-100 sm:h-16 sm:w-24">
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
                  <span className="w-20 text-right sm:w-32">
                    <span className="block text-base font-black tabular-nums text-gray-900 sm:text-xl">
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
                <Link key={project.id} href={`/projects/${project.id}`} target="_blank" rel="noopener noreferrer" className={`group grid grid-cols-[32px_60px_1fr_auto] items-center gap-3 px-3 py-4 transition-colors hover:bg-gray-50 sm:grid-cols-[44px_88px_1fr_auto] sm:gap-4 sm:px-5 ${rank <= 3 ? 'bg-amber-50/30' : ''}`}>
                  <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-xs font-black sm:h-9 sm:min-w-9 sm:px-2 sm:text-sm ${rankClass(rank)}`}>{rank}</span>
                  <span className="h-12 w-[60px] overflow-hidden rounded-md bg-gray-100 sm:h-16 sm:w-24">
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
                      <span className={`rounded-full border px-2 py-1 font-semibold ${statePillClass(project.state)}`}>{stateLabel(project.state, cn)}</span>
                      <span className="rounded-md bg-ks-green-light px-2 py-1 font-bold text-ks-green-dark">{fmtUsd(project.pledged_usd)}</span>
                      <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-600">{fmtNum(project.backers_count)} {cn ? '支持者' : 'backers'}</span>
                      <span className="py-1 text-gray-400">{Number(project.funded_pct ?? 0).toFixed(0)}% {cn ? '完成' : 'funded'}</span>
                    </span>
                  </span>
                  <span className="w-20 text-right sm:w-28">
                    <span className="block text-base font-black tabular-nums text-gray-900 sm:text-xl">
                      {metric === 'pledged' ? fmtUsd(project.pledged_usd) : fmtNum(project.backers_count)}
                      <TrendMark state={project.state} />
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
            <button disabled={page <= 1} onClick={() => gate(() => setPage(p => Math.max(1, p - 1)))} className="rounded-md border border-gray-200 p-2 text-gray-500 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button disabled={page >= totalPages} onClick={() => gate(() => setPage(p => Math.min(totalPages, p + 1)))} className="rounded-md border border-gray-200 p-2 text-gray-500 disabled:opacity-40">
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
          <div className="max-h-[92vh] w-full max-w-xl overflow-auto rounded-lg bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-gray-900">{cn ? '分享榜单' : 'Share Leaderboard'}</h3>
                <p className="text-xs text-gray-400">{cn ? '选择语言与名次数量，保存生成的榜单图片。' : 'Pick language & rank count, then save the generated images.'}</p>
              </div>
              <button onClick={() => setShareOpen(false)} className="text-gray-400 hover:text-gray-700">×</button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg bg-gray-100 p-1">
                {(['cn', 'en'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => { setShareLang(l); generateShareImage(l, shareCount); }}
                    className={`rounded-md px-3 py-1.5 text-sm font-bold ${shareLang === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                  >
                    {l === 'cn' ? '中文' : 'EN'}
                  </button>
                ))}
              </div>
              <button onClick={copyShareLink} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                <Copy className="h-4 w-4" />{copied ? (cn ? '已复制' : 'Copied') : (cn ? '复制链接' : 'Copy Link')}
              </button>
            </div>

            {/* Rank count selector — default 20, steps of 20 up to 100 (100 = 5 images). */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-400">{cn ? '生成名次' : 'Top ranks'}</span>
              <div className="flex flex-wrap rounded-lg bg-gray-100 p-1">
                {[20, 40, 60, 80, 100].map(n => (
                  <button
                    key={n}
                    onClick={() => { setShareCount(n); generateShareImage(shareLang, n); }}
                    disabled={shareGenerating}
                    className={`rounded-md px-3 py-1.5 text-sm font-bold disabled:opacity-50 ${shareCount === n ? 'bg-white text-ks-green shadow-sm' : 'text-gray-500'}`}
                  >
                    TOP {n}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-400">{cn ? `共 ${Math.max(1, Math.ceil(shareCount / 20))} 张` : `${Math.max(1, Math.ceil(shareCount / 20))} image(s)`}</span>
            </div>

            {/* Multi-image tabs */}
            {shareImages.length > 1 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {shareImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setShareIndex(i)}
                    className={`rounded-md px-2.5 py-1 text-xs font-bold transition-colors ${shareIndex === i ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                  >
                    {i * 20 + 1}–{i * 20 + 20}
                  </button>
                ))}
              </div>
            )}

            {/* Save actions */}
            <div className="mt-3 flex flex-wrap gap-2">
              {shareImages[shareIndex] && (
                <a
                  href={shareImages[shareIndex]}
                  download={`kicksonar-leaderboard-${activeYear}-${metric}-${shareIndex * 20 + 1}-${shareIndex * 20 + 20}.png`}
                  className="inline-flex items-center gap-2 rounded-lg border border-ks-green px-3 py-2 text-sm font-semibold text-ks-green hover:bg-ks-green-light/40"
                >
                  <Download className="h-4 w-4" />{cn ? '保存这张' : 'Save this'}
                </a>
              )}
              {shareImages.length > 1 && (
                <button
                  onClick={downloadAllShareImages}
                  className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-3 py-2 text-sm font-semibold text-white hover:bg-ks-green-dark"
                >
                  <Download className="h-4 w-4" />{cn ? `保存全部 (${shareImages.length} 张)` : `Save all (${shareImages.length})`}
                </button>
              )}
            </div>

            {/* Social platforms — tap opens the native share sheet on mobile so the
                chosen app (WeChat / 小红书 / IG / X / FB) launches directly. */}
            {shareImages[shareIndex] && !shareGenerating && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="mb-2 text-xs font-semibold text-gray-400">
                  {cn ? '分享到社交平台' : 'Share to social'}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {nativeShareReady && (
                    <button
                      onClick={tryNativeImageShare}
                      className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-700"
                    >
                      <Send className="h-4 w-4" />{cn ? '一键分享' : 'Share'}
                    </button>
                  )}
                  {(shareLang === 'cn' ? CN_PLATFORMS : EN_PLATFORMS).map(p => (
                    <button
                      key={p.id}
                      onClick={() => shareToPlatform(p)}
                      style={{ backgroundColor: p.color }}
                      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      <Share2 className="h-3.5 w-3.5" />{p.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {shareHint ?? (cn
                    ? '手机端点一下会唤起系统分享，直接选择 App 与联系人；电脑端会打开网页分享或下载图片。'
                    : 'On mobile this opens the system share sheet to pick an app & contact; on desktop it opens a web share or downloads the image.')}
                </p>
              </div>
            )}

            <div className="mt-4 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
              {shareGenerating ? (
                <div className="flex h-80 items-center justify-center text-gray-400">
                  <ImageIcon className="mr-2 h-5 w-5 animate-pulse" />{cn ? '正在生成...' : 'Generating...'}
                </div>
              ) : shareImages[shareIndex] ? (
                <img src={shareImages[shareIndex]} alt="" className="w-full" />
              ) : (
                <div className="flex h-80 items-center justify-center text-gray-400">
                  <ImageIcon className="mr-2 h-5 w-5" />{cn ? '等待生成' : 'Ready'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
