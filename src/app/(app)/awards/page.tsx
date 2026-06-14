'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Sparkles, Trophy } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { isZhLang } from '@/lib/i18n';

interface AwardWinner {
  award_key: string;
  name_cn: string; name_en: string;
  tagline_cn: string; tagline_en: string;
  philosophy_cn: string; philosophy_en: string;
  badge_image: string;
  accent: string;
  year: number;
  project_id: string | null;
  citation_cn: string | null; citation_en: string | null;
  project_name: string | null;
  project_blurb: string | null;
  project_image_url: string | null;
  project_thumb_url: string | null;
  project_category_parent: string | null;
  project_state: string | null;
  project_pledged_usd: number | null;
  project_backers: number | null;
}

interface AwardsData {
  year: number;
  years: number[];
  awards: AwardWinner[];
}

function fmtUsd(v: number | null) {
  const n = Number(v ?? 0);
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default function AwardsPage() {
  const [lang] = useLanguage();
  const cn = isZhLang(lang);
  const [data, setData] = useState<AwardsData | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = year ? `?year=${year}` : '';
    fetch(`/api/awards${q}`, { cache: 'no-store' })
      .then(r => r.json())
      .then((d: AwardsData) => { setData(d); if (year == null) setYear(d.year); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [year]);

  const years = data?.years?.length ? data.years : [year ?? new Date().getFullYear()];

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <Link
        href="/leaderboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-ks-green"
      >
        <ArrowLeft className="h-4 w-4" />
        {cn ? '返回排行榜' : 'Back to leaderboard'}
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 via-gray-900 to-emerald-950 px-5 py-8 text-white sm:px-8 sm:py-10">
        <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-ks-green/20 blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/80 backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" />{cn ? '由 Kicksonar 评选颁发' : 'Curated & awarded by Kicksonar'}
          </div>
          <h1 className="mt-4 flex items-center gap-3 text-3xl font-black tracking-tight">
            <Trophy className="h-8 w-8 text-amber-300" />
            {cn ? '声纳奖' : 'Kicksonar Awards'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
            {cn
              ? '我们从全站 Kickstarter 项目中，以平台之名遴选出年度最值得被看见的作品。三座奖项，三种理念——致敬最强信号、最大浪潮，以及雷达边缘的璀璨遗珠。'
              : 'In the platform’s own name, we honor the Kickstarter projects most worth seeing each year — three awards, three philosophies: the strongest signal, the biggest wave, and the brilliant gem at the radar’s edge.'}
          </p>
          {/* Year selector */}
          <div className="mt-6 flex flex-wrap gap-2">
            {years.map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                  (year ?? data?.year) === y ? 'bg-white text-gray-900' : 'bg-white/10 text-white/70 hover:bg-white/20'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <div className="py-16 text-center text-gray-400">{cn ? '加载中…' : 'Loading…'}</div>}

      {!loading && data?.awards.map(a => (
        <AwardCard key={a.award_key} award={a} cn={cn} />
      ))}

      {!loading && (data?.awards?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center text-gray-400">
          {cn ? '本年度奖项尚未公布。' : 'Awards for this year have not been announced yet.'}
        </div>
      )}
    </div>
  );
}

function AwardCard({ award, cn }: { award: AwardWinner; cn: boolean }) {
  const name = cn ? award.name_cn : award.name_en;
  const tagline = cn ? award.tagline_cn : award.tagline_en;
  const philosophy = cn ? award.philosophy_cn : award.philosophy_en;
  const citation = cn ? award.citation_cn : award.citation_en;
  const cover = award.project_image_url || award.project_thumb_url;
  const accent = award.accent || '#d4a017';

  return (
    <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
        {/* Badge side */}
        <div
          className="relative flex flex-col items-center justify-center gap-3 p-7 text-center"
          style={{ background: `radial-gradient(120% 120% at 50% 0%, ${accent}1f 0%, #ffffff 70%)` }}
        >
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: accent }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={award.badge_image} alt={name} className="h-36 w-36 object-contain drop-shadow-[0_10px_25px_rgba(0,0,0,0.18)]" />
          <div>
            <h2 className="text-xl font-black text-gray-900">{name}</h2>
            <p className="mt-0.5 text-xs font-bold uppercase tracking-wide" style={{ color: accent }}>{tagline}</p>
          </div>
          <p className="text-xs leading-relaxed text-gray-500">{philosophy}</p>
        </div>

        {/* Winner side */}
        <div className="border-t border-gray-100 p-6 md:border-l md:border-t-0">
          {award.project_id ? (
            <div className="flex h-full flex-col">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide" style={{ color: accent }}>
                <Trophy className="h-4 w-4" />{cn ? `${award.year} 年度获奖项目` : `${award.year} Winner`}
              </div>
              <Link
                href={`/projects/${award.project_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex gap-4 rounded-2xl border border-gray-100 p-3 transition-colors hover:border-gray-200 hover:bg-gray-50"
              >
                <span className="h-24 w-32 shrink-0 overflow-hidden rounded-xl bg-gray-100">
                  {cover
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={cover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    : <span className="block h-full w-full bg-gray-100" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-1.5">
                    <span className="line-clamp-2 font-bold text-gray-900 group-hover:text-ks-green">{award.project_name}</span>
                    <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-300 group-hover:text-ks-green" />
                  </span>
                  <span className="mt-1 block text-xs text-gray-400">{award.project_category_parent ?? '—'}</span>
                  <span className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-ks-green-light px-2 py-1 font-bold text-ks-green-dark">{fmtUsd(award.project_pledged_usd)}</span>
                    <span className="rounded-md bg-blue-50 px-2 py-1 font-semibold text-blue-600">{Number(award.project_backers ?? 0).toLocaleString()} {cn ? '支持者' : 'backers'}</span>
                  </span>
                </span>
              </Link>
              {citation && (
                <blockquote className="mt-4 border-l-2 pl-4 text-sm italic leading-relaxed text-gray-600" style={{ borderColor: accent }}>
                  “{citation}”
                  <span className="mt-1 block text-xs not-italic text-gray-400">— {cn ? 'Kicksonar 编辑部' : 'The Kicksonar Editors'}</span>
                </blockquote>
              )}
            </div>
          ) : (
            <div className="flex h-full min-h-[140px] flex-col items-center justify-center text-center text-gray-400">
              <Sparkles className="mb-2 h-6 w-6" />
              <p className="text-sm font-semibold">{cn ? '获奖项目敬请期待' : 'Winner coming soon'}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
