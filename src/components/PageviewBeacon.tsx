'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

function getSessionId(): string {
  try {
    let s = sessionStorage.getItem('ks_sid');
    if (!s) {
      s = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('ks_sid', s);
    }
    return s;
  } catch {
    return 'na';
  }
}

// Collapse dynamic segments so top-pages aggregation stays clean (the concrete
// project id is captured separately as a server-side project_view).
function normalizePath(path: string): string {
  return path
    .replace(/^\/projects\/[^/]+$/, '/projects/[id]')
    .replace(/^\/projects\/[^/]+\/.*/, '/projects/[id]');
}

/**
 * Fires a `pageview` analytics event on every client route change. Mounted once
 * inside AppShell so it covers all in-app pages.
 */
export default function PageviewBeacon() {
  const pathname = usePathname();
  const lastPath = useRef<string>('');

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    const body = JSON.stringify({
      event_type: 'pageview',
      path: normalizePath(pathname),
      session_id: getSessionId(),
    });
    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch {
      fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
    }
  }, [pathname]);

  return null;
}
