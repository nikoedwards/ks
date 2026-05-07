'use client';

import { useEffect, useState } from 'react';
import BarChart from '@/components/charts/BarChart';
import EmptyState from '@/components/EmptyState';

interface CountryRow {
  country: string;
  country_name: string;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
  total_backers: number;
}

export default function CountriesPage() {
  const [data, setData] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    fetch('/api/countries')
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

  const top10 = data.slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">国家/地区分析</h1>
        <p className="text-sm text-gray-500 mt-1">各国家和地区众筹表现对比（仅含已结束项目）</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top10}
          xKey="country"
          bars={[
            { key: 'total', name: '总项目数', color: '#3B82F6' },
            { key: 'successful', name: '成功项目数', color: '#10B981' },
          ]}
          title="项目数量 Top 10 国家"
          height={320}
        />
        <BarChart
          data={top10}
          xKey="country"
          bars={[{ key: 'success_rate', name: '成功率 (%)', color: '#8B5CF6' }]}
          title="成功率 Top 10 国家"
          yFormatter={v => `${v}%`}
          height={320}
        />
      </div>

      <BarChart
        data={top10}
        xKey="country"
        bars={[{ key: 'total_pledged_m', name: '融资总额 (M USD)', color: '#F59E0B' }]}
        title="融资总额 Top 10 国家"
        yFormatter={v => `$${v}M`}
        height={300}
      />

      {/* Country table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">国家/地区详细数据</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">排名</th>
                <th className="px-5 py-3">国家/地区</th>
                <th className="px-5 py-3 text-right">总项目数</th>
                <th className="px-5 py-3 text-right">成功项目</th>
                <th className="px-5 py-3 text-right">成功率</th>
                <th className="px-5 py-3 text-right">融资总额</th>
                <th className="px-5 py-3 text-right">支持人数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map((row, i) => (
                <tr key={row.country} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-400 font-medium">#{i + 1}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{row.country_name || row.country}</div>
                    <div className="text-xs text-gray-400">{row.country}</div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-600">{row.total.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-green-600">{row.successful.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`font-medium ${row.success_rate >= 40 ? 'text-green-600' : row.success_rate >= 25 ? 'text-amber-500' : 'text-red-500'}`}>
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
}
