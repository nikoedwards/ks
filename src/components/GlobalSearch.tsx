'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Flame, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

interface Hit {
  id: string;
  name: string;
  state: string;
  category_parent?: string | null;
  usd_pledged?: number;
  backers_count?: number;
  image_url?: string | null;
  image_thumb_url?: string | null;
}

function fmtMoneyCompact(value: number) {
  const v = Number(value ?? 0);
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function stateLabel(state: string, cn: boolean) {
  const map: Record<string, [string, string]> = {
    live: ['进行中', 'Live'],
    successful: ['成功', 'Successful'],
    failed: ['失败', 'Failed'],
    canceled: ['已下线', 'Offline'],
    suspended: ['已下线', 'Offline'],
  };
  const pair = map[state];
  return pair ? (cn ? pair[0] : pair[1]) : state;
}

function stateClass(state: string) {
  if (state === 'live') return 'border-blue-100 bg-blue-50 text-blue-600';
  if (state === 'successful') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (state === 'failed') return 'border-red-100 bg-red-50 text-red-600';
  return 'border-gray-100 bg-gray-50 text-gray-500';
}

function StatePill({ state, cn }: { state: string; cn: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${stateClass(state)}`}>
      {state === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
      {stateLabel(state, cn)}
    </span>
  );
}

export default function GlobalSearch() {
  const router = useRouter();
  const [lang] = useLanguage();
  const cn = lang === 'cn';

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Hit[]>([]);
  const [trending, setTrending] = useState<Hit[]>([]);
  const [trendingLoaded, setTrendingLoaded] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTrending = useCallback(() => {
    if (trendingLoaded) return;
    setTrendingLoaded(true);
    fetch('/api/projects/trending')
      .then(r => r.json())
      .then(d => setTrending((d.rows ?? []) as Hit[]))
      .catch(() => {});
  }, [trendingLoaded]);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.trim().length < 2) { setSuggestions([]); return; }
    fetch(`/api/projects?search=${encodeURIComponent(q.trim())}&limit=6&page=1`)
      .then(r => r.json())
      .then(d => setSuggestions((d.rows?.slice(0, 6) ?? []) as Hit[]))
      .catch(() => {});
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 280);
  };

  const handleFocus = () => {
    setOpen(true);
    loadTrending();
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim()) {
      router.push(`/projects?search=${encodeURIComponent(query.trim())}`);
      setOpen(false);
    }
  };

  const openProject = (id: string) => {
    if (!id) return;
    router.push(`/projects/${encodeURIComponent(id)}`);
    setOpen(false);
    setQuery('');
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const typing = query.trim().length > 0;
  const showRow = (s: Hit) => {
    const img = s.image_thumb_url || s.image_url;
    return (
      <button
        key={s.id}
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={() => openProject(s.id)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-gray-50"
      >
        <span className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
          ) : (
            <Search className="m-3 h-4 w-4 text-gray-300" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800">{s.name}</span>
          <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
            {s.category_parent && <span>{s.category_parent}</span>}
            <StatePill state={s.state} cn={cn} />
            {typeof s.usd_pledged === 'number' && s.usd_pledged > 0 && (
              <span className="font-semibold text-gray-500">{fmtMoneyCompact(s.usd_pledged)}</span>
            )}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div ref={wrapRef} className="relative w-full max-w-3xl">
      <form onSubmit={submit}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={handleFocus}
            placeholder={cn ? '搜索项目名称…' : 'Search campaigns…'}
            className="w-full rounded-full border border-gray-200 bg-gray-50 py-1.5 pl-10 pr-4 text-sm transition-all focus:border-ks-green focus:bg-white focus:outline-none focus:ring-2 focus:ring-ks-green/30"
          />
        </div>
      </form>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          {typing ? (
            suggestions.length > 0 ? (
              <>
                {suggestions.map(showRow)}
                <button
                  type="button"
                  onClick={() => submit()}
                  className="w-full border-t border-gray-50 px-4 py-2.5 text-left text-xs font-semibold text-ks-green transition-colors hover:bg-ks-green-light"
                >
                  {cn ? `查看 "${query.trim()}" 的全部结果 →` : `See all results for "${query.trim()}" →`}
                </button>
              </>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-400">
                {query.trim().length < 2
                  ? (cn ? '继续输入以搜索…' : 'Keep typing to search…')
                  : (cn ? '没有匹配的项目' : 'No matching campaigns')}
              </div>
            )
          ) : (
            <div>
              <div className="flex items-center gap-1.5 border-b border-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                <Flame className="h-3.5 w-3.5 text-orange-400" />
                {cn ? '热门项目' : 'Trending'}
              </div>
              {trending.length > 0 ? (
                trending.map((s, i) => (
                  <div key={s.id} className="flex items-center">
                    <span className={`w-7 shrink-0 pl-4 text-sm font-black ${i < 3 ? 'text-orange-500' : 'text-gray-300'}`}>{i + 1}</span>
                    <span className="flex-1">{showRow(s)}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-gray-400">
                  <TrendingUp className="h-4 w-4" />
                  {cn ? '加载中…' : 'Loading…'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
