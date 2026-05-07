'use client';

import { useEffect, useState } from 'react';
import StatCard from '@/components/StatCard';
import PieChart from '@/components/charts/PieChart';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

const STATE_COLORS: Record<string, string> = {
  successful: '#05CE78',
  failed: '#EF4444',
  live: '#3B82F6',
  canceled: '#F59E0B',
  suspended: '#8B5CF6',
};

export default function DashboardPage() {
  const [lang] = useLanguage();
  const tr = t[lang].dashboard;
  const stateTr = t[lang].states;

  const [statsData, setStatsData] = useState<{ stats: Record<string, number>; stateDistribution: { state: string; count: number }[] } | null>(null);
  const [catData, setCatData] = useState<object[]>([]);
  const [trendData, setTrendData] = useState<object[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/categories').then(r => r.json()),
      fetch('/api/trends').then(r => r.json()),
    ]).then(([s, c, tnd]) => {
      if (s.empty) { setEmpty(true); setLoading(false); return; }
      setStatsData(s);
      setCatData((c.data ?? []).slice(0, 12));
      setTrendData((tnd.data ?? []).slice(-24));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{lang === 'cn' ? '加载中...' : 'Loading...'}</div>;
  if (empty) return <EmptyState />;
  if (!statsData) return null;

  const { stats, stateDistribution } = statsData;

  const pieData = stateDistribution.map(d => ({
    name: stateTr[d.state as keyof typeof stateTr] ?? d.state,
    value: d.count,
    color: STATE_COLORS[d.state],
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={tr.totalProjects} value={Number(stats.total).toLocaleString()} sub={tr.totalProjectsSub} />
        <StatCard title={tr.successRate} value={`${stats.success_rate ?? 0}%`} sub={tr.successRateSub(Number(stats.successful).toLocaleString())} accent />
        <StatCard title={tr.totalRaised} value={`$${stats.total_pledged_usd ?? 0}M`} sub={tr.totalRaisedSub} />
        <StatCard title={tr.avgBackers} value={Number(stats.avg_backers ?? 0).toLocaleString()} sub={tr.avgBackersSub} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PieChart data={pieData} title={tr.statusDist} />
        <BarChart
          data={catData}
          xKey="category"
          bars={[{ key: 'success_rate', name: tr.successRatePct, color: '#05CE78' }]}
          title={tr.categoryRate}
          yFormatter={v => `${v}%`}
          height={280}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LineChart
          data={trendData}
          xKey="month"
          lines={[
            { key: 'total', name: tr.launches, color: '#3B82F6' },
            { key: 'successful', name: tr.successes, color: '#05CE78' },
          ]}
          title={tr.trendTitle}
          height={280}
        />
        <LineChart
          data={trendData}
          xKey="month"
          lines={[{ key: 'success_rate', name: tr.successRatePct, color: '#8B5CF6' }]}
          title={tr.trendSuccessTitle}
          yFormatter={v => `${v}%`}
          height={280}
        />
      </div>

      <BarChart
        data={catData}
        xKey="category"
        bars={[
          { key: 'total', name: tr.totalCount, color: '#3B82F6' },
          { key: 'successful', name: tr.successCount, color: '#05CE78' },
        ]}
        title={tr.categoryCount}
        height={300}
      />

      <DataSource />
    </div>
  );
}
