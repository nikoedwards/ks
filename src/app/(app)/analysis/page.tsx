'use client';

import { useEffect, useState, useCallback } from 'react';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';

// ── Types ────────────────────────────────────────────────────────────────────

interface CategoryRow {
  category: string;
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  total_pledged_m: number;
  avg_pledged: number;
  total_backers: number;
}

interface TrendRow {
  month: string;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
}

interface CountryRow {
  country: string;
  country_name: string;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
  total_backers: number;
}

// ── Period helper ─────────────────────────────────────────────────────────────

const YEAR_PRESETS = ['2025', '2024', '2023', '2022', '2021', '2020', '2019'] as const;

function yearRange(y: string): { dateFrom: number; dateTo: number } {
  const dateFrom = Math.floor(new Date(`${y}-01-01T00:00:00Z`).getTime() / 1000);
  const dateTo   = Math.floor(new Date(`${y}-12-31T23:59:59Z`).getTime() / 1000);
  return { dateFrom, dateTo };
}

function buildQuery(dateFrom?: number, dateTo?: number): string {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', String(dateFrom));
  if (dateTo)   params.set('dateTo',   String(dateTo));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = 'categories' | 'trends' | 'countries';
type Period = 'all' | typeof YEAR_PRESETS[number] | 'custom';

export default function AnalysisPage() {
  const [lang] = useLanguage();
  const tr = t[lang].analysis;
  const tCat = t[lang].categories;
  const tTrend = t[lang].trends;
  const tCoun = t[lang].countries;

  const { user, showLogin } = useAuth();
  const gate = (fn: () => void) => { if (user) { fn(); return; } showLogin(fn); };

  const [tab, setTab] = useState<Tab>('categories');
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [trends, setTrends]         = useState<TrendRow[]>([]);
  const [countries, setCountries]   = useState<CountryRow[]>([]);
  const [loading, setLoading]       = useState(false);
  const [empty, setEmpty]           = useState(false);

  const getDateRange = useCallback((): { dateFrom?: number; dateTo?: number } => {
    if (period === 'all') return {};
    if (period === 'custom') {
      const dateFrom = customFrom ? Math.floor(new Date(customFrom + 'T00:00:00Z').getTime() / 1000) : undefined;
      const dateTo   = customTo   ? Math.floor(new Date(customTo   + 'T23:59:59Z').getTime() / 1000) : undefined;
      return { dateFrom, dateTo };
    }
    return yearRange(period);
  }, [period, customFrom, customTo]);

  const fetchAll = useCallback(() => {
    const { dateFrom, dateTo } = getDateRange();
    const qs = buildQuery(dateFrom, dateTo);
    setLoading(true);
    setEmpty(false);

    Promise.all([
      fetch(`/api/categories${qs}`).then(r => r.json()),
      fetch(`/api/trends${qs}`).then(r => r.json()),
      fetch(`/api/countries${qs}`).then(r => r.json()),
    ]).then(([cat, trend, coun]) => {
      const catData   = cat.data   ?? [];
      const trendData = trend.data ?? [];
      const counData  = coun.data  ?? [];
      setCategories(catData);
      setTrends(trendData);
      setCountries(counData);
      if (!catData.length && !trendData.length && !counData.length) setEmpty(true);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [getDateRange]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Period filter UI ────────────────────────────────────────────────────────

  const periodBar = (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide mr-1">{tr.period}</span>

        <button
          onClick={() => gate(() => setPeriod('all'))}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === 'all' ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {tr.allTime}
        </button>

        {YEAR_PRESETS.map(y => (
          <button
            key={y}
            onClick={() => gate(() => setPeriod(y))}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === y ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {y}
          </button>
        ))}

        <button
          onClick={() => gate(() => setPeriod('custom'))}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${period === 'custom' ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >
          {tr.customRange}
        </button>

        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-1">
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-ks-green"
              placeholder={tr.from}
            />
            <span className="text-gray-400 text-xs">—</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-ks-green"
              placeholder={tr.to}
            />
          </div>
        )}
      </div>
    </div>
  );

  // ── Tab bar ─────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: 'categories', label: tr.tabCategories },
    { key: 'trends',     label: tr.tabTrends },
    { key: 'countries',  label: tr.tabCountries },
  ];

  const tabBar = (
    <div className="flex gap-1 border-b border-gray-100">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setTab(key)}
          className={`px-5 py-3 text-sm font-semibold transition-all border-b-2 -mb-px ${
            tab === key
              ? 'border-ks-green text-ks-green'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  // ── Loading / empty ─────────────────────────────────────────────────────────

  if (loading) return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>
      {periodBar}
      <div className="flex items-center justify-center h-48 text-gray-400">
        {lang === 'cn' ? '加载中...' : 'Loading...'}
      </div>
    </div>
  );

  if (empty) return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>
      {periodBar}
      <EmptyState />
    </div>
  );

  // ── Category tab ────────────────────────────────────────────────────────────

  const top12 = categories.slice(0, 12);

  const categoryContent = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'success_rate', name: tCat.rate, color: '#05CE78' }]}
          title={tCat.chartRate}
          yFormatter={v => `${v}%`}
          height={320}
        />
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'total_pledged_m', name: tCat.raised, color: '#3B82F6' }]}
          title={tCat.chartRaised}
          yFormatter={v => `$${v}M`}
          height={320}
        />
      </div>
      <BarChart
        data={top12}
        xKey="category"
        bars={[
          { key: 'total',      name: tCat.total,      color: '#6366F1' },
          { key: 'successful', name: tCat.successful, color: '#05CE78' },
          { key: 'failed',     name: tCat.failed,     color: '#EF4444' },
        ]}
        title={tCat.chartDist}
        height={320}
      />
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tCat.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tCat.colCategory}</th>
                <th className="px-5 py-3 text-right">{tCat.colTotal}</th>
                <th className="px-5 py-3 text-right">{tCat.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tCat.colFailed}</th>
                <th className="px-5 py-3 text-right">{tCat.colRate}</th>
                <th className="px-5 py-3 text-right">{tCat.colRaised}</th>
                <th className="px-5 py-3 text-right">{tCat.colAvg}</th>
                <th className="px-5 py-3 text-right">{tCat.colBackers}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {categories.map(row => (
                <tr key={row.category} className="hover:bg-gray-50/80">
                  <td className="px-5 py-3 font-medium text-gray-900">{row.category}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-ks-green font-medium">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-red-500">{row.failed.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-semibold ${row.success_rate >= 40 ? 'text-ks-green' : row.success_rate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
                      {row.success_rate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700">${row.total_pledged_m}M</td>
                  <td className="px-5 py-3 text-right text-gray-600">${Number(row.avg_pledged).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{Number(row.total_backers).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Trends tab ──────────────────────────────────────────────────────────────

  const totalMax = trends.length ? Math.max(...trends.map(d => d.total)) : 1;
  const trendSummary = trends.length ? {
    avgSuccess:    (trends.reduce((s, d) => s + d.success_rate, 0) / trends.length).toFixed(1),
    peakMonth:     trends.reduce((a, b) => (a.total > b.total ? a : b), trends[0])?.month ?? '—',
    totalProjects: trends.reduce((s, d) => s + d.total, 0).toLocaleString(),
  } : { avgSuccess: '—', peakMonth: '—', totalProjects: '—' };

  const trendsContent = (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: tTrend.months,       value: `${trends.length}${tTrend.monthsUnit}` },
          { label: tTrend.totalProjects, value: trendSummary.totalProjects },
          { label: tTrend.avgSuccess,   value: `${trendSummary.avgSuccess}%` },
          { label: tTrend.peakMonth,    value: trendSummary.peakMonth },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1.5">{c.value}</p>
          </div>
        ))}
      </div>
      <LineChart
        data={trends}
        xKey="month"
        lines={[
          { key: 'total',      name: tTrend.launches,  color: '#3B82F6' },
          { key: 'successful', name: tTrend.successes, color: '#05CE78' },
        ]}
        title={tTrend.chartTitle}
        height={320}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LineChart
          data={trends}
          xKey="month"
          lines={[{ key: 'success_rate', name: tTrend.successRate, color: '#8B5CF6' }]}
          title={tTrend.rateTitle}
          yFormatter={v => `${v}%`}
          height={280}
        />
        <LineChart
          data={trends}
          xKey="month"
          lines={[{ key: 'total_pledged_m', name: tTrend.raisedName, color: '#F59E0B' }]}
          title={tTrend.raisedTitle}
          yFormatter={v => `$${v}M`}
          height={280}
        />
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tTrend.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tTrend.colMonth}</th>
                <th className="px-5 py-3 text-right">{tTrend.colLaunches}</th>
                <th className="px-5 py-3 text-right">{tTrend.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tTrend.colRate}</th>
                <th className="px-5 py-3 text-right">{tTrend.colRaised}</th>
                <th className="px-5 py-3">{tTrend.colShare}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...trends].reverse().map(row => (
                <tr key={row.month} className="hover:bg-gray-50/80">
                  <td className="px-5 py-3 font-medium text-gray-900">{row.month}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-ks-green font-medium">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-semibold ${row.success_rate >= 40 ? 'text-ks-green' : 'text-amber-500'}`}>
                      {row.success_rate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700">${row.total_pledged_m}M</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="bg-ks-green h-1.5 rounded-full" style={{ width: `${(row.total / totalMax) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-400 w-8 text-right">{Math.round((row.total / totalMax) * 100)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Countries tab ───────────────────────────────────────────────────────────

  const top10 = countries.slice(0, 10);

  const countriesContent = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top10}
          xKey="country"
          bars={[
            { key: 'total',      name: tCoun.total,      color: '#3B82F6' },
            { key: 'successful', name: tCoun.successful, color: '#05CE78' },
          ]}
          title={tCoun.chartCount}
          height={320}
        />
        <BarChart
          data={top10}
          xKey="country"
          bars={[{ key: 'success_rate', name: tCoun.rate, color: '#8B5CF6' }]}
          title={tCoun.chartRate}
          yFormatter={v => `${v}%`}
          height={320}
        />
      </div>
      <BarChart
        data={top10}
        xKey="country"
        bars={[{ key: 'total_pledged_m', name: tCoun.raised, color: '#F59E0B' }]}
        title={tCoun.chartRaised}
        yFormatter={v => `$${v}M`}
        height={300}
      />
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tCoun.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tCoun.colRank}</th>
                <th className="px-5 py-3">{tCoun.colCountry}</th>
                <th className="px-5 py-3 text-right">{tCoun.colTotal}</th>
                <th className="px-5 py-3 text-right">{tCoun.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tCoun.colRate}</th>
                <th className="px-5 py-3 text-right">{tCoun.colRaised}</th>
                <th className="px-5 py-3 text-right">{tCoun.colBackers}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {countries.map((row, i) => (
                <tr key={row.country} className="hover:bg-gray-50/80">
                  <td className="px-5 py-3 text-gray-400 font-medium">#{i + 1}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{row.country_name || row.country}</div>
                    <div className="text-xs text-gray-400">{row.country}</div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-ks-green font-medium">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-semibold ${row.success_rate >= 40 ? 'text-ks-green' : row.success_rate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
                      {row.success_rate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700">${row.total_pledged_m}M</td>
                  <td className="px-5 py-3 text-right text-gray-600">{Number(row.total_backers).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      {periodBar}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 pt-1">{tabBar}</div>
        <div className="p-5">
          {tab === 'categories' && categoryContent}
          {tab === 'trends'     && trendsContent}
          {tab === 'countries'  && countriesContent}
        </div>
      </div>

      <DataSource />
    </div>
  );
}
