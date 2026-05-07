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

const nav = [
  { href: '/', label: '数据概览', icon: LayoutDashboard },
  { href: '/projects', label: '项目列表', icon: Search },
  { href: '/categories', label: '类目分析', icon: Tag },
  { href: '/trends', label: '趋势分析', icon: TrendingUp },
  { href: '/countries', label: '国家分析', icon: Globe },
  { href: '/settings', label: '数据同步', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-[#1a1a1a] text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.svg" alt="Kicksonar" width={28} height={28} className="shrink-0" />
          <div>
            <div className="font-bold text-base leading-tight">Kicksonar</div>
            <div className="text-[10px] text-white/40 leading-tight">Kickstarter 数据平台</div>
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
          关于 Kicksonar
        </Link>
        <a
          href="https://github.com/nikoedwards/ks"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-white/40 hover:bg-white/8 hover:text-white/70 transition-all"
        >
          <Github className="w-3.5 h-3.5 shrink-0" />
          GitHub
        </a>
      </div>
    </aside>
  );
}
