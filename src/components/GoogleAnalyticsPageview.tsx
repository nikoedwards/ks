'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export default function GoogleAnalyticsPageview({ measurementId }: { measurementId: string }) {
  const pathname = usePathname();
  const lastPath = useRef<string>('');

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || ((...args: unknown[]) => {
      window.dataLayer?.push(args);
    });

    window.gtag('config', measurementId, {
      page_path: pathname,
    });
  }, [measurementId, pathname]);

  return null;
}
