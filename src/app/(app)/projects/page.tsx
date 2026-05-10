'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, ChevronLeft, ChevronRight, Download, ArrowUp, ArrowDown, ArrowUpDown, Heart } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
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
  category_parent: string;
  category_name: string;
  goal: number;
  pledged: number;
  usd_pledged: number;
  backers_count: number;
  staff_pick: number;
  launched_at: number;
  deadline: number;
  source_url: string;
  slug: string;
  data_source?: string;
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
};

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
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

function exportCsv(rows: Project[], filename = 'kicksonar-export.csv') {
  const headers = ['#', 'ID', 'Name', 'State', 'Category', 'Goal (USD)', 'Pledged (USD)', 'Funded %', 'Backers', 'Days', 'Country', 'Launched', 'URL'];
  const csvRows = rows.map((p, i) => {
    const fundingRate = p.goal > 0 ? ((p.usd_pledged / p.goal) * 100).toFixed(1) : '0';
    const days = calcDays(p) ?? '';
    const launched = p.launched_at ? new Date(p.launched_at * 1000).toISOString().slice(0, 10) : '';
    const url = p.source_url?.startsWith('https://www.kickstarter.com/projects/') ? p.source_url : '';
    return [
      i + 1, p.id,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      p.state, p.category_parent,
      p.goal, p.usd_pledged, fundingRate,
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

export default function ProjectsPage() {
  const [lang] = useLanguage();
  const tr = t[lang].projects;
  const stateTr = t[lang].states;
  const { user, showLogin } = useAuth();

  const [data, setData] = useState<{ total: number; rows: Project[]; categories: string[]; countries: { country: string; country_name: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('usd_pledged');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // URL state persistence — read on mount
  const urlInitDone = useRef(false);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('search')) setSearch(sp.get('search')!);
    if (sp.get('state')) setState(sp.get('state')!);
    if (sp.get('category')) setCategory(sp.get('category')!);
    if (sp.get('country')) setCountry(sp.get('country')!);
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
    if (state !== 'all') params.set('state', state);
    if (category) params.set('category', category);
    if (country) params.set('country', country);
    if (sort !== 'usd_pledged') params.set('sort', sort);
    if (sortDir !== 'desc') params.set('sortDir', sortDir);
    if (page !== 1) params.set('page', String(page));
    if (timePeriod !== 'all') params.set('timePeriod', timePeriod);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
  }, [search, state, category, country, sort, sortDir, page, timePeriod, dateFrom, dateTo]);

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
      ...(country ? { country } : {}),
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
  }, [page, sort, sortDir, state, category, country, search, timePeriod, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(); };

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
      className={`px-4 py-3 ${right ? 'text-right' : ''} cursor-pointer select-none hover:text-gray-600 transition-colors`}
      onClick={() => gate(() => handleColumnSort(col))}
    >
      <span className="inline-flex items-center gap-0.5">
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
            <select value={category} onChange={e => gate(() => { setCategory(e.target.value); setPage(1); })} className={selectCls}>
              <option value="">{tr.allCategories}</option>
              {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
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
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.sortLabel}</label>
            <select value={sort} onChange={e => gate(() => { setSort(e.target.value); setSortDir('desc'); setPage(1); })} className={selectCls}>
              {(Object.keys(tr.sorts) as (keyof typeof tr.sorts)[]).map(k => (
                <option key={k} value={k}>{tr.sorts[k]}</option>
              ))}
            </select>
          </div>

          <button type="submit"
            className="bg-ks-green hover:bg-ks-green-dark text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm">
            {tr.searchBtn}
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
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                {selectedIds.size > 0 ? tr.exportSelected(selectedIds.size) : tr.exportPage}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    <th className="px-4 py-3 w-8">
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        ref={el => { if (el) el.indeterminate = somePageSelected && !allPageSelected; }}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300 accent-ks-green cursor-pointer"
                      />
                    </th>
                    <th className="px-4 py-3 w-10">#</th>
                    <th className="px-4 py-3">{tr.colName}</th>
                    <th className="px-4 py-3">{tr.colStatus}</th>
                    <th className="px-4 py-3">{tr.colCategory}</th>
                    <SortableTh col={colSortKey['goal']} right>{tr.colGoal}</SortableTh>
                    <SortableTh col={colSortKey['usd_pledged']} right>{tr.colPledged}</SortableTh>
                    <SortableTh col={colSortKey['funding_rate']} right>{tr.colFunded}</SortableTh>
                    <SortableTh col={colSortKey['backers']} right>{tr.colBackers}</SortableTh>
                    <th className="px-4 py-3 text-right">{tr.colDays}</th>
                    <th className="px-4 py-3">{tr.colCountry}</th>
                    <SortableTh col={colSortKey['launched']}>{tr.colLaunch}</SortableTh>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {currentRows.map((p, i) => {
                    const rowNum = (page - 1) * 20 + i + 1;
                    const days = calcDays(p);
                    const ksUrl = p.source_url?.startsWith('https://www.kickstarter.com/projects/')
                      ? p.source_url : null;
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
                        <td className="px-4 py-3">
                          <Link href={`/projects/${p.id}`} className="group block">
                            <div className="font-medium text-gray-900 max-w-xs truncate group-hover:text-ks-green transition-colors">{p.name}</div>
                            <div className="text-xs text-gray-400 max-w-xs truncate mt-0.5">{p.blurb}</div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${STATE_BADGE[p.state] ?? 'bg-gray-100 text-gray-600'}`}>
                            {stateTr[p.state as keyof typeof stateTr] ?? p.state}
                          </span>
                          {p.staff_pick === 1 && (
                            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-yellow-50 text-yellow-600">{tr.staffPick}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-gray-700 font-medium">{p.category_parent}</div>
                          <div className="text-xs text-gray-400">{p.category_name}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-500 text-xs">{fmtUsd(p.goal)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="font-mono text-gray-900 font-semibold">
                            {fmtUsd(p.live_pledged_usd ?? p.usd_pledged)}
                          </div>
                          {p.live_pledged_usd != null && p.live_captured_at && (
                            <div className="text-xs text-blue-500 mt-0.5 flex items-center justify-end gap-1">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                              {lang === 'cn' ? '实时' : 'live'}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const pledged = p.live_pledged_usd ?? p.usd_pledged;
                            const fundingRate = p.goal > 0 ? (pledged / p.goal) * 100 : 0;
                            return (
                              <span className={`font-semibold text-xs ${fundingRate >= 100 ? 'text-ks-green' : 'text-gray-500'}`}>
                                {fundingRate >= 1000 ? '>1000' : fundingRate.toFixed(0)}%
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {(p.live_backers_count ?? p.backers_count).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {days !== null ? (
                            <span className={`text-xs font-medium ${p.state === 'live' ? 'text-blue-600' : 'text-gray-500'}`}>
                              {days}{p.state === 'live' ? ' ↑' : ''}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{p.country}</td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap text-xs">{fmtDate(p.launched_at)}</td>
                        <td className="px-4 py-3">
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
                        </td>
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

      <DataSource />
    </div>
  );
}
