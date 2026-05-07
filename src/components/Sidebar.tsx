'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  Tag,
  TrendingUp,
  Globe,
  Settings,
  RefreshCw,
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
    <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-5 h-5 text-blue-400" />
          <span className="font-bold text-lg">KS Analytics</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">Kickstarter 数据平台</p>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-gray-700">
        <p className="text-xs text-gray-500">数据来源: webrobots.io</p>
        <p className="text-xs text-gray-500 mt-0.5">每月15日自动更新</p>
      </div>
    </aside>
  );
}
