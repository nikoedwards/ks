'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity, Eye, MousePointerClick, Users, ShieldAlert, RefreshCw, TrendingUp,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { useLanguage } from '@/hooks/useLanguage';

interface Overview {
  generatedAt: number;
  totals: { pageviews: number; projectViews: number; rateLimited: number };
  windows: { today: number; last7d: number; last30d: number };
  uniques: { users7d: number; guests7d: number; users30d: number };
  daily: { day: string; pageviews: number; projectViews: number; visitors: number }[];
  topProjects: { project_id: string; name: string | null; views: number }[];
  topPages: { path: string; views: number }[];
  activeUsers: { user_id: number; username: string | null; events: number; last_seen: number }[];
  recent: { event_type: string; path: string | null; project_id: string | null; project_name: string | null; username: string | null; created_at: number }[];
}

const RANGES = [7, 30, 90] as const;

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

function StatTile({ icon: Icon, label, value, hint, tone = 'gray' }: {
  icon: typeof Eye; label: string; value: number | string; hint?: string; tone?: 'gray' | 'blue' | 'green' | 'amber' | 'red';
}) {
  const tones: Record<string, string> = {
    gray: 'text-gray-700 bg-gray-100',
    blue: 'text-blue-700 bg-blue-100',
    green: 'text-green-700 bg-green-100',
    amber: 'text-amber-700 bg-amber-100',
    red: 'text-red-700 bg-red-100',
  };
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-4">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold text-gray-900">{typeof value === 'number' ? value.toLocaleString() : value}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function AdminAnalyticsPage() {
  const [lang] = useLanguage();
  const cn = lang === 'cn';
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/analytics?days=${days}`, { cache: 'no-store' });
      if (res.status === 403) { setForbidden(true); setData(null); return; }
      if (res.ok) { setForbidden(false); setData(await res.json()); }
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  if (forbidden) return <div className="text-red-500">{cn ? '需要管理员权限。' : 'Admin access required.'}</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            {cn ? '站点分析' : 'Site Analytics'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {cn ? '页面访问、项目点击分布与用户行为追踪。' : 'Pageviews, project click distribution, and user behavior tracking.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setDays(r)}
                className={`px-3 py-1.5 text-sm font-medium ${days === r ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {cn ? `${r}天` : `${r}d`}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {cn ? '刷新' : 'Refresh'}
          </button>
        </div>
      </div>

      {!data ? (
        <div className="text-gray-400">{cn ? '加载中...' : 'Loading...'}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile icon={Eye} tone="blue" label={cn ? '今日浏览' : 'Today views'} value={data.windows.today} hint={cn ? '页面 + 项目浏览' : 'pageviews + project views'} />
            <StatTile icon={TrendingUp} tone="green" label={cn ? `近${days}天浏览` : `${days}d views`} value={data.totals.pageviews + data.totals.projectViews} />
            <StatTile icon={Users} tone="gray" label={cn ? '近7天活跃用户' : 'Active users (7d)'} value={data.uniques.users7d} hint={cn ? `游客 ${data.uniques.guests7d.toLocaleString()}` : `${data.uniques.guests7d.toLocaleString()} guests`} />
            <StatTile icon={ShieldAlert} tone={data.totals.rateLimited > 0 ? 'red' : 'gray'} label={cn ? '限流拦截' : 'Rate-limited'} value={data.totals.rateLimited} hint={cn ? '疑似爬虫/异常请求' : 'suspected scraping'} />
          </div>

          <section className="bg-white border border-gray-100 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">{cn ? '流量趋势' : 'Traffic trend'}</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="vis" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Area type="monotone" dataKey="pageviews" name={cn ? '页面浏览' : 'Pageviews'} stroke="#3b82f6" fill="url(#pv)" />
                  <Area type="monotone" dataKey="visitors" name={cn ? '访客数' : 'Visitors'} stroke="#10b981" fill="url(#vis)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-gray-100 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <MousePointerClick className="h-4 w-4 text-blue-600" />
                {cn ? '项目点击分布 Top 25' : 'Top projects by views'}
              </h2>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {data.topProjects.length === 0 && <div className="text-sm text-gray-400">{cn ? '暂无数据' : 'No data yet'}</div>}
                {data.topProjects.map((p, i) => {
                  const max = data.topProjects[0]?.views || 1;
                  return (
                    <Link key={p.project_id} href={`/projects/${p.project_id}`} className="block group">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-5 text-right text-gray-400">{i + 1}</span>
                        <span className="flex-1 truncate text-gray-700 group-hover:text-blue-600">{p.name || p.project_id}</span>
                        <span className="tabular-nums text-gray-500">{p.views.toLocaleString()}</span>
                      </div>
                      <div className="ml-7 h-1 rounded bg-gray-100 overflow-hidden">
                        <div className="h-full bg-blue-400" style={{ width: `${(p.views / max) * 100}%` }} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>

            <section className="bg-white border border-gray-100 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">{cn ? '热门页面 Top 25' : 'Top pages'}</h2>
              <div className="space-y-1.5 max-h-96 overflow-y-auto">
                {data.topPages.length === 0 && <div className="text-sm text-gray-400">{cn ? '暂无数据' : 'No data yet'}</div>}
                {data.topPages.map((p, i) => (
                  <div key={p.path} className="flex items-center gap-2 text-sm">
                    <span className="w-5 text-right text-gray-400">{i + 1}</span>
                    <span className="flex-1 truncate font-mono text-xs text-gray-700">{p.path}</span>
                    <span className="tabular-nums text-gray-500">{p.views.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="bg-white border border-gray-100 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-600" />
                {cn ? '最活跃用户' : 'Most active users'}
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400">
                      <th className="py-1.5">{cn ? '用户' : 'User'}</th>
                      <th className="py-1.5 text-right">{cn ? '事件数' : 'Events'}</th>
                      <th className="py-1.5 text-right">{cn ? '最近活跃' : 'Last seen'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activeUsers.length === 0 && (
                      <tr><td colSpan={3} className="py-3 text-gray-400">{cn ? '暂无登录用户行为' : 'No logged-in activity yet'}</td></tr>
                    )}
                    {data.activeUsers.map(u => (
                      <tr key={u.user_id} className="border-t border-gray-50">
                        <td className="py-1.5 text-gray-700">{u.username || `#${u.user_id}`}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{u.events.toLocaleString()}</td>
                        <td className="py-1.5 text-right text-xs text-gray-400">{fmtDate(u.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white border border-gray-100 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">{cn ? '实时活动流' : 'Live activity feed'}</h2>
              <div className="space-y-1 max-h-96 overflow-y-auto text-sm">
                {data.recent.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs border-b border-gray-50 py-1">
                    <span className={`px-1.5 py-0.5 rounded font-medium ${
                      e.event_type === 'project_view' ? 'bg-blue-50 text-blue-600'
                        : e.event_type === 'rate_limited' ? 'bg-red-50 text-red-600'
                          : 'bg-gray-100 text-gray-500'
                    }`}>{e.event_type}</span>
                    <span className="flex-1 truncate text-gray-600">
                      {e.project_name || e.path || e.project_id || '-'}
                    </span>
                    <span className="text-gray-400">{e.username || (cn ? '游客' : 'guest')}</span>
                    <span className="text-gray-300">{fmtDate(e.created_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
