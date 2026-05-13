'use client';

import { useEffect, useMemo, useState } from 'react';
import { Megaphone, MousePointerClick, Save, Trash2, Eye } from 'lucide-react';

interface Announcement {
  id?: number;
  title: string;
  body: string;
  image_url: string;
  cta_label: string;
  cta_url: string;
  audience: 'all' | 'new_users';
  frequency: 'daily' | 'once' | 'always';
  active: number;
  views?: number;
  clicks?: number;
  dismissals?: number;
  avg_duration_ms?: number | null;
  updated_at?: number;
}

const empty: Announcement = {
  title: '更快发现值得关注的项目',
  body: '我们更新了排行榜、Live 情报和项目缩略图预览。现在你可以更快看到最近升温的项目，并把榜单生成分享图。',
  image_url: '',
  cta_label: '查看排行榜',
  cta_url: '/leaderboard',
  audience: 'all',
  frequency: 'daily',
  active: 0,
};

export default function AdminUpdatesPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [form, setForm] = useState<Announcement>(empty);
  const [saving, setSaving] = useState(false);

  const load = () => fetch('/api/admin/announcements', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => setItems(d.data ?? []))
    .catch(() => setItems([]));

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    const views = items.reduce((sum, i) => sum + Number(i.views ?? 0), 0);
    const clicks = items.reduce((sum, i) => sum + Number(i.clicks ?? 0), 0);
    return { views, clicks, ctr: views ? Math.round((clicks / views) * 1000) / 10 : 0 };
  }, [items]);

  const save = async () => {
    setSaving(true);
    await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setForm(empty);
    load();
  };

  const remove = async (id?: number) => {
    if (!id) return;
    await fetch(`/api/admin/announcements?id=${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">更新推送</h1>
        <p className="mt-1 text-sm text-gray-500">面向用户展示近期功能更新、引导新用户完成关键动作，并记录浏览和点击效果。</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-400"><Eye className="h-4 w-4" />总浏览</div>
          <p className="mt-2 text-2xl font-black text-gray-900">{stats.views.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-400"><MousePointerClick className="h-4 w-4" />总点击</div>
          <p className="mt-2 text-2xl font-black text-gray-900">{stats.clicks.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-400"><Megaphone className="h-4 w-4" />点击率</div>
          <p className="mt-2 text-2xl font-black text-ks-green">{stats.ctr}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_1fr]">
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="font-bold text-gray-900">{form.id ? '编辑推送' : '新建推送'}</h2>
          <div className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="text-xs font-semibold text-gray-400">标题</span>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-400">正文</span>
              <textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-gray-400">图片 URL</span>
              <input value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="可选，建议 16:7 横图" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-semibold text-gray-400">按钮文案</span>
                <input value={form.cta_label} onChange={e => setForm({ ...form, cta_label: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
              </label>
              <label>
                <span className="text-xs font-semibold text-gray-400">跳转链接</span>
                <input value={form.cta_url} onChange={e => setForm({ ...form, cta_url: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="text-xs font-semibold text-gray-400">人群</span>
                <select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as Announcement['audience'] })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2">
                  <option value="all">所有用户</option>
                  <option value="new_users">新注册用户</option>
                </select>
              </label>
              <label>
                <span className="text-xs font-semibold text-gray-400">频率</span>
                <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value as Announcement['frequency'] })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2">
                  <option value="daily">每天一次</option>
                  <option value="once">只展示一次</option>
                  <option value="always">每次打开</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <input type="checkbox" checked={!!form.active} onChange={e => setForm({ ...form, active: e.target.checked ? 1 : 0 })} className="accent-ks-green" />
              <span className="text-sm font-semibold text-gray-700">立即启用</span>
            </label>
            <button onClick={save} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ks-green px-4 py-2.5 text-sm font-bold text-white hover:bg-ks-green-dark disabled:opacity-60">
              <Save className="h-4 w-4" />{saving ? '保存中...' : '保存推送'}
            </button>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="font-bold text-gray-900">历史推送</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {items.map(item => {
              const ctr = Number(item.views ?? 0) ? Math.round((Number(item.clicks ?? 0) / Number(item.views ?? 1)) * 1000) / 10 : 0;
              return (
                <div key={item.id} className="grid grid-cols-[1fr_auto] gap-4 px-5 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button onClick={() => setForm({ ...item, image_url: item.image_url ?? '', cta_label: item.cta_label ?? '', cta_url: item.cta_url ?? '' })} className="font-bold text-gray-900 hover:text-ks-green">{item.title}</button>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.active ? 'bg-ks-green-light text-ks-green-dark' : 'bg-gray-100 text-gray-500'}`}>{item.active ? '启用中' : '草稿'}</span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600">{item.frequency}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-gray-500">{item.body}</p>
                    <p className="mt-2 text-xs text-gray-400">
                      浏览 {Number(item.views ?? 0).toLocaleString()} · 点击 {Number(item.clicks ?? 0).toLocaleString()} · CTR {ctr}% · 平均停留 {Math.round(Number(item.avg_duration_ms ?? 0) / 1000)}s
                    </p>
                  </div>
                  <button onClick={() => remove(item.id)} className="self-start rounded-lg p-2 text-gray-300 hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {!items.length && <div className="p-10 text-center text-sm text-gray-400">还没有推送记录。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
