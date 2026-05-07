'use client';

import { useEffect, useState } from 'react';
import BarChart from '@/components/charts/BarChart';
import EmptyState from '@/components/EmptyState';

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

function fmtM(v: number) { return `$${v}M`; }

export default function CategoriesPage() {
  const [data, setData] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetch('/api/categories')
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

  const top12 = data.slice(0, 12);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">类目分析</h1>
        <p className="text-sm text-gray-500 mt-1">各类目项目成功率、融资金额对比（仅含已结束项目）</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'success_rate', name: '成功率 (%)', color: '#10B981' }]}
          title="各类目成功率"
          yFormatter={v => `${v}%`}
          height={320}
        />
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'total_pledged_m', name: '总金额 (M USD)', color: '#3B82F6' }]}
          title="各类目总融资金额"
          yFormatter={fmtM}
          height={320}
        />
      </div>

      <BarChart
        data={top12}
        xKey="category"
        bars={[
          { key: 'total', name: '总项目数', color: '#6366F1' },
          { key: 'successful', name: '成功数', color: '#10B981' },
          { key: 'failed', name: '失败数', color: '#EF4444' },
        ]}
        title="各类目项目数量分布"
        height={320}
      />

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">类目详细数据</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">类目</th>
                <th className="px-5 py-3 text-right">总项目数</th>
                <th className="px-5 py-3 text-right">成功</th>
                <th className="px-5 py-3 text-right">失败</th>
                <th className="px-5 py-3 text-right">成功率</th>
                <th className="px-5 py-3 text-right">总融资</th>
                <th className="px-5 py-3 text-right">平均融资</th>
                <th className="px-5 py-3 text-right">总支持人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map(row => (
                <tr key={row.category} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{row.category}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-green-600">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-red-500">{row.failed.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-medium ${row.success_rate >= 40 ? 'text-green-600' : row.success_rate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
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
}
