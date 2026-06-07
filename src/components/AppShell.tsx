'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import PageviewBeacon from '@/components/PageviewBeacon';
import GlobalSearch from '@/components/GlobalSearch';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  const closeNav = () => setMobileNavOpen(false);

  // The global search bar sits at the top of every user-facing view. Admin views
  // (data-quality + /admin/*) are operational tools and don't need it.
  const showSearch = !pathname.startsWith('/admin') && !pathname.startsWith('/data-quality');

  // Close the drawer on any route change (covers back/forward navigation too).
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <PageviewBeacon />
      <Sidebar mobileOpen={mobileNavOpen} onNavigate={closeNav} onClose={closeNav} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile top bar — only visible below the lg breakpoint. */}
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            className="-ml-1 rounded-lg p-1.5 text-gray-600 hover:bg-gray-100"
          >
            <Menu className="h-6 w-6" />
          </button>
          <Link href="/" className="flex items-center gap-2" onClick={closeNav}>
            <Image src="/logo.svg" alt="Kicksonar" width={24} height={24} className="shrink-0" />
            <span className="font-bold text-gray-900">Kicksonar</span>
          </Link>
        </header>
        {/* Frozen global search — stays put while the view below scrolls. */}
        {showSearch && (
          <div className="z-30 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur-sm sm:px-6">
            <GlobalSearch />
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
