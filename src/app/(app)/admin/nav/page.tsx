'use client';

import { useEffect, useState } from 'react';
import { GripVertical, Save } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard: '数据概览（已并入分析）',
  projects: '项目列表',
  leaderboard: '排行榜',
  'live-intel': 'Live 情报',
  analysis: '数据分析',
  predict: '项目预测',
  favorites: '收藏夹',
  'data-quality': '数据质量',
  'admin-users': '用户看板',
  'admin-updates': '更新推送',
  'admin-nav': '导航配置',
};

const ADMIN_ONLY_NAV_KEYS = new Set(['data-quality', 'admin-users', 'admin-updates', 'admin-nav']);

interface NavItem {
  nav_key: string;
  sort_order: number;
  admin_visible: number;
  user_visible: number;
}

export default function AdminNavPage() {
  const [items, setItems] = useState<NavItem[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch('/api/admin/nav', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setItems(data.items ?? []);
    }
  };

  useEffect(() => { load(); }, []);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...items];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next.map((item, i) => ({ ...item, sort_order: i })));
  };

  const toggle = (index: number, field: 'admin_visible' | 'user_visible') => {
    if (field === 'user_visible' && ADMIN_ONLY_NAV_KEYS.has(items[index]?.nav_key)) return;
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: item[field] ? 0 : 1 } : item));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/nav', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((item, i) => ({ ...item, sort_order: i })) }),
      });
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">左侧栏权限配置</h1>
          <p className="text-sm text-gray-500 mt-1">配置不同角色可见板块，以及全站左侧导航顺序。</p>
        </div>
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
          <Save className="w-4 h-4" />
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_110px_110px_120px] gap-3 bg-gray-50 px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
          <div>板块</div>
          <div className="text-center">管理员</div>
          <div className="text-center">普通用户</div>
          <div className="text-right">排序</div>
        </div>
        <div className="divide-y divide-gray-50">
          {items.map((item, index) => {
            const adminOnly = ADMIN_ONLY_NAV_KEYS.has(item.nav_key);
            return (
            <div key={item.nav_key} className="grid grid-cols-[1fr_110px_110px_120px] gap-3 px-5 py-3 items-center">
              <div className="flex items-center gap-3 min-w-0">
                <GripVertical className="w-4 h-4 text-gray-300" />
                <div>
                  <p className="font-medium text-gray-900">{LABELS[item.nav_key] ?? item.nav_key}</p>
                  <p className="text-xs text-gray-400">{item.nav_key}{adminOnly ? ' · admin only' : ''}</p>
                </div>
              </div>
              <label className="flex justify-center">
                <input type="checkbox" checked={!!item.admin_visible} onChange={() => toggle(index, 'admin_visible')} className="accent-ks-green" />
              </label>
              <label className="flex justify-center">
                <input type="checkbox" checked={adminOnly ? false : !!item.user_visible} disabled={adminOnly} onChange={() => toggle(index, 'user_visible')} className="accent-ks-green disabled:opacity-40" />
              </label>
              <div className="flex justify-end gap-1">
                <button onClick={() => move(index, -1)} className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200">上移</button>
                <button onClick={() => move(index, 1)} className="px-2 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200">下移</button>
              </div>
            </div>
          )})}
        </div>
      </div>
    </div>
  );
}
