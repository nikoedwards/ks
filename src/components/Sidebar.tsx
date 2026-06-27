'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  BarChart2,
  SlidersHorizontal,
  Info,
  // Github,
  Flame,
  Trophy,
  Award,
  Sparkles,
  Heart,
  RadioTower,
  Activity,
  Users,
  Megaphone,
  LogOut,
  User,
  KeyRound,
  BookOpen,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import LoginModal from '@/components/LoginModal';
import LanguageSelect from '@/components/LanguageSelect';

export default function Sidebar({
  mobileOpen = false,
  onClose,
  onNavigate,
}: {
  mobileOpen?: boolean;
  onClose?: () => void;
  onNavigate?: () => void;
} = {}) {
  const pathname = usePathname();
  const [lang] = useLanguage();
  const tr = t[lang].nav;
  const { user, logout, showLogin } = useAuth();
  const [navConfig, setNavConfig] = useState<{ nav_key: string }[]>([]);

  const navMap = useMemo(() => ({
    dashboard: { href: '/dashboard', label: tr.overview, icon: LayoutDashboard, adminOnly: false },
    projects: { href: '/projects', label: tr.projects, icon: Search, adminOnly: false },
    leaderboard: { href: '/leaderboard', label: tr.leaderboard, icon: Trophy, adminOnly: false },
    awards: { href: '/awards', label: tr.awards, icon: Award, adminOnly: false },
    'live-intel': { href: '/live-intel', label: tr.liveIntel, icon: Flame, adminOnly: false },
    analysis: { href: '/analysis', label: tr.analysis, icon: BarChart2, adminOnly: false },
    predict: { href: '/predict', label: tr.predict, icon: Sparkles, adminOnly: false },
    favorites: { href: '/favorites', label: tr.favorites, icon: Heart, adminOnly: false },
    'data-quality': { href: '/data-quality', label: tr.dataQuality, icon: RadioTower, adminOnly: true },
    'admin-analytics': { href: '/admin/analytics', label: tr.analytics, icon: Activity, adminOnly: true },
    'admin-users': { href: '/admin/users', label: tr.users, icon: Users, adminOnly: true },
    'admin-updates': { href: '/admin/updates', label: tr.updates, icon: Megaphone, adminOnly: true },
    'admin-nav': { href: '/admin/nav', label: tr.globalConfig, icon: SlidersHorizontal, adminOnly: true },
  }), [lang, tr]);

  useEffect(() => {
    fetch('/api/nav').then(r => r.json()).then(d => setNavConfig(d.items ?? [])).catch(() => setNavConfig([]));
  }, [user]);

  const isAdmin = user?.role === 'admin';

  const nav = (navConfig.length ? navConfig : [
    { nav_key: 'dashboard' },
    { nav_key: 'projects' },
    { nav_key: 'leaderboard' },
    { nav_key: 'awards' },
    { nav_key: 'live-intel' },
    { nav_key: 'analysis' },
    { nav_key: 'predict' },
    { nav_key: 'favorites' },
    { nav_key: 'data-quality' },
    { nav_key: 'admin-analytics' },
    { nav_key: 'admin-updates' },
  ]).map(item => {
    const entry = navMap[item.nav_key as keyof typeof navMap];
    return entry ? { ...entry, key: item.nav_key } : null;
  }).filter((item): item is NonNullable<typeof item> =>
    // Never render admin-only items unless the user is a confirmed admin.
    // During auth load `user` is null, so they stay hidden (no flash of
    // admin nav for regular visitors).
    !!item && (!item.adminOnly || isAdmin),
  );

  return (
    <>
      <LoginModal />
      {/* Backdrop for the mobile drawer. */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden
      />
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[82vw] flex-col overflow-y-auto bg-[#1a1a1a] text-white transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <Link href="/" onClick={onNavigate} className="px-5 py-5 border-b border-white/10 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="Kicksonar" width={28} height={28} className="shrink-0" />
            <div>
              <div className="font-bold text-base leading-tight">Kicksonar</div>
              <div className="text-[10px] text-white/40 leading-tight">{tr.subtitle}</div>
            </div>
          </div>
        </Link>

        <nav className="flex-1 py-3 px-2.5 space-y-0.5">
          {nav.map((item, index) => {
            const { href, label, icon: Icon, adminOnly } = item!;
            const previous = index > 0 ? nav[index - 1] : null;
            const showAdminDivider = adminOnly && !previous?.adminOnly;
            const active = pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
            const isFav = href === '/favorites';
            return (
              <div key={href}>
                {showAdminDivider && (
                  <div className="my-3 px-3">
                    <div className="border-t border-white/10" />
                    <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-white/25">
                      {tr.adminViews}
                    </div>
                  </div>
                )}
                <Link
                  href={href}
                  onClick={(e) => {
                    if (isFav && !user) { e.preventDefault(); showLogin(); return; }
                    onNavigate?.();
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    active
                      ? 'bg-ks-green text-white shadow-sm'
                      : isFav
                      ? 'text-red-400/80 hover:bg-white/8 hover:text-red-400'
                      : 'text-white/60 hover:bg-white/8 hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isFav && !active ? 'fill-current' : ''}`} />
                  {label}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="px-2.5 py-3 border-t border-white/10 space-y-0.5">
          <Link
            href="/about"
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              pathname === '/about'
                ? 'bg-ks-green text-white'
                : 'text-white/40 hover:bg-white/8 hover:text-white/70'
            }`}
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            {tr.about}
          </Link>
          <Link
            href="/mcp"
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              pathname === '/mcp'
                ? 'bg-ks-green text-white'
                : 'text-white/40 hover:bg-white/8 hover:text-white/70'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            {tr.mcpDocs}
          </Link>
          {user && (
            <Link
              href="/settings"
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                pathname === '/settings'
                  ? 'bg-ks-green text-white'
                  : 'text-white/40 hover:bg-white/8 hover:text-white/70'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              {tr.apiAccess}
            </Link>
          )}
          {/*
          <a
            href="https://github.com/nikoedwards/ks"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:bg-white/8 hover:text-white/70 transition-all"
          >
            <Github className="w-3.5 h-3.5 shrink-0" />
            {tr.github}
          </a>
          */}

          <LanguageSelect variant="dark" className="px-3 py-2" />

          <div className="px-3 py-2">
            {user ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-ks-green flex items-center justify-center shrink-0">
                    <span className="text-white text-[10px] font-bold">{user.username[0].toUpperCase()}</span>
                  </div>
                  <span className="text-xs text-white/70 truncate max-w-[90px]">{user.username}</span>
                </div>
                <button onClick={logout} className="text-white/30 hover:text-white/60 transition-colors" title={t[lang].auth.logout}>
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => showLogin()}
                className="flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors w-full"
              >
                <div className="w-6 h-6 rounded-full border border-white/20 flex items-center justify-center shrink-0">
                  <User className="w-3 h-3" />
                </div>
                <span className="text-xs">{t[lang].auth.signIn}</span>
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
