'use client';

import { useEffect, useState } from 'react';
import LineChart from '@/components/charts/LineChart';
import BarChart from '@/components/charts/BarChart';
import EmptyState from '@/components/EmptyState';

interface TrendRow {
  month: string;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
}

export default function TrendsPage() {
  const [data, setData] = useState<TrendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetch('/api/trends')
      .then(r => r.json())
      .then(d => {
        if (!d.data?.length) setEmpty(true);
        setData(d.data ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">加载中...</div>;
  if (empty) return <EmptyState />;

  const totalMax = Math.max(...data.map(d => d.total));
  const summary = {
    avgSuccess: (data.reduce((s, d) => s + d.success_rate, 0) / data.length).toFixed(1),
    peakMonth: data.reduce((a, b) => (a.total > b.total ? a : b), data[0])?.month ?? '—',
    totalProjects: data.reduce((s, d) => s + d.total, 0).toLocaleString(),
    totalPledged: data.reduce((s, d) => s + d.total_pledged_m, 0).toFixed(1),
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">趋势分析</h1>
        <p className="text-sm text-gray-500 mt-1">近36个月 Kickstarter 月度趋势（仅含已结束项目）</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '统计月份', value: `${data.length} 个月` },
          { label: '区间内总项目', value: summary.totalProjects },
          { label: '平均月成功率', value: `${summary.avgSuccess}%` },
          { label: '最高发起月', value: summary.peakMonth },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
          </div>
        ))}
      </div>

      <LineChart
        data={data}
        xKey="month"
        lines={[
          { key: 'total', name: '发起项目数', color: '#3B82F6' },
          { key: 'successful', name: '成功项目数', color: '#10B981' },
        ]}
        title="月度项目发起 & 成功数量"
        height={320}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LineChart
          data={data}
          xKey="month"
          lines={[{ key: 'success_rate', name: '成功率 (%)', color: '#8B5CF6' }]}
          title="月度成功率趋势"
          yFormatter={v => `${v}%`}
          height={280}
        />
        <LineChart
          data={data}
          xKey="month"
          lines={[{ key: 'total_pledged_m', name: '融资金额 (M USD)', color: '#F59E0B' }]}
          title="月度融资总额趋势"
          yFormatter={v => `$${v}M`}
          height={280}
        />
      </div>

      {/* Monthly data table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">月度明细数据</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">月份</th>
                <th className="px-5 py-3 text-right">发起项目数</th>
                <th className="px-5 py-3 text-right">成功项目数</th>
                <th className="px-5 py-3 text-right">成功率</th>
                <th className="px-5 py-3 text-right">融资总额</th>
                <th className="px-5 py-3">发起量占比</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...data].reverse().map(row => (
                <tr key={row.month} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{row.month}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-green-600">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-medium ${row.success_rate >= 40 ? 'text-green-600' : 'text-amber-500'}`}>
                      {row.success_rate}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-700">${row.total_pledged_m}M</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full"
                          style={{ width: `${(row.total / totalMax) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 w-8 text-right">
                        {Math.round((row.total / totalMax) * 100)}%
                      </span>
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
}
