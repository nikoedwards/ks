'use client';

import { useEffect, useState, useCallback } from 'react';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import PieChart from '@/components/charts/PieChart';
import StatCard from '@/components/StatCard';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t, uiCopy } from '@/lib/i18n';
import PlatformPicker, { type PlatformView } from '@/components/PlatformPicker';
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

interface TimeRow {
  year: string;
  total: number;
  successful: number;
  failed: number;
  success_rate: number;
  total_pledged_m: number;
  total_backers: number;
}

interface TimeMonthRow {
  year: string;
  month: number;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
  total_backers: number;
}

type TimeDimension = 'pledged' | 'count' | 'success_rate' | 'backers';
type TimeScope = 'year' | 'month';

interface StatsResponse {
  stats: Record<string, number>;
  stateDistribution: { state: string; count: number }[];
}

const STATE_COLORS: Record<string, string> = {
  successful: '#05CE78',
  failed: '#EF4444',
  live: '#3B82F6',
  canceled: '#F59E0B',
  suspended: '#8B5CF6',
};

// ── Period helper ─────────────────────────────────────────────────────────────

const YEAR_PRESETS = ['2025', '2024', '2023', '2022', '2021', '2020', '2019'] as const;

function yearRange(y: string): { dateFrom: number; dateTo: number } {
  const dateFrom = Math.floor(new Date(`${y}-01-01T00:00:00Z`).getTime() / 1000);
  const dateTo   = Math.floor(new Date(`${y}-12-31T23:59:59Z`).getTime() / 1000);
  return { dateFrom, dateTo };
}

function buildQuery(dateFrom?: number, dateTo?: number, platform?: string): string {
  const params = new URLSearchParams();
  if (dateFrom) params.set('dateFrom', String(dateFrom));
  if (dateTo)   params.set('dateTo',   String(dateTo));
  if (platform) params.set('platform', platform);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ── Component ─────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'categories' | 'trends' | 'countries' | 'time';
type Period = 'all' | typeof YEAR_PRESETS[number] | 'custom';

export default function AnalysisPage() {
  const [lang] = useLanguage();
  const tr = t[lang].analysis;
  const tCat = t[lang].categories;
  const tTrend = t[lang].trends;
  const tCoun = t[lang].countries;
  const tDash = t[lang].dashboard;
  const stateTr = t[lang].states;
  const copy = uiCopy[lang].analysis;

  const { user, showLogin } = useAuth();
  const gate = (fn: () => void) => { if (user) { fn(); return; } showLogin(fn); };

  const [tab, setTab] = useState<Tab>('overview');
  const [platform, setPlatform] = useState<PlatformView>('kickstarter');
  const [period, setPeriod] = useState<Period>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]   = useState('');

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [trends, setTrends]         = useState<TrendRow[]>([]);
  const [countries, setCountries]   = useState<CountryRow[]>([]);
  const [timeRows, setTimeRows]     = useState<TimeRow[]>([]);
  const [timeMonthly, setTimeMonthly] = useState<TimeMonthRow[]>([]);
  const [timeCategory, setTimeCategory] = useState('');
  const [timeCountry, setTimeCountry] = useState('');
  const [compareA, setCompareA] = useState('2024');
  const [compareB, setCompareB] = useState('2025');
  const [timeDimension, setTimeDimension] = useState<TimeDimension>('pledged');
  const [timeScope, setTimeScope] = useState<TimeScope>('year');
  const [timeMonth, setTimeMonth] = useState(1);
  const [statsData, setStatsData]   = useState<StatsResponse | null>(null);
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
    const { dateFrom, dateTo } = tab === 'time' ? {} : getDateRange();
    const qs = buildQuery(dateFrom, dateTo, platform);
    setLoading(true);
    setEmpty(false);

    Promise.all([
      fetch(`/api/stats${qs}`).then(r => r.json()),
      fetch(`/api/categories${qs}`).then(r => r.json()),
      fetch(`/api/trends${qs}`).then(r => r.json()),
      fetch(`/api/countries${qs}`).then(r => r.json()),
      fetch(`/api/analysis/time?${new URLSearchParams({
        ...(timeCategory ? { categoryParent: timeCategory } : {}),
        ...(timeCountry ? { country: timeCountry } : {}),
      }).toString()}`).then(r => r.json()),
    ]).then(([stats, cat, trend, coun, time]) => {
      const catData   = cat.data   ?? [];
      const trendData = trend.data ?? [];
      const counData  = coun.data  ?? [];
      setStatsData(stats.empty ? null : stats);
      setCategories(catData);
      setTrends(trendData);
      setCountries(counData);
      setTimeRows(time.data ?? []);
      setTimeMonthly(time.monthly ?? []);
      if (!stats?.stats && !catData.length && !trendData.length && !counData.length) setEmpty(true);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [getDateRange, tab, platform, timeCategory, timeCountry]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Period filter UI ────────────────────────────────────────────────────────

  const globalPeriodDisabled = tab === 'time';
  const periodButtonClass = (active: boolean) => globalPeriodDisabled
    ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
    : active
      ? 'bg-ks-green text-white'
      : 'bg-gray-100 text-gray-600 hover:bg-gray-200';
  const periodBar = (
    <div className={`bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 ${globalPeriodDisabled ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide mr-1">{tr.period}</span>

        <button
          disabled={globalPeriodDisabled}
          onClick={() => gate(() => setPeriod('all'))}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${periodButtonClass(period === 'all')}`}
        >
          {tr.allTime}
        </button>

        {YEAR_PRESETS.map(y => (
          <button
            key={y}
            disabled={globalPeriodDisabled}
            onClick={() => gate(() => setPeriod(y))}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${periodButtonClass(period === y)}`}
          >
            {y}
          </button>
        ))}

        <button
          disabled={globalPeriodDisabled}
          onClick={() => gate(() => setPeriod('custom'))}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${periodButtonClass(period === 'custom')}`}
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

  const changePlatform = (next: PlatformView) => gate(() => { if (next !== platform) setPlatform(next); });

  const platformBar = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{lang === 'cn' || lang === 'zh-tw' ? '平台' : 'Platform'}</span>
      <PlatformPicker value={platform} onChange={changePlatform} cn={lang === 'cn' || lang === 'zh-tw'} />
    </div>
  );

  // ── Tab bar ─────────────────────────────────────────────────────────────────

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: copy.overview },
    { key: 'categories', label: tr.tabCategories },
    { key: 'trends',     label: tr.tabTrends },
    { key: 'countries',  label: tr.tabCountries },
    { key: 'time',       label: copy.timeAnalysis },
  ];

  const tabBar = (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-100 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => (key === 'overview' ? setTab(key) : gate(() => setTab(key)))}
          className={`shrink-0 whitespace-nowrap px-3 py-3 text-sm font-semibold transition-all border-b-2 -mb-px sm:px-5 ${
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
      {platformBar}
      {periodBar}
      <div className="flex items-center justify-center h-48 text-gray-400">
        {uiCopy[lang].common.loading}
      </div>
    </div>
  );

  if (empty) return (
    <div className="max-w-7xl mx-auto space-y-5">
      {platformBar}
      {periodBar}
      <EmptyState />
    </div>
  );

  // ── Category tab ────────────────────────────────────────────────────────────

  const top12 = categories.slice(0, 12);

  const overviewContent = statsData ? (() => {
    const { stats, stateDistribution } = statsData;
    const pieData = stateDistribution.map(d => ({
      name: stateTr[d.state as keyof typeof stateTr] ?? d.state,
      value: d.count,
      color: STATE_COLORS[d.state],
    }));
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title={tDash.totalProjects} value={Number(stats.total ?? 0).toLocaleString()} sub={tDash.totalProjectsSub} />
          <StatCard title={tDash.successRate} value={`${stats.success_rate ?? 0}%`} sub={tDash.successRateSub(Number(stats.successful ?? 0).toLocaleString())} accent />
          <StatCard title={tDash.totalRaised} value={`$${stats.total_pledged_usd ?? 0}M`} sub={tDash.totalRaisedSub} />
          <StatCard title={tDash.avgBackers} value={Number(stats.avg_backers ?? 0).toLocaleString()} sub={tDash.avgBackersSub} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <PieChart data={pieData} title={tDash.statusDist} />
          <BarChart
            data={top12}
            xKey="category"
            bars={[{ key: 'success_rate', name: tDash.successRatePct, color: '#05CE78' }]}
            title={tDash.categoryRate}
            yFormatter={v => `${v}%`}
            height={280}
          />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <LineChart
            data={trends}
            xKey="month"
            lines={[
              { key: 'total', name: tDash.launches, color: '#3B82F6' },
              { key: 'successful', name: tDash.successes, color: '#05CE78' },
            ]}
            title={tDash.trendTitle}
            height={280}
          />
          <LineChart
            data={trends}
            xKey="month"
            lines={[{ key: 'success_rate', name: tDash.successRatePct, color: '#8B5CF6' }]}
            title={tDash.trendSuccessTitle}
            yFormatter={v => `${v}%`}
            height={280}
          />
        </div>
      </div>
    );
  })() : null;

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

  const timeYears = timeRows.map(r => r.year).filter(Boolean).sort();
  const aRow = timeRows.find(r => r.year === compareA);
  const bRow = timeRows.find(r => r.year === compareB);

  // ── Dimension metadata: the user picks ONE dimension to compare across the two
  //    years, so we keep a single focused curve instead of a wall of charts. The
  //    `key` works for both the yearly rows and the monthly rows (same columns).
  const monthLabel = (m: number) => copy.monthNames[m - 1] ?? String(m);

  const DIMS: { id: TimeDimension; label: string; color: string; key: keyof TimeMonthRow; fmt: (v: number) => string }[] = [
    { id: 'pledged', label: copy.pledged, color: '#F59E0B', key: 'total_pledged_m', fmt: v => `$${(v ?? 0).toFixed(v >= 100 ? 0 : 1)}M` },
    { id: 'count', label: copy.projects, color: '#3B82F6', key: 'total', fmt: v => Math.round(v ?? 0).toLocaleString() },
    { id: 'success_rate', label: copy.successRate, color: '#05CE78', key: 'success_rate', fmt: v => `${(v ?? 0).toFixed(1)}%` },
    { id: 'backers', label: copy.backers, color: '#6366F1', key: 'total_backers', fmt: v => Math.round(v ?? 0).toLocaleString() },
  ];
  const dim = DIMS.find(d => d.id === timeDimension) ?? DIMS[0];
  const dimKey = dim.key;
  const pick = (row: TimeRow | TimeMonthRow | undefined) =>
    row ? Number((row as unknown as Record<string, number>)[dimKey] ?? 0) : 0;

  // 12-month curve: same dimension, one line per year, so a glance reveals where the
  // YoY gap opens up month by month.
  const colorA = '#94A3B8';
  const colorB = dim.color;
  const monthlyChart = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const a = timeMonthly.find(r => r.year === compareA && r.month === m);
    const b = timeMonthly.find(r => r.year === compareB && r.month === m);
    return { month: monthLabel(m), [compareA]: pick(a), [compareB]: pick(b) };
  });

  // Headline numbers honor the scope (full year vs a single month).
  const valA = timeScope === 'year' ? pick(aRow) : pick(timeMonthly.find(r => r.year === compareA && r.month === timeMonth));
  const valB = timeScope === 'year' ? pick(bRow) : pick(timeMonthly.find(r => r.year === compareB && r.month === timeMonth));
  const deltaPct = valA > 0 ? ((valB - valA) / valA) * 100 : null;
  const deltaLabel = deltaPct == null ? 'N/A' : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
  const scopeLabel = timeScope === 'year' ? copy.fullYear : monthLabel(timeMonth);

  const segBtn = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${active ? 'bg-ks-green text-white shadow-sm' : 'text-gray-500 hover:bg-gray-200'}`;

  const timeContent = (
    <div className="space-y-5">
      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm space-y-4">
        {/* Years + scope */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-xs font-semibold text-gray-400">{copy.yearA}</span>
              <select value={compareA} onChange={e => setCompareA(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {timeYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <span className="pb-2 text-gray-300">vs</span>
            <label className="space-y-1">
              <span className="block text-xs font-semibold text-gray-400">{copy.yearB}</span>
              <select value={compareB} onChange={e => setCompareB(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                {timeYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <span className="block text-xs font-semibold text-gray-400">{copy.granularity}</span>
              <div className="flex rounded-lg bg-gray-100 p-1">
                <button onClick={() => setTimeScope('year')} className={segBtn(timeScope === 'year')}>{copy.fullYear}</button>
                <button onClick={() => setTimeScope('month')} className={segBtn(timeScope === 'month')}>{copy.byMonth}</button>
              </div>
            </div>
            {timeScope === 'month' && (
              <label className="space-y-1">
                <span className="block text-xs font-semibold text-gray-400">{copy.month}</span>
                <select value={timeMonth} onChange={e => setTimeMonth(Number(e.target.value))} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>

        {/* Dimension */}
        <div className="space-y-1">
          <span className="block text-xs font-semibold text-gray-400">{copy.dimension}</span>
          <div className="flex flex-wrap gap-2">
            {DIMS.map(d => (
              <button
                key={d.id}
                onClick={() => setTimeDimension(d.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  timeDimension === d.id ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={timeDimension === d.id ? { backgroundColor: d.color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: timeDimension === d.id ? '#fff' : d.color }} />
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Optional scoping filters */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-400">{copy.categoryOptional}</span>
            <select value={timeCategory} onChange={e => setTimeCategory(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="">{copy.allCategories}</option>
              {categories.map(c => <option key={c.category} value={c.category}>{c.category}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-semibold text-gray-400">{copy.countryOptional}</span>
            <select value={timeCountry} onChange={e => setTimeCountry(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <option value="">{copy.allCountries}</option>
              {countries.map(c => <option key={c.country} value={c.country}>{c.country_name || c.country}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* ── Headline comparison ───────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {copy.comparisonTitle(dim.label, scopeLabel)}
          </h3>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${
            deltaPct == null ? 'bg-gray-100 text-gray-400' : deltaPct >= 0 ? 'bg-ks-green-light text-ks-green-dark' : 'bg-red-50 text-red-600'
          }`}>
            {deltaPct != null && deltaPct >= 0 ? '↑' : deltaPct != null ? '↓' : ''} {deltaLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorA }} />{compareA} · {scopeLabel}
            </div>
            <p className="mt-1.5 text-2xl font-black text-gray-700">{dim.fmt(valA)}</p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: `${colorB}40`, backgroundColor: `${colorB}0d` }}>
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorB }} />{compareB} · {scopeLabel}
            </div>
            <p className="mt-1.5 text-2xl font-black" style={{ color: colorB }}>{dim.fmt(valB)}</p>
          </div>
        </div>
      </div>

      {/* ── 12-month comparison curve ─────────────────────────────────────── */}
      <LineChart
        data={monthlyChart}
        xKey="month"
        lines={[
          { key: compareA, name: compareA, color: colorA },
          { key: compareB, name: compareB, color: colorB },
        ]}
        title={copy.monthlyComparison(dim.label, Number(compareA), Number(compareB))}
        yFormatter={dim.fmt}
        height={320}
      />
    </div>
  );

  const cn = lang === 'cn' || lang === 'zh-tw';
  const timeNote = (
    <div className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-6 text-center text-sm text-amber-800">
      {cn
        ? '时间分析（按发起年月的成败队列）目前仅支持 Kickstarter。请切换到 Kickstarter 查看。'
        : 'Time analysis (launch-cohort success curves) is currently Kickstarter-only. Switch to Kickstarter to view it.'}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {platformBar}
      {periodBar}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-3 pt-1 sm:px-5">{tabBar}</div>
        <div className="p-3 sm:p-5">
          {tab === 'overview' && overviewContent}
          {tab === 'categories' && categoryContent}
          {tab === 'trends'     && trendsContent}
          {tab === 'countries'  && countriesContent}
          {tab === 'time'       && (platform === 'kickstarter' ? timeContent : timeNote)}
        </div>
      </div>

      <DataSource />
    </div>
  );
}
