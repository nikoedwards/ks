'use client';

import { useEffect, useState } from 'react';
import LineChart from '@/components/charts/LineChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

interface TrendRow {
  month: string;
  total: number;
  successful: number;
  success_rate: number;
  total_pledged_m: number;
}

export default function TrendsPage() {
  const [lang] = useLanguage();
  const tr = t[lang].trends;

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

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{lang === 'cn' ? '加载中...' : 'Loading...'}</div>;
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: tr.months, value: `${data.length}${tr.monthsUnit}` },
          { label: tr.totalProjects, value: summary.totalProjects },
          { label: tr.avgSuccess, value: `${summary.avgSuccess}%` },
          { label: tr.peakMonth, value: summary.peakMonth },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{c.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1.5">{c.value}</p>
          </div>
        ))}
      </div>

      <LineChart
        data={data}
        xKey="month"
        lines={[
          { key: 'total', name: tr.launches, color: '#3B82F6' },
          { key: 'successful', name: tr.successes, color: '#05CE78' },
        ]}
        title={tr.chartTitle}
        height={320}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LineChart
          data={data}
          xKey="month"
          lines={[{ key: 'success_rate', name: tr.successRate, color: '#8B5CF6' }]}
          title={tr.rateTitle}
          yFormatter={v => `${v}%`}
          height={280}
        />
        <LineChart
          data={data}
          xKey="month"
          lines={[{ key: 'total_pledged_m', name: tr.raisedName, color: '#F59E0B' }]}
          title={tr.raisedTitle}
          yFormatter={v => `$${v}M`}
          height={280}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tr.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tr.colMonth}</th>
                <th className="px-5 py-3 text-right">{tr.colLaunches}</th>
                <th className="px-5 py-3 text-right">{tr.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tr.colRate}</th>
                <th className="px-5 py-3 text-right">{tr.colRaised}</th>
                <th className="px-5 py-3">{tr.colShare}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {[...data].reverse().map(row => (
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

      <DataSource />
    </div>
  );
}
