'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, ChevronLeft, ChevronRight, Download, ArrowUp, ArrowDown, ArrowUpDown, Heart, SlidersHorizontal, X } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import ImagePreview from '@/components/ImagePreview';
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
  goal: number;
  pledged: number;
  usd_pledged: number;
  backers_count: number;
  staff_pick: number;
  launched_at: number;
  deadline: number;
  creator_name?: string;
  creator_slug?: string;
  creator_url?: string;
  source_url: string;
  slug: string;
  data_source?: string;
  image_url?: string | null;
  image_thumb_url?: string | null;
  has_service_agency?: number;
  service_agency_name?: string | null;
  // Live snapshot fields
  live_pledged_usd?: number | null;
  live_backers_count?: number | null;
  live_captured_at?: number | null;
  live_days_to_go?: number | null;
}

type TimePeriod = 'all' | 'week' | 'month' | 'year' | 'custom';
type SortDir = 'asc' | 'desc';

const STATE_BADGE: Record<string, string> = {
  successful: 'bg-ks-green-light text-ks-green-dark font-semibold',
  failed: 'bg-red-50 text-red-600',
  live: 'bg-blue-50 text-blue-600',
  canceled: 'bg-amber-50 text-amber-600',
  suspended: 'bg-purple-50 text-purple-600',
  prelaunch: 'bg-orange-50 text-orange-600',
};

function fmtMoney(v: number, currency = 'USD') {
  const symbols: Record<string, string> = { USD: '$', HKD: 'HK$', AUD: 'A$', CAD: 'C$', GBP: '£', EUR: '€', JPY: '¥' };
  const prefix = symbols[currency] ?? `${currency} `;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${prefix}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${prefix}${abs.toFixed(0)}`;
}

function projectMoney(p: Project) {
  const nativeCurrency = p.currency || 'USD';
  const looksNative = nativeCurrency !== 'USD'
    && p.usd_pledged > 0
    && (p.pledged <= 0 || p.usd_pledged >= p.pledged * 0.8);
  if (looksNative) {
    return { pledged: p.live_pledged_usd ?? p.usd_pledged, goal: p.goal, currency: nativeCurrency };
  }
  const pledged = p.live_pledged_usd ?? p.usd_pledged;
  const inferredGoal = nativeCurrency !== 'USD' && p.pledged > 0 && p.usd_pledged > 0 && p.usd_pledged < p.pledged
    ? p.goal * (p.usd_pledged / p.pledged)
    : p.goal;
  return { pledged, goal: inferredGoal, currency: 'USD' };
}

function fmtDate(ts: number) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function calcDays(p: Project): number | null {
  if (!p.launched_at) return null;
  const end = p.state === 'live' ? Math.floor(Date.now() / 1000) : (p.deadline || null);
  if (!end) return null;
  return Math.round(Math.abs(end - p.launched_at) / 86400);
}

// Countdown to a campaign's deadline ("还有几天就下线"). Ended/non-live projects
// show the closing date instead.
function closingInfo(p: Project, lang: 'cn' | 'en'): { text: string; urgent: boolean; ended: boolean } | null {
  if (!p.deadline) return null;
  const secsLeft = p.deadline - Math.floor(Date.now() / 1000);
  if (p.state !== 'live' || secsLeft <= 0) {
    return { text: lang === 'cn' ? `已结束 · ${fmtDate(p.deadline)}` : `Ended · ${fmtDate(p.deadline)}`, urgent: false, ended: true };
  }
  const days = Math.floor(secsLeft / 86400);
  if (days >= 1) {
    return { text: lang === 'cn' ? `还有 ${days} 天` : `${days}d left`, urgent: days <= 3, ended: false };
  }
  const hours = Math.max(1, Math.floor(secsLeft / 3600));
  return { text: lang === 'cn' ? `还有 ${hours} 小时` : `${hours}h left`, urgent: true, ended: false };
}

function exportCsv(rows: Project[], filename = 'kicksonar-export.csv') {
  const headers = ['#', 'ID', 'Name', 'State', 'Category', 'Goal (USD)', 'Pledged (USD)', 'Funded %', 'Backers', 'Days', 'Country', 'Launched', 'URL'];
  const csvRows = rows.map((p, i) => {
    const money = projectMoney(p);
    const fundingRate = money.goal > 0 ? ((money.pledged / money.goal) * 100).toFixed(1) : '0';
    const days = calcDays(p) ?? '';
    const launched = p.launched_at ? new Date(p.launched_at * 1000).toISOString().slice(0, 10) : '';
    const url = p.source_url?.startsWith('https://www.kickstarter.com/projects/') ? p.source_url : '';
    return [
      i + 1, p.id,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      p.state, p.category_parent,
      money.goal, money.pledged, fundingRate,
      p.backers_count, days, p.country, launched,
      `"${url}"`,
    ].join(',');
  });
  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function RowBadge({ n }: { n: number }) {
  if (n <= 3) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-black bg-amber-400 text-white shadow-sm">
      {n}
    </span>
  );
  if (n <= 10) return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-slate-200 text-slate-600">
      {n}
    </span>
  );
  return <span className="text-xs text-gray-400 font-medium">#{n}</span>;
}

function SortIcon({ col, sort, sortDir }: { col: string; sort: string; sortDir: SortDir }) {
  if (sort !== col) return <ArrowUpDown className="w-3 h-3 text-gray-300 ml-1 inline-block" />;
  return sortDir === 'desc'
    ? <ArrowDown className="w-3 h-3 text-ks-green ml-1 inline-block" />
    : <ArrowUp className="w-3 h-3 text-ks-green ml-1 inline-block" />;
}

const SORTABLE_COLS = ['goal', 'usd_pledged', 'funding_rate', 'backers', 'launched'] as const;
const VIEW_COLUMNS = [
  { id: 'thumbnail', labelCn: '缩略图', labelEn: 'Image' },
  { id: 'creator', labelCn: '项目所有者', labelEn: 'Creator' },
  { id: 'status', labelCn: '状态', labelEn: 'Status' },
  { id: 'category', labelCn: '类目', labelEn: 'Category' },
  { id: 'agency', labelCn: '服务商', labelEn: 'Agency' },
  { id: 'goal', labelCn: '目标', labelEn: 'Goal' },
  { id: 'pledged', labelCn: '已筹', labelEn: 'Pledged' },
  { id: 'funded', labelCn: '完成率', labelEn: 'Funded' },
  { id: 'backers', labelCn: '支持者', labelEn: 'Backers' },
  { id: 'days', labelCn: '天数', labelEn: 'Days' },
  { id: 'deadline', labelCn: '下线时间', labelEn: 'Closing' },
  { id: 'country', labelCn: '国家', labelEn: 'Country' },
  { id: 'launch', labelCn: '发起时间', labelEn: 'Launch' },
  { id: 'actions', labelCn: '操作', labelEn: 'Actions' },
] as const;
type ViewColumnId = typeof VIEW_COLUMNS[number]['id'];
const DEFAULT_VISIBLE_COLUMNS = VIEW_COLUMNS.map(c => c.id);

export default function ProjectsPage() {
  const [lang] = useLanguage();
  const tr = t[lang].projects;
  const stateTr = t[lang].states;
  const { user, showLogin } = useAuth();

  const [data, setData] = useState<{ total: number; rows: Project[]; categories: string[]; categoryOptions?: { category_parent: string; category_name: string | null; total: number }[]; countries: { country: string; country_name: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  const [search, setSearch] = useState('');
  const [state, setState] = useState('live');
  const [category, setCategory] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [country, setCountry] = useState('');
  const [serviceAgency, setServiceAgency] = useState('');
  const [sort, setSort] = useState('usd_pledged');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [viewOpen, setViewOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<ViewColumnId[]>(DEFAULT_VISIBLE_COLUMNS);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('kicksonar.projectColumns');
      if (saved) {
        const parsed = JSON.parse(saved) as ViewColumnId[];
        const allowed = parsed.filter(id => VIEW_COLUMNS.some(c => c.id === id));
        if (allowed.length) {
          // Surface newly-added columns for users with an older saved layout.
          if (!allowed.includes('deadline')) allowed.push('deadline');
          setVisibleCols(allowed);
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('kicksonar.projectColumns', JSON.stringify(visibleCols)); } catch { /* ignore */ }
  }, [visibleCols]);

  // URL state persistence — read on mount
  const urlInitDone = useRef(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('search')) setSearch(sp.get('search')!);
    if (sp.get('state')) setState(sp.get('state')!);
    if (sp.get('category')) setCategory(sp.get('category')!);
    if (sp.get('categoryName')) setCategoryName(sp.get('categoryName')!);
    if (sp.get('country')) setCountry(sp.get('country')!);
    if (sp.get('serviceAgency')) setServiceAgency(sp.get('serviceAgency')!);
    if (sp.get('sort')) setSort(sp.get('sort')!);
    if (sp.get('sortDir')) setSortDir(sp.get('sortDir') as SortDir);
    if (sp.get('page')) setPage(Number(sp.get('page')));
    if (sp.get('timePeriod')) setTimePeriod(sp.get('timePeriod') as TimePeriod);
    if (sp.get('dateFrom')) setDateFrom(sp.get('dateFrom')!);
    if (sp.get('dateTo')) setDateTo(sp.get('dateTo')!);
    urlInitDone.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // URL state persistence — write on change
  useEffect(() => {
    if (!urlInitDone.current) return;
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (state !== 'live') params.set('state', state);
    if (category) params.set('category', category);
    if (categoryName) params.set('categoryName', categoryName);
    if (country) params.set('country', country);
    if (serviceAgency) params.set('serviceAgency', serviceAgency);
    if (sort !== 'usd_pledged') params.set('sort', sort);
    if (sortDir !== 'desc') params.set('sortDir', sortDir);
    if (page !== 1) params.set('page', String(page));
    if (timePeriod !== 'all') params.set('timePeriod', timePeriod);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [search, state, category, categoryName, country, serviceAgency, sort, sortDir, page, timePeriod, dateFrom, dateTo]);

  // Cross-page selection: Set for re-render, Map for data cache
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedCache = useRef<Map<string, Project>>(new Map());

  // Favorites
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user) { setFavoriteIds(new Set()); return; }
    fetch('/api/favorites').then(r => r.json()).then(d => {
      setFavoriteIds(new Set((d.ids ?? []) as string[]));
    }).catch(() => {});
  }, [user]);

  const toggleFavorite = async (projectId: string) => {
    if (!user) { showLogin(); return; }
    if (favoriteIds.has(projectId)) {
      await fetch(`/api/favorites/${projectId}`, { method: 'DELETE' });
      setFavoriteIds(prev => { const n = new Set(prev); n.delete(projectId); return n; });
    } else {
      await fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }) });
      setFavoriteIds(prev => new Set([...prev, projectId]));
    }
  };

  // Auth gate: runs fn immediately if logged in, else shows login modal then runs fn on success
  const gate = (fn: () => void) => {
    if (user) { fn(); return; }
    showLogin(fn);
  };

  const handleColumnSort = useCallback((col: string) => {
    if (col === sort) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(col);
      setSortDir('desc');
    }
    setPage(1);
  }, [sort]);

  const fetchData = useCallback(() => {
    setLoading(true);
    const now = Math.floor(Date.now() / 1000);
    const tsFrom = timePeriod === 'week' ? now - 7 * 86400
      : timePeriod === 'month' ? now - 30 * 86400
      : timePeriod === 'year' ? now - 365 * 86400
      : timePeriod === 'custom' && dateFrom ? Math.floor(new Date(dateFrom).getTime() / 1000)
      : undefined;
    const tsTo = timePeriod === 'custom' && dateTo ? Math.floor(new Date(dateTo).getTime() / 1000) : undefined;

    const params = new URLSearchParams({
      page: String(page), limit: '20', sort, sortDir,
      ...(state !== 'all' ? { state } : {}),
      ...(category ? { category } : {}),
      ...(categoryName ? { categoryName } : {}),
      ...(country ? { country } : {}),
      ...(serviceAgency ? { serviceAgency } : {}),
      ...(search ? { search } : {}),
      ...(tsFrom ? { dateFrom: String(tsFrom) } : {}),
      ...(tsTo ? { dateTo: String(tsTo) } : {}),
    });
    fetch(`/api/projects?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!d.total && !d.rows?.length && !d.categories?.length) setEmpty(true);
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, sort, sortDir, state, category, categoryName, country, serviceAgency, search, timePeriod, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(); };
  const resetFilters = () => {
    setSearch('');
    setState('all');
    setCategory('');
    setCategoryName('');
    setCountry('');
    setServiceAgency('');
    setSort('usd_pledged');
    setSortDir('desc');
    setPage(1);
    setTimePeriod('all');
    setDateFrom('');
    setDateTo('');
  };

  const childCategories = useMemo(() => {
    return (data?.categoryOptions ?? []).filter(c => !category || c.category_parent === category);
  }, [data, category]);

  const currentRows = data?.rows ?? [];
  const currentIds = currentRows.map(p => p.id);
  const allPageSelected = currentIds.length > 0 && currentIds.every(id => selectedIds.has(id));
  const somePageSelected = currentIds.some(id => selectedIds.has(id));

  const handleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allPageSelected) {
      currentIds.forEach(id => { next.delete(id); selectedCache.current.delete(id); });
    } else {
      currentRows.forEach(p => { next.add(p.id); selectedCache.current.set(p.id, p); });
    }
    setSelectedIds(next);
  };

  const handleSelectRow = (p: Project) => {
    const next = new Set(selectedIds);
    if (next.has(p.id)) {
      next.delete(p.id);
      selectedCache.current.delete(p.id);
    } else {
      next.add(p.id);
      selectedCache.current.set(p.id, p);
    }
    setSelectedIds(next);
  };

  const handleExport = () => {
    let rows: Project[];
    if (selectedIds.size > 0) {
      rows = Array.from(selectedCache.current.values());
    } else {
      rows = currentRows;
    }
    exportCsv(rows);
  };

  const showCol = (id: ViewColumnId) => visibleCols.includes(id);
  const toggleColumn = (id: ViewColumnId) => {
    setVisibleCols(cols => cols.includes(id)
      ? cols.filter(col => col !== id)
      : [...cols, id]);
  };

  if (empty && !loading) return <EmptyState />;

  const totalPages = data ? Math.ceil(data.total / 20) : 0;
  const selectCls = 'border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ks-green bg-white';

  const periods = Object.keys(tr.periods) as TimePeriod[];

  type SortableCol = typeof SORTABLE_COLS[number];
  const colSortKey: Record<string, SortableCol> = {
    goal: 'goal',
    usd_pledged: 'usd_pledged',
    funding_rate: 'funding_rate',
    backers: 'backers',
    launched: 'launched',
  };

  const SortableTh = ({ col, children, right }: { col: SortableCol; children: React.ReactNode; right?: boolean }) => (
    <th
      className={`px-4 py-3 whitespace-nowrap align-middle ${right ? 'text-right' : 'text-left'} cursor-pointer select-none hover:text-gray-600 transition-colors`}
      onClick={() => gate(() => handleColumnSort(col))}
    >
      <span className={`inline-flex items-center gap-1 ${right ? 'justify-end w-full' : ''}`}>
        {children}
        <SortIcon col={col} sort={sort} sortDir={sortDir} />
      </span>
    </th>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm space-y-3">
        {/* Time period */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">{tr.period}</span>
          <div className="flex flex-wrap gap-1.5">
            {periods.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => gate(() => { setTimePeriod(p); setPage(1); })}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  timePeriod === p
                    ? 'bg-ks-green text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tr.periods[p]}
              </button>
            ))}
          </div>
          {timePeriod === 'custom' && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className={selectCls} />
              <span className="text-gray-400 text-sm">—</span>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className={selectCls} />
            </div>
          )}
        </div>

        {/* Other filters */}
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.searchLabel}</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={tr.searchPlaceholder}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.statusLabel}</label>
            <select value={state} onChange={e => gate(() => { setState(e.target.value); setPage(1); })} className={selectCls}>
              {(Object.keys(tr.states) as (keyof typeof tr.states)[]).map(k => (
                <option key={k} value={k}>{tr.states[k]}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.categoryLabel}</label>
            <select value={category} onChange={e => gate(() => { setCategory(e.target.value); setCategoryName(''); setPage(1); })} className={selectCls}>
              <option value="">{tr.allCategories}</option>
              {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{lang === 'cn' ? '二级类目' : 'Subcategory'}</label>
            <select value={categoryName} onChange={e => gate(() => { setCategoryName(e.target.value); setPage(1); })} className={selectCls}>
              <option value="">{lang === 'cn' ? '全部二级类目' : 'All subcategories'}</option>
              {childCategories.map(c => (
                <option key={`${c.category_parent}-${c.category_name}`} value={c.category_name ?? ''}>
                  {c.category_name ?? '-'} ({c.total})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.countryLabel}</label>
            <select value={country} onChange={e => gate(() => { setCountry(e.target.value); setPage(1); })} className={selectCls}>
              <option value="">{tr.allCountries}</option>
              {(data?.countries ?? []).map(c => (
                <option key={c.country} value={c.country}>{c.country_name || c.country}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{lang === 'cn' ? '服务商' : 'Agency'}</label>
            <select value={serviceAgency} onChange={e => gate(() => { setServiceAgency(e.target.value); setPage(1); })} className={selectCls}>
              <option value="">{lang === 'cn' ? '全部服务商' : 'All agencies'}</option>
              <option value="__has_agency__">{lang === 'cn' ? '有服务商' : 'Has agency'}</option>
              <option value="Longham">{lang === 'cn' ? 'Longham' : 'Longham'}</option>
              <option value="Global OneClick">{lang === 'cn' ? 'Global OneClick' : 'Global OneClick'}</option>
              <option value="Vinyl">{lang === 'cn' ? 'Vinyl' : 'Vinyl'}</option>
            </select>
          </div>

          <button type="submit"
            className="bg-ks-green hover:bg-ks-green-dark text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm">
            {tr.searchBtn}
          </button>
          <button type="button" onClick={() => gate(resetFilters)}
            className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
            {lang === 'cn' ? '重置' : 'Reset'}
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">
            {lang === 'cn' ? '加载中...' : 'Loading...'}
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                {tr.total(data?.total?.toLocaleString() ?? '0')}
                {selectedIds.size > 0 && (
                  <span className="ml-2 text-ks-green font-medium">
                    · {lang === 'cn' ? `已选 ${selectedIds.size} 项` : `${selectedIds.size} selected`}
                  </span>
                )}
              </span>
              <div className="relative flex items-center gap-2">
                <button
                  onClick={() => gate(() => setViewOpen(true))}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {lang === 'cn' ? '编辑视图' : 'Edit View'}
                </button>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  {selectedIds.size > 0 ? tr.exportSelected(selectedIds.size) : tr.exportPage}
                </button>
                {viewOpen && (
                  <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold text-gray-700">{lang === 'cn' ? '列表字段' : 'Visible columns'}</p>
                      <button onClick={() => setViewOpen(false)} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {VIEW_COLUMNS.map(col => (
                        <label key={col.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={showCol(col.id)}
                            onChange={() => toggleColumn(col.id)}
                            className="rounded border-gray-300 accent-ks-green"
                          />
                          <span>{lang === 'cn' ? col.labelCn : col.labelEn}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1720px] table-fixed text-sm">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-14" />
                  {showCol('thumbnail') && <col className="w-24" />}
                  <col className="w-[420px]" />
                  {showCol('creator') && <col className="w-36" />}
                  {showCol('status') && <col className="w-28" />}
                  {showCol('category') && <col className="w-40" />}
                  {showCol('agency') && <col className="w-44" />}
                  {showCol('goal') && <col className="w-28" />}
                  {showCol('pledged') && <col className="w-32" />}
                  {showCol('funded') && <col className="w-24" />}
                  {showCol('backers') && <col className="w-24" />}
                  {showCol('days') && <col className="w-24" />}
                  {showCol('deadline') && <col className="w-32" />}
                  {showCol('country') && <col className="w-20" />}
                  {showCol('launch') && <col className="w-32" />}
                  {showCol('actions') && <col className="w-20" />}
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 whitespace-nowrap align-middle">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 accent-ks-green cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 whitespace-nowrap align-middle">#</th>
                    {showCol('thumbnail') && <th className="px-4 py-3 whitespace-nowrap align-middle"></th>}
                    <th className="px-4 py-3 whitespace-nowrap align-middle">{tr.colName}</th>
                    {showCol('creator') && <th className="px-4 py-3 whitespace-nowrap align-middle">Creator</th>}
                    {showCol('status') && <th className="px-4 py-3 whitespace-nowrap align-middle">{tr.colStatus}</th>}
                    {showCol('category') && <th className="px-4 py-3 whitespace-nowrap align-middle">{tr.colCategory}</th>}
                    {showCol('agency') && <th className="px-4 py-3 whitespace-nowrap align-middle">{lang === 'cn' ? '服务商' : 'Agency'}</th>}
                    {showCol('goal') && <SortableTh col={colSortKey['goal']} right>{tr.colGoal}</SortableTh>}
                    {showCol('pledged') && <SortableTh col={colSortKey['usd_pledged']} right>{tr.colPledged}</SortableTh>}
                    {showCol('funded') && <SortableTh col={colSortKey['funding_rate']} right>{tr.colFunded}</SortableTh>}
                    {showCol('backers') && <SortableTh col={colSortKey['backers']} right>{tr.colBackers}</SortableTh>}
                    {showCol('days') && <th className="px-4 py-3 text-right whitespace-nowrap align-middle">{tr.colDays}</th>}
                    {showCol('deadline') && <th className="px-4 py-3 whitespace-nowrap align-middle">{lang === 'cn' ? '下线时间' : 'Closing'}</th>}
                    {showCol('country') && <th className="px-4 py-3 whitespace-nowrap align-middle">{tr.colCountry}</th>}
                    {showCol('launch') && <SortableTh col={colSortKey['launched']}>{tr.colLaunch}</SortableTh>}
                    {showCol('actions') && <th className="px-4 py-3 whitespace-nowrap align-middle"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {currentRows.map((p, i) => {
                    const rowNum = (page - 1) * 20 + i + 1;
                    const days = calcDays(p);
                    const money = projectMoney(p);
                    const ksUrl = p.source_url?.startsWith('https://www.kickstarter.com/projects/')
                      ? p.source_url : null;
                    const creatorUrl = p.creator_url || (p.creator_slug ? `https://www.kickstarter.com/profile/${p.creator_slug}` : null);
                    const selected = selectedIds.has(p.id);
                    return (
                      <tr key={p.id} className={`transition-colors ${selected ? 'bg-ks-green-light/40' : 'hover:bg-gray-50/80'}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => handleSelectRow(p)}
                            className="rounded border-gray-300 accent-ks-green cursor-pointer"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <RowBadge n={rowNum} />
                        </td>
                        {showCol('thumbnail') && (
                          <td className="px-4 py-3">
                            <Link href={`/projects/${p.id}`} target="_blank" rel="noopener noreferrer" className="block h-10 w-16 overflow-hidden rounded-md bg-gray-100">
                              {p.image_thumb_url || p.image_url ? (
                                <ImagePreview src={p.image_thumb_url || p.image_url} className="block h-full w-full">
                                  <img src={p.image_thumb_url || p.image_url || ''} alt="" className="h-full w-full object-cover" />
                                </ImagePreview>
                              ) : (
                                <div className="h-full w-full bg-gray-100" />
                              )}
                            </Link>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <Link href={`/projects/${p.id}`} target="_blank" rel="noopener noreferrer" className="group block">
                            <div className="font-medium text-gray-900 max-w-xs truncate group-hover:text-ks-green transition-colors">{p.name}</div>
                            <div className="text-xs text-gray-400 max-w-xs truncate mt-0.5">{p.blurb}</div>
                          </Link>
                        </td>
                        {showCol('creator') && <td className="px-4 py-3">
                          {p.creator_name && creatorUrl ? (
                            <a href={creatorUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex max-w-[8rem] items-center gap-1 text-xs font-medium text-gray-600 hover:text-ks-green transition-colors">
                              <span className="truncate">{p.creator_name}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          ) : (
                            <span className="block max-w-[8rem] truncate text-xs text-gray-400">{p.creator_name || '-'}</span>
                          )}
                        </td>}
                        {showCol('status') && <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATE_BADGE[p.state] ?? 'bg-gray-100 text-gray-600'}`}>
                            {stateTr[p.state as keyof typeof stateTr] ?? p.state}
                          </span>
                          {p.staff_pick === 1 && (
                            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-yellow-50 text-yellow-600">{tr.staffPick}</span>
                          )}
                        </td>}
                        {showCol('category') && <td className="px-4 py-3">
                          <div className="text-xs text-gray-700 font-medium">{p.category_parent}</div>
                          <div className="text-xs text-gray-400">{p.category_name}</div>
                        </td>}
                        {showCol('agency') && <td className="px-4 py-3">
                          {p.has_service_agency ? (
                            <span className="inline-flex max-w-[9rem] items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                              <span className="truncate">{p.service_agency_name || (lang === 'cn' ? '已识别服务商' : 'Agency detected')}</span>
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>}
                        {showCol('goal') && <td className="px-4 py-3 text-right font-mono text-gray-500 text-xs">{fmtMoney(money.goal, money.currency)}</td>}
                        {showCol('pledged') && <td className="px-4 py-3 text-right">
                          <div className="font-mono text-gray-900 font-semibold">
                            {fmtMoney(money.pledged, money.currency)}
                          </div>
                          {p.live_pledged_usd != null && p.live_captured_at && (
                            <div className="text-xs text-blue-500 mt-0.5 flex items-center justify-end gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                              {lang === 'cn' ? '实时' : 'live'}
                            </div>
                          )}
                        </td>}
                        {showCol('funded') && <td className="px-4 py-3 text-right">
                          {(() => {
                            const fundingRate = money.goal > 0 ? (money.pledged / money.goal) * 100 : 0;
                            return (
                              <span className={`font-semibold text-xs ${fundingRate >= 100 ? 'text-ks-green' : 'text-gray-500'}`}>
                                {fundingRate >= 1000 ? '>1000' : fundingRate.toFixed(0)}%
                              </span>
                            );
                          })()}
                        </td>}
                        {showCol('backers') && <td className="px-4 py-3 text-right text-gray-600">
                          {(p.live_backers_count ?? p.backers_count).toLocaleString()}
                        </td>}
                        {showCol('days') && <td className="px-4 py-3 text-right">
                          {days !== null ? (
                            <span className={`text-xs font-medium ${p.state === 'live' ? 'text-blue-600' : 'text-gray-500'}`}>
                              {days}{p.state === 'live' ? ' ↑' : ''}
                            </span>
                          ) : '—'}
                        </td>}
                        {showCol('deadline') && <td className="px-4 py-3 whitespace-nowrap">
                          {(() => {
                            const closing = closingInfo(p, lang);
                            if (!closing) return <span className="text-xs text-gray-300">—</span>;
                            if (closing.ended) return <span className="text-xs text-gray-400">{closing.text}</span>;
                            return (
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${closing.urgent ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}>
                                {closing.text}
                              </span>
                            );
                          })()}
                        </td>}
                        {showCol('country') && <td className="px-4 py-3 text-gray-500 text-xs">{p.country}</td>}
                        {showCol('launch') && <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmtDate(p.launched_at)}</td>}
                        {showCol('actions') && <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => toggleFavorite(p.id)}
                              className={`transition-colors ${favoriteIds.has(p.id) ? 'text-red-500 hover:text-red-400' : 'text-gray-300 hover:text-red-400'}`}
                              title={t[lang].auth.loginToFavorite}
                            >
                              <Heart className={`w-4 h-4 ${favoriteIds.has(p.id) ? 'fill-current' : ''}`} />
                            </button>
                            {ksUrl && (
                              <a href={ksUrl} target="_blank" rel="noopener noreferrer"
                                className="text-gray-300 hover:text-ks-green transition-colors">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                        </td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                <span className="text-sm text-gray-400">{tr.pageOf(page, totalPages)}</span>
                <div className="flex gap-2">
                  <button onClick={() => gate(() => setPage(p => Math.max(1, p - 1)))} disabled={page <= 1}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => gate(() => setPage(p => Math.min(totalPages, p + 1)))} disabled={page >= totalPages}
                    className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
