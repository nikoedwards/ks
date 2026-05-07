'use client';

import { useEffect, useState, useCallback } from 'react';
import { Search, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import EmptyState from '@/components/EmptyState';

interface Project {
  id: string;
  name: string;
  blurb: string;
  state: string;
  country: string;
  country_name: string;
  category_parent: string;
  category_name: string;
  goal: number;
  pledged: number;
  usd_pledged: number;
  backers_count: number;
  staff_pick: number;
  launched_at: number;
  deadline: number;
  source_url: string;
}

const STATE_BADGE: Record<string, string> = {
  successful: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  live: 'bg-blue-100 text-blue-700',
  canceled: 'bg-amber-100 text-amber-700',
  suspended: 'bg-purple-100 text-purple-700',
};

const STATE_LABELS: Record<string, string> = {
  successful: '成功', failed: '失败', live: '进行中', canceled: '已取消', suspended: '已暂停',
};

function fmtUsd(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function fmtDate(ts: number) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default function ProjectsPage() {
  const [data, setData] = useState<{ total: number; rows: Project[]; categories: string[]; countries: { country: string; country_name: string }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);

  const [search, setSearch] = useState('');
  const [state, setState] = useState('all');
  const [category, setCategory] = useState('');
  const [country, setCountry] = useState('');
  const [sort, setSort] = useState('usd_pledged');
  const [page, setPage] = useState(1);

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
      sort,
      ...(state !== 'all' ? { state } : {}),
      ...(category ? { category } : {}),
      ...(country ? { country } : {}),
      ...(search ? { search } : {}),
    });
    fetch(`/api/projects?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!d.total && !d.rows?.length && !d.categories?.length) { setEmpty(true); }
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, sort, state, category, country, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => { e.preventDefault(); setPage(1); fetchData(); };

  if (empty && !loading) return <EmptyState />;

  const totalPages = data ? Math.ceil(data.total / 20) : 0;

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">项目列表</h1>
        <p className="text-sm text-gray-500 mt-1">搜索和筛选 Kickstarter 历史项目</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
        <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-500 mb-1 block">搜索项目</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="项目名称或描述..."
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">状态</label>
            <select value={state} onChange={e => { setState(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="all">全部</option>
              <option value="successful">成功</option>
              <option value="failed">失败</option>
              <option value="live">进行中</option>
              <option value="canceled">已取消</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">类目</label>
            <select value={category} onChange={e => { setCategory(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">全部类目</option>
              {(data?.categories ?? []).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">国家</label>
            <select value={country} onChange={e => { setCountry(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">全部国家</option>
              {(data?.countries ?? []).map(c => (
                <option key={c.country} value={c.country}>{c.country_name || c.country}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">排序</label>
            <select value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}
              className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="usd_pledged">众筹金额</option>
              <option value="backers">支持人数</option>
              <option value="funding_rate">完成率</option>
              <option value="launched">最新发起</option>
            </select>
          </div>

          <button type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            搜索
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400">加载中...</div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
              <span className="text-sm text-gray-500">
                共 <span className="font-semibold text-gray-900">{data?.total?.toLocaleString()}</span> 个项目
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="px-4 py-3">项目名称</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">类目</th>
                    <th className="px-4 py-3 text-right">目标金额</th>
                    <th className="px-4 py-3 text-right">实际金额</th>
                    <th className="px-4 py-3 text-right">完成率</th>
                    <th className="px-4 py-3 text-right">支持人数</th>
                    <th className="px-4 py-3">国家</th>
                    <th className="px-4 py-3">发起日期</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(data?.rows ?? []).map(p => {
                    const fundingRate = p.goal > 0 ? (p.usd_pledged / p.goal) * 100 : 0;
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 max-w-xs truncate">{p.name}</div>
                          <div className="text-xs text-gray-400 max-w-xs truncate mt-0.5">{p.blurb}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATE_BADGE[p.state] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATE_LABELS[p.state] ?? p.state}
                          </span>
                          {p.staff_pick === 1 && (
                            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-yellow-50 text-yellow-700">精选</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-gray-700">{p.category_parent}</div>
                          <div className="text-xs text-gray-400">{p.category_name}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-600">{fmtUsd(p.goal)}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-900 font-medium">{fmtUsd(p.usd_pledged)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${fundingRate >= 100 ? 'text-green-600' : 'text-gray-600'}`}>
                            {fundingRate >= 1000 ? '>1000' : fundingRate.toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">{p.backers_count.toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-500">{p.country}</td>
                        <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDate(p.launched_at)}</td>
                        <td className="px-4 py-3">
                          {p.source_url && (
                            <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                              className="text-blue-500 hover:text-blue-700">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between">
                <span className="text-sm text-gray-500">第 {page} 页 / 共 {totalPages} 页</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                    className="p-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="p-1.5 rounded-lg border text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
