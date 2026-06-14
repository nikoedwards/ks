'use client';

import { useEffect, useState } from 'react';
import BarChart from '@/components/charts/BarChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t, uiCopy } from '@/lib/i18n';

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

export default function CategoriesPage() {
  const [lang] = useLanguage();
  const tr = t[lang].categories;

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

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{uiCopy[lang].common.loading}</div>;
  if (empty) return <EmptyState />;

  const top12 = data.slice(0, 12);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'success_rate', name: tr.rate, color: '#05CE78' }]}
          title={tr.chartRate}
          yFormatter={v => `${v}%`}
          height={320}
        />
        <BarChart
          data={top12}
          xKey="category"
          bars={[{ key: 'total_pledged_m', name: tr.raised, color: '#3B82F6' }]}
          title={tr.chartRaised}
          yFormatter={v => `$${v}M`}
          height={320}
        />
      </div>

      <BarChart
        data={top12}
        xKey="category"
        bars={[
          { key: 'total', name: tr.total, color: '#6366F1' },
          { key: 'successful', name: tr.successful, color: '#05CE78' },
          { key: 'failed', name: tr.failed, color: '#EF4444' },
        ]}
        title={tr.chartDist}
        height={320}
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tr.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tr.colCategory}</th>
                <th className="px-5 py-3 text-right">{tr.colTotal}</th>
                <th className="px-5 py-3 text-right">{tr.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tr.colFailed}</th>
                <th className="px-5 py-3 text-right">{tr.colRate}</th>
                <th className="px-5 py-3 text-right">{tr.colRaised}</th>
                <th className="px-5 py-3 text-right">{tr.colAvg}</th>
                <th className="px-5 py-3 text-right">{tr.colBackers}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map(row => (
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

      <DataSource />
    </div>
  );
}
