'use client';

import { useEffect, useState } from 'react';
import StatCard from '@/components/StatCard';
import PieChart from '@/components/charts/PieChart';
import BarChart from '@/components/charts/BarChart';
import LineChart from '@/components/charts/LineChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';

const STATE_COLORS: Record<string, string> = {
  successful: '#05CE78',
  failed: '#EF4444',
  live: '#3B82F6',
  canceled: '#F59E0B',
  suspended: '#8B5CF6',
};

const STATE_LABELS: Record<string, string> = {
  successful: '成功',
  failed: '失败',
  live: '进行中',
  canceled: '已取消',
  suspended: '已暂停',
};

export default function DashboardPage() {
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
    ]).then(([s, c, t]) => {
      if (s.empty) { setEmpty(true); setLoading(false); return; }
      setStatsData(s);
      setCatData((c.data ?? []).slice(0, 12));
      setTrendData((t.data ?? []).slice(-24));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>;
  if (empty) return <EmptyState />;
  if (!statsData) return null;

  const { stats, stateDistribution } = statsData;

  const pieData = stateDistribution.map(d => ({
    name: STATE_LABELS[d.state] ?? d.state,
    value: d.count,
    color: STATE_COLORS[d.state],
  }));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">数据概览</h1>
        <p className="text-sm text-gray-500 mt-1">Kickstarter 众筹平台全量数据分析</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="总项目数" value={Number(stats.total).toLocaleString()} sub="全平台历史累计" />
        <StatCard title="项目成功率" value={`${stats.success_rate ?? 0}%`} sub={`${Number(stats.successful).toLocaleString()} 个项目成功`} accent />
        <StatCard title="总众筹金额" value={`$${stats.total_pledged_usd ?? 0}M`} sub="美元，历史累计" />
        <StatCard title="平均支持人数" value={Number(stats.avg_backers ?? 0).toLocaleString()} sub="每个项目平均" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PieChart data={pieData} title="项目状态分布" />
        <BarChart
          data={catData}
          xKey="category"
          bars={[{ key: 'success_rate', name: '成功率 (%)', color: '#05CE78' }]}
          title="各类目成功率 Top 12"
          yFormatter={v => `${v}%`}
          height={280}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LineChart
          data={trendData}
          xKey="month"
          lines={[
            { key: 'total', name: '发起数量', color: '#3B82F6' },
            { key: 'successful', name: '成功数量', color: '#05CE78' },
          ]}
          title="近24个月项目发起趋势"
          height={280}
        />
        <LineChart
          data={trendData}
          xKey="month"
          lines={[{ key: 'success_rate', name: '成功率 (%)', color: '#8B5CF6' }]}
          title="近24个月成功率趋势"
          yFormatter={v => `${v}%`}
          height={280}
        />
      </div>

      <BarChart
        data={catData}
        xKey="category"
        bars={[
          { key: 'total', name: '总项目数', color: '#3B82F6' },
          { key: 'successful', name: '成功项目数', color: '#05CE78' },
        ]}
        title="各类目项目数量 Top 12"
        height={300}
      />

      <DataSource />
    </div>
  );
}
