'use client';

import { useEffect, useRef, useState } from 'react';
import { GripVertical, Save, Trophy, Search, X, Trash2 } from 'lucide-react';

const LABELS: Record<string, string> = {
  dashboard: '数据概览（已并入分析）',
  projects: '项目列表',
  leaderboard: '排行榜',
  awards: '声纳奖',
  'live-intel': 'Live 情报',
  analysis: '数据分析',
  predict: '项目预测',
  favorites: '收藏夹',
  'data-quality': '数据质量',
  'admin-users': '用户看板',
  'admin-updates': '更新推送',
  'admin-nav': '全局配置',
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
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">全局配置</h1>
        <p className="text-sm text-gray-500 mt-1">统一管理左侧导航权限与平台奖项等全局设置。</p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-bold text-gray-900">左侧栏权限配置</h2>
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

      <AwardsAdmin />
    </div>
  );
}

interface AwardDef {
  award_key: string;
  name_cn: string; name_en: string;
  tagline_cn: string; tagline_en: string;
  philosophy_cn: string; philosophy_en: string;
  badge_image: string;
  accent: string;
  enabled: number;
}
interface Winner extends AwardDef {
  year: number;
  project_id: string | null;
  citation_cn: string | null; citation_en: string | null;
  project_name: string | null;
  project_thumb_url: string | null;
  project_image_url: string | null;
  project_pledged_usd: number | null;
}
interface ProjectResult {
  id: string; name: string; image_thumb_url: string | null; image_url: string | null;
  state: string; category_parent: string | null; pledged_usd: number; backers_count: number;
}

function AwardsAdmin() {
  const [winners, setWinners] = useState<Winner[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const load = (y: number) => {
    setLoading(true);
    fetch(`/api/admin/awards?year=${y}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setWinners(d.winners ?? []);
        const yset = Array.from(new Set([...(d.years ?? []), y, new Date().getFullYear()])).sort((a, b) => b - a);
        setYears(yset);
      })
      .catch(() => setWinners([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(year); }, [year]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-gray-900"><Trophy className="h-5 w-5 text-amber-500" />声纳奖配置</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-gray-400">年份</span>
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <input
            type="number"
            placeholder="新年份"
            className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            onKeyDown={e => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value); if (v > 2000) setYear(v); } }}
          />
        </div>
      </div>
      <p className="text-xs text-gray-500">为每个奖项指定 {year} 年度获奖项目并撰写颁奖词。获奖结果由管理员决定，保存后立即在公开「声纳奖」页面展示。</p>

      {loading ? (
        <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-400">加载中…</div>
      ) : (
        <div className="space-y-4">
          {winners.map(w => <AwardEditor key={w.award_key} winner={w} year={year} onSaved={() => load(year)} />)}
        </div>
      )}
    </div>
  );
}

function AwardEditor({ winner, year, onSaved }: { winner: Winner; year: number; onSaved: () => void }) {
  const [citationCn, setCitationCn] = useState(winner.citation_cn ?? '');
  const [citationEn, setCitationEn] = useState(winner.citation_en ?? '');
  const [picked, setPicked] = useState<{ id: string; name: string; thumb: string | null } | null>(
    winner.project_id ? { id: winner.project_id, name: winner.project_name ?? winner.project_id, thumb: winner.project_thumb_url ?? winner.project_image_url } : null,
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (!q.trim()) { setResults([]); return; }
    debounce.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/admin/awards?search=${encodeURIComponent(q)}`, { cache: 'no-store' })
        .then(r => r.json())
        .then(d => setResults(d.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
  };

  const saveWinner = async () => {
    if (!picked) return;
    setSaving(true);
    await fetch('/api/admin/awards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_winner', awardKey: winner.award_key, year, projectId: picked.id, citationCn, citationEn }),
    }).catch(() => {});
    setSaving(false);
    onSaved();
  };

  const clearWinner = async () => {
    setSaving(true);
    await fetch('/api/admin/awards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear_winner', awardKey: winner.award_key, year }),
    }).catch(() => {});
    setPicked(null); setCitationCn(''); setCitationEn('');
    setSaving(false);
    onSaved();
  };

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
      <div className="flex items-center gap-3 px-4 py-3" style={{ background: `${winner.accent}12` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={winner.badge_image} alt="" className="h-10 w-10 object-contain" />
        <div>
          <p className="font-bold text-gray-900">{winner.name_cn} <span className="text-xs font-normal text-gray-400">/ {winner.name_en}</span></p>
          <p className="text-xs" style={{ color: winner.accent }}>{winner.tagline_cn}</p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {picked ? (
          <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-2.5">
            {picked.thumb
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={picked.thumb} alt="" className="h-12 w-16 rounded object-cover" referrerPolicy="no-referrer" />
              : <span className="h-12 w-16 rounded bg-gray-200" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-900">{picked.name}</p>
              <p className="text-xs text-gray-400">{picked.id}</p>
            </div>
            <button onClick={() => setPicked(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-200"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input value={query} onChange={e => search(e.target.value)} placeholder="搜索项目名称或粘贴项目 ID…" className="flex-1 text-sm outline-none" />
            </div>
            {(searching || results.length > 0) && (
              <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                {searching && <div className="p-3 text-xs text-gray-400">搜索中…</div>}
                {results.map(r => (
                  <button
                    key={r.id}
                    onClick={() => { setPicked({ id: r.id, name: r.name, thumb: r.image_thumb_url ?? r.image_url }); setResults([]); setQuery(''); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    {(r.image_thumb_url ?? r.image_url)
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={r.image_thumb_url ?? r.image_url ?? ''} alt="" className="h-9 w-12 rounded object-cover" referrerPolicy="no-referrer" />
                      : <span className="h-9 w-12 rounded bg-gray-100" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-800">{r.name}</span>
                      <span className="block truncate text-xs text-gray-400">{r.category_parent ?? '—'} · ${Math.round(r.pledged_usd).toLocaleString()}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-xs font-semibold text-gray-400">颁奖词（中文）</span>
            <textarea value={citationCn} onChange={e => setCitationCn(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-semibold text-gray-400">Citation (EN)</span>
            <textarea value={citationEn} onChange={e => setCitationEn(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={saveWinner} disabled={!picked || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-ks-green px-4 py-2 text-sm font-bold text-white hover:bg-ks-green-dark disabled:opacity-50">
            <Save className="h-4 w-4" />{saving ? '保存中…' : '保存获奖'}
          </button>
          {winner.project_id && (
            <button onClick={clearWinner} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50">
              <Trash2 className="h-4 w-4" />清除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
