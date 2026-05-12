'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  BarChart2,
  Settings,
  Info,
  Github,
  Flame,
  Sparkles,
  Heart,
  RadioTower,
  LogOut,
  User,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import { useAuth } from '@/contexts/AuthContext';
import LoginModal from '@/components/LoginModal';

export default function Sidebar() {
  const pathname = usePathname();
  const [lang, setLang] = useLanguage();
  const tr = t[lang].nav;
  const { user, logout, showLogin } = useAuth();

  const nav = [
    { href: '/dashboard', label: tr.overview,  icon: LayoutDashboard },
    { href: '/projects',  label: tr.projects,  icon: Search },
    { href: '/live-intel', label: lang === 'cn' ? 'Live 情报' : 'Live Intel', icon: Flame },
    { href: '/analysis',  label: tr.analysis,  icon: BarChart2 },
    { href: '/predict',   label: tr.predict,   icon: Sparkles },
    { href: '/favorites', label: lang === 'cn' ? '收藏夹' : 'Favorites', icon: Heart },
    { href: '/data-quality', label: lang === 'cn' ? '数据质量' : 'Data Quality', icon: RadioTower },
    { href: '/settings',  label: tr.sync,      icon: Settings },
  ];

  return (
    <>
      <LoginModal />
      <aside className="w-56 bg-[#1a1a1a] text-white flex flex-col shrink-0">
        {/* Logo — links back to landing */}
        <Link href="/" className="px-5 py-5 border-b border-white/10 hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-2.5">
            <Image src="/logo.svg" alt="Kicksonar" width={28} height={28} className="shrink-0" />
            <div>
              <div className="font-bold text-base leading-tight">Kicksonar</div>
              <div className="text-[10px] text-white/40 leading-tight">{tr.subtitle}</div>
            </div>
          </div>
        </Link>

        <nav className="flex-1 py-3 px-2.5 space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href + '/'));
            const isFav = href === '/favorites';
            return (
              <Link
                key={href}
                href={href}
                onClick={isFav && !user ? (e) => { e.preventDefault(); showLogin(); } : undefined}
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
            );
          })}
        </nav>

        <div className="px-2.5 py-3 border-t border-white/10 space-y-0.5">
          <Link
            href="/about"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              pathname === '/about'
                ? 'bg-ks-green text-white'
                : 'text-white/40 hover:bg-white/8 hover:text-white/70'
            }`}
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            {tr.about}
          </Link>
          <a
            href="https://github.com/nikoedwards/ks"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:bg-white/8 hover:text-white/70 transition-all"
          >
            <Github className="w-3.5 h-3.5 shrink-0" />
            {tr.github}
          </a>

          {/* Language switcher */}
          <div className="flex items-center gap-1 px-3 py-2">
            <span className="text-[10px] text-white/30 mr-1">LANG</span>
            {(['en', 'cn'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2 py-0.5 rounded text-[11px] font-bold uppercase transition-all ${
                  lang === l
                    ? 'bg-ks-green text-white'
                    : 'text-white/30 hover:text-white/60 hover:bg-white/8'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>

          {/* User avatar / login */}
          <div className="px-3 py-2">
            {user ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
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
