'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, X, Sparkles, Heart, Radar, LineChart, Trophy,
  TrendingUp, Users, Flame, Clock, Rocket, CheckCircle2,
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { localeOf, uiCopy } from '@/lib/i18n';

interface PushProject {
  id: string;
  name: string;
  image: string | null;
  state: string;
  currency: string;
  pledgedUsd: number;
  fundedPct: number;
  daysLeft: number | null;
  pledgedDelta24h: number;
  backersDelta24h: number;
}

interface PushPayload {
  segment: 'favorites' | 'digest' | 'new_users';
  template: 'favorites_digest' | 'platform_digest' | 'onboarding_guide';
  generatedAt: number;
  headerNote?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  favorites?: {
    totalPledgedDelta: number;
    totalBackersDelta: number;
    liveCount: number;
    items: PushProject[];
    show: { pledgedDelta: boolean; backersDelta: boolean; fundedPct: boolean; daysLeft: boolean };
  };
  digest?: {
    summary: {
      live_projects: number; pledged_delta_24h: number; backers_delta_24h: number;
      launched_24h: number; ending_24h: number; overfunded_projects: number;
    };
    sections: { key: string; title: string; metric: 'pledged' | 'backers' | 'days' | 'none'; items: PushProject[] }[];
  };
  guide?: { intro: string; steps: { icon?: string; title: string; desc: string; href?: string }[] };
}

function fmtUsd(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toLocaleString()}`;
}
function fmtNum(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString();
}

const STEP_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  radar: Radar, heart: Heart, chart: LineChart, trophy: Trophy,
};

export default function PushModal() {
  const [lang] = useLanguage();
  const copy = uiCopy[lang].push;
  const [push, setPush] = useState<PushPayload | null>(null);
  const openedAt = useRef(0);

  useEffect(() => {
    fetch('/api/push', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.push) {
          setPush(d.push);
          openedAt.current = Date.now();
          track(d.push.segment, 'view', 0);
        }
      })
      .catch(() => {});
  }, []);

  function track(segment: string, eventType: 'view' | 'dismiss' | 'click', durationMs: number) {
    fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment, eventType, durationMs }),
    }).catch(() => {});
  }

  const close = () => {
    if (!push) return;
    track(push.segment, 'dismiss', Date.now() - openedAt.current);
    setPush(null);
  };
  const clickCta = () => {
    if (!push) return;
    track(push.segment, 'click', Date.now() - openedAt.current);
  };

  if (!push) return null;

  const dateLabel = new Date(push.generatedAt * 1000).toLocaleDateString(localeOf(lang), {
    month: 'long', day: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="relative shrink-0 bg-gradient-to-br from-ks-green to-emerald-500 px-6 py-5 text-white">
          <button onClick={close} className="absolute right-3 top-3 rounded-full p-1.5 text-white/70 hover:bg-white/15 hover:text-white">
            <X className="h-5 w-5" />
          </button>
          {push.template === 'favorites_digest' && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <Heart className="h-4 w-4" /> {copy.favoritesNote}
              </div>
              <p className="mt-1.5 text-2xl font-black leading-tight">{copy.favoritesTitle}</p>
              <p className="mt-1 text-sm text-white/80">{dateLabel}</p>
            </>
          )}
          {push.template === 'platform_digest' && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <Radar className="h-4 w-4" /> {copy.platformNote}
              </div>
              <p className="mt-1.5 text-2xl font-black leading-tight">{copy.platformTitle}</p>
              <p className="mt-1 text-sm text-white/80">{dateLabel}</p>
            </>
          )}
          {push.template === 'onboarding_guide' && (
            <>
              <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <Sparkles className="h-4 w-4" /> {copy.onboardingNote}
              </div>
              <p className="mt-1.5 text-2xl font-black leading-tight">{copy.onboardingTitle}</p>
            </>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {push.headerNote && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{push.headerNote}</p>
          )}

          {/* FAVORITES */}
          {push.favorites && (
            <div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <SummaryStat icon={TrendingUp} label={copy.pledgedToday} value={`+${fmtUsd(push.favorites.totalPledgedDelta)}`} tone="green" />
                <SummaryStat icon={Users} label={copy.newBackers} value={`+${fmtNum(push.favorites.totalBackersDelta)}`} tone="blue" />
              </div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {copy.liveFavorites(push.favorites.liveCount)}
              </p>
              <ul className="space-y-2">
                {push.favorites.items.map(p => (
                  <li key={p.id}>
                    <a href={`/projects/${p.id}`} target="_blank" rel="noopener noreferrer" onClick={clickCta}
                       className="flex items-center gap-3 rounded-xl border border-gray-100 p-2.5 hover:border-ks-green/40 hover:bg-gray-50">
                      <Thumb p={p} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-gray-900">{p.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {push.favorites!.show.pledgedDelta && p.pledgedDelta24h > 0 && (
                            <Chip tone="green"><TrendingUp className="h-3 w-3" />+{fmtUsd(p.pledgedDelta24h)}</Chip>
                          )}
                          {push.favorites!.show.backersDelta && p.backersDelta24h > 0 && (
                            <Chip tone="blue"><Users className="h-3 w-3" />+{fmtNum(p.backersDelta24h)}</Chip>
                          )}
                          {push.favorites!.show.fundedPct && (
                            <Chip tone="gray">{Math.round(p.fundedPct)}%</Chip>
                          )}
                          {push.favorites!.show.daysLeft && p.daysLeft != null && (
                            <Chip tone="amber"><Clock className="h-3 w-3" />{copy.daysLeftShort(p.daysLeft)}</Chip>
                          )}
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* PLATFORM DIGEST */}
          {push.digest && (
            <div>
              <div className="mb-4 grid grid-cols-3 gap-2">
                <SummaryStat icon={Radar} label={copy.live} value={fmtNum(push.digest.summary.live_projects)} tone="green" small />
                <SummaryStat icon={Rocket} label={copy.launched} value={fmtNum(push.digest.summary.launched_24h)} tone="blue" small />
                <SummaryStat icon={CheckCircle2} label={copy.funded} value={fmtNum(push.digest.summary.overfunded_projects)} tone="emerald" small />
                <SummaryStat icon={TrendingUp} label={copy.pledged24h} value={`+${fmtUsd(push.digest.summary.pledged_delta_24h)}`} tone="green" small />
                <SummaryStat icon={Users} label={copy.backers24h} value={`+${fmtNum(push.digest.summary.backers_delta_24h)}`} tone="blue" small />
                <SummaryStat icon={Clock} label={copy.ending} value={fmtNum(push.digest.summary.ending_24h)} tone="amber" small />
              </div>
              <div className="space-y-4">
                {push.digest.sections.map(sec => (
                  <div key={sec.key}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                      <SectionIcon k={sec.key} /> {sectionTitle(sec.key, copy) ?? sec.title}
                    </p>
                    <ul className="space-y-1.5">
                      {sec.items.map(p => (
                        <li key={p.id}>
                          <a href={`/projects/${p.id}`} target="_blank" rel="noopener noreferrer" onClick={clickCta}
                             className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-gray-50">
                            <Thumb p={p} small />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-800">{p.name}</span>
                            <DigestMetric metric={sec.metric} p={p} copy={copy} />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ONBOARDING */}
          {push.guide && (
            <div>
              {push.guide.intro && <p className="mb-4 text-sm leading-6 text-gray-600">{push.guide.intro}</p>}
              <ul className="space-y-3">
                {push.guide.steps.map((s, i) => {
                  const Icon = STEP_ICONS[s.icon ?? ''] ?? Sparkles;
                  const inner = (
                    <div className="flex items-start gap-3 rounded-xl border border-gray-100 p-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ks-green/10 text-ks-green">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900">{s.title}</p>
                        <p className="mt-0.5 text-sm leading-5 text-gray-600">{s.desc}</p>
                      </div>
                      {s.href && <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-gray-300" />}
                    </div>
                  );
                  return (
                    <li key={i}>
                      {s.href
                        ? <a href={s.href} target="_blank" rel="noopener noreferrer" onClick={clickCta} className="block hover:[&>div]:border-ks-green/40">{inner}</a>
                        : inner}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          <button onClick={close} className="text-sm font-semibold text-gray-400 hover:text-gray-700">
            {copy.maybeLater}
          </button>
          {push.ctaUrl && (
            <a href={push.ctaUrl} onClick={clickCta}
               className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800">
              {push.ctaLabel || copy.explore}
              <ArrowRight className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Thumb({ p, small }: { p: PushProject; small?: boolean }) {
  const size = small ? 'h-8 w-8' : 'h-11 w-11';
  if (p.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={p.image} alt="" className={`${size} shrink-0 rounded-lg object-cover`} />;
  }
  return <span className={`${size} shrink-0 rounded-lg bg-gray-100`} />;
}

function Chip({ tone, children }: { tone: 'green' | 'blue' | 'gray' | 'amber'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    gray: 'bg-gray-100 text-gray-600',
    amber: 'bg-amber-50 text-amber-700',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

function SummaryStat({ icon: Icon, label, value, tone, small }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string;
  tone: 'green' | 'blue' | 'amber' | 'emerald'; small?: boolean;
}) {
  const tones = {
    green: 'text-emerald-600', blue: 'text-blue-600', amber: 'text-amber-600', emerald: 'text-emerald-600',
  };
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
      <div className={`flex items-center gap-1.5 ${tones[tone]}`}>
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold text-gray-500">{label}</span>
      </div>
      <p className={`mt-1 font-black text-gray-900 ${small ? 'text-base' : 'text-lg'}`}>{value}</p>
    </div>
  );
}

function SectionIcon({ k }: { k: string }) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    fastestFunding: Flame, fastestBackers: Users, newlyLaunched: Rocket, endingSoon: Clock,
  };
  const Icon = map[k] ?? TrendingUp;
  return <Icon className="h-3.5 w-3.5" />;
}

function sectionTitle(k: string, copy: ReturnType<typeof getPushCopy>): string | null {
  return copy.sections[k as keyof typeof copy.sections] ?? null;
}

function getPushCopy() {
  return uiCopy.en.push;
}

function DigestMetric({ metric, p, copy }: { metric: string; p: PushProject; copy: ReturnType<typeof getPushCopy> }) {
  if (metric === 'pledged') return <Chip tone="green"><TrendingUp className="h-3 w-3" />+{fmtUsd(p.pledgedDelta24h)}</Chip>;
  if (metric === 'backers') return <Chip tone="blue"><Users className="h-3 w-3" />+{fmtNum(p.backersDelta24h)}</Chip>;
  if (metric === 'days') return <Chip tone="amber"><Clock className="h-3 w-3" />{p.daysLeft != null ? copy.daysLeftShort(p.daysLeft) : '—'}</Chip>;
  return <Chip tone="gray">{fmtUsd(p.pledgedUsd)}</Chip>;
}
