'use client';

import { useEffect, useState } from 'react';

interface PlatformStats {
  total: number;
  success_rate: number;
  total_pledged_usd: number;
  category_count?: number;
}

function compactCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M+`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K+`;
  return String(Math.round(value));
}

function compactRaisedMillions(value: number) {
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2).replace(/\.00$/, '')}B`;
  return `$${value.toFixed(0)}M`;
}

export default function LandingStatsClient() {
  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    const load = () => {
      fetch('/api/stats')
        .then(r => r.json())
        .then(d => {
          if (d.stats) setStats(d.stats);
        })
        .catch(() => {});
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(load, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }

    const id = globalThis.setTimeout(load, 400);
    return () => globalThis.clearTimeout(id);
  }, []);

  const items = [
    {
      label: 'Campaigns',
      value: stats ? compactCount(stats.total) : '200K+',
      color: 'text-ks-green',
    },
    {
      label: 'Success rate',
      value: stats ? `${stats.success_rate.toFixed(1)}%` : '35%',
      color: 'text-white',
    },
    {
      label: 'Total raised',
      value: stats ? compactRaisedMillions(stats.total_pledged_usd) : '$2B+',
      color: 'text-white',
    },
    {
      label: 'Categories',
      value: stats?.category_count ? String(Math.max(1, Math.round(stats.category_count))) : '18',
      color: 'text-white',
    },
  ];

  return (
    <section className="border-t border-ks-green/20 bg-[#022c1c]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-5 px-6 py-7 text-center md:grid-cols-4">
        {items.map(item => (
          <div key={item.label} className="min-w-0">
            <div className={`whitespace-nowrap text-2xl font-black leading-tight sm:text-3xl md:text-4xl ${item.color}`}>
              {item.value}
            </div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-white/50">{item.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
