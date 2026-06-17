'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Search, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import LanguageSelect from '@/components/LanguageSelect';

const LoginModal = dynamic(() => import('@/components/LoginModal'), {
  ssr: false,
  loading: () => null,
});

interface SearchHit {
  id: string;
  name: string;
  category_parent: string;
  state: string;
  usd_pledged?: number;
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

function LandingHeaderInner() {
  const router = useRouter();
  const { user, logout, showLogin, loginVisible } = useAuth();
  const [navSearch, setNavSearch] = useState('');
  const [suggestions, setSuggestions] = useState<SearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    fetch(`/api/projects?search=${encodeURIComponent(q.trim())}&limit=5&page=1`)
      .then(r => r.json())
      .then(d => setSuggestions(d.rows?.slice(0, 5) ?? []))
      .catch(() => setSuggestions([]));
  }, []);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setNavSearch(value);
    setShowSuggestions(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 250);
  };

  const submitSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = navSearch.trim();
    if (!query) return;
    router.push(`/projects?search=${encodeURIComponent(query)}`);
    setShowSuggestions(false);
  };

  const openProject = (id: string) => {
    if (!id) return;
    router.push(`/projects/${encodeURIComponent(id)}`);
    setShowSuggestions(false);
    setNavSearch('');
  };

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <>
      {loginVisible ? <LoginModal /> : null}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full hover:bg-gray-50 sm:w-auto sm:gap-2.5 sm:px-1">
            <img src="/logo.svg" alt="Kicksonar logo" width={28} height={28} />
            <span className="hidden text-base font-bold text-gray-900 sm:block">Kicksonar</span>
          </Link>

          <div className="relative mx-auto flex-1 sm:max-w-xl" ref={suggestRef}>
            <form onSubmit={submitSearch}>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={navSearch}
                  onChange={handleSearchChange}
                  onFocus={() => setShowSuggestions(true)}
                  placeholder="Search campaigns..."
                  className="h-12 w-full rounded-full border border-gray-200 bg-gray-50 py-0 pl-10 pr-4 text-base text-gray-900 transition-all focus:border-ks-green focus:bg-white focus:outline-none focus:ring-2 focus:ring-ks-green/25 sm:text-sm"
                  autoComplete="off"
                />
              </div>
            </form>

            {showSuggestions && navSearch.trim() && (
              <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                {navSearch.trim().length < 2 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">Type at least 2 characters.</div>
                ) : suggestions.length ? (
                  suggestions.map(item => {
                    const img = item.image_thumb_url || item.image_url;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className="flex min-h-14 w-full items-center gap-3 border-b border-gray-50 px-4 py-2.5 text-left transition-colors last:border-0 hover:bg-gray-50"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => openProject(item.id)}
                      >
                        <span className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                          {img ? (
                            <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-gray-800">{item.name}</span>
                          <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                            <span>{item.category_parent}</span>
                            <span>{item.state}</span>
                            {typeof item.usd_pledged === 'number' ? <span>{fmtMoneyCompact(item.usd_pledged)}</span> : null}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-4 py-3 text-sm text-gray-400">No matching campaigns yet.</div>
                )}
                <button
                  type="button"
                  className="w-full px-4 py-3 text-left text-sm font-semibold text-ks-green transition-colors hover:bg-ks-green-light"
                  onClick={() => submitSearch()}
                >
                  Search for "{navSearch.trim()}"
                </button>
              </div>
            )}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Link href="/live-intel" className="text-sm font-medium text-gray-600 transition-colors hover:text-gray-900">
              Dashboard
            </Link>
            <Link href="/about" className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-700">
              About
            </Link>
            <LanguageSelect variant="light" className="w-36" />
          </div>

          {user ? (
            <div className="flex h-12 items-center gap-2">
              <span className="hidden rounded-full bg-ks-green/10 px-3 py-2 text-xs font-semibold text-ks-green-dark sm:inline-flex">
                {user.username}
              </span>
              <button
                type="button"
                onClick={logout}
                className="flex h-12 w-12 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-700"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => showLogin()}
              className="flex h-12 min-w-12 items-center justify-center gap-1.5 rounded-xl bg-ks-green px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ks-green-dark"
              aria-label="Sign in"
            >
              <User className="h-4 w-4" />
              <span className="hidden sm:block">Sign in</span>
            </button>
          )}
        </div>
      </header>
    </>
  );
}

export default function LandingHeaderClient() {
  return (
    <AuthProvider>
      <LandingHeaderInner />
    </AuthProvider>
  );
}
