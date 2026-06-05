'use client';

import { useEffect, useState } from 'react';
import BarChart from '@/components/charts/BarChart';
import EmptyState from '@/components/EmptyState';
import DataSource from '@/components/DataSource';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

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
  const [lang] = useLanguage();
  const tr = t[lang].countries;

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

  if (loading) return <div className="flex items-center justify-center h-full text-gray-400">{lang === 'cn' ? '加载中...' : 'Loading...'}</div>;
  if (empty) return <EmptyState />;

  const top10 = data.slice(0, 10);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <BarChart
          data={top10}
          xKey="country"
          bars={[
            { key: 'total', name: tr.total, color: '#3B82F6' },
            { key: 'successful', name: tr.successful, color: '#05CE78' },
          ]}
          title={tr.chartCount}
          height={320}
        />
        <BarChart
          data={top10}
          xKey="country"
          bars={[{ key: 'success_rate', name: tr.rate, color: '#8B5CF6' }]}
          title={tr.chartRate}
          yFormatter={v => `${v}%`}
          height={320}
        />
      </div>

      <BarChart
        data={top10}
        xKey="country"
        bars={[{ key: 'total_pledged_m', name: tr.raised, color: '#F59E0B' }]}
        title={tr.chartRaised}
        yFormatter={v => `$${v}M`}
        height={300}
      />

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50">
          <h3 className="font-semibold text-gray-700">{tr.tableTitle}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{tr.colRank}</th>
                <th className="px-5 py-3">{tr.colCountry}</th>
                <th className="px-5 py-3 text-right">{tr.colTotal}</th>
                <th className="px-5 py-3 text-right">{tr.colSuccess}</th>
                <th className="px-5 py-3 text-right">{tr.colRate}</th>
                <th className="px-5 py-3 text-right">{tr.colRaised}</th>
                <th className="px-5 py-3 text-right">{tr.colBackers}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.map((row, i) => (
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

      <DataSource />
    </div>
  );
}
