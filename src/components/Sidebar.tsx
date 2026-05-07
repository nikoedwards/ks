'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  Tag,
  TrendingUp,
  Globe,
  Settings,
  Info,
  Github,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

export default function Sidebar() {
  const pathname = usePathname();
  const [lang, setLang] = useLanguage();
  const tr = t[lang].nav;

  const nav = [
    { href: '/', label: tr.overview, icon: LayoutDashboard },
    { href: '/projects', label: tr.projects, icon: Search },
    { href: '/categories', label: tr.categories, icon: Tag },
    { href: '/trends', label: tr.trends, icon: TrendingUp },
    { href: '/countries', label: tr.countries, icon: Globe },
    { href: '/settings', label: tr.sync, icon: Settings },
  ];

  return (
    <aside className="w-56 bg-[#1a1a1a] text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Kicksonar" width={28} height={28} className="shrink-0" />
          <div>
            <div className="font-bold text-base leading-tight">Kicksonar</div>
            <div className="text-[10px] text-white/40 leading-tight">{tr.subtitle}</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3 px-2.5 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                active
                  ? 'bg-ks-green text-white shadow-sm'
                  : 'text-white/60 hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
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
          {(['cn', 'en'] as const).map(l => (
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
      </div>
    </aside>
  );
}
