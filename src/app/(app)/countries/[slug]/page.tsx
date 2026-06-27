import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import {
  getCountryList,
  getCountryDetailStats,
  getCountryFundingStats,
  getOverallSuccessRate,
  getTopProjectsByCountry,
  getMaxProjectTimestamp,
  type SeoSegmentStats,
  type SeoFundingStats,
  type SeoTopProject,
} from '@/lib/db';
import JsonLd from '@/components/JsonLd';
import {
  SITE_NAME,
  slugify,
  pageMetadata,
  breadcrumbLd,
  datasetLd,
  itemListLd,
  faqLd,
  formatUsdCompact,
  formatInt,
  type FaqItem,
} from '@/lib/seo';

export const dynamic = 'force-dynamic';

interface Loaded {
  code: string;
  name: string;
  stats: SeoSegmentStats;
  funding: SeoFundingStats | null;
  overall: number;
  top: SeoTopProject[];
  others: { country: string; country_name: string }[];
}

const load = cache(async (slug: string): Promise<Loaded | null> => {
  const countries = await getCountryList();
  const match = countries.find((c) => c.country.toLowerCase() === slug.toLowerCase());
  if (!match) return null;
  const stats = getCountryDetailStats(match.country);
  if (!stats) return null;
  const funding = getCountryFundingStats(match.country);
  const overall = getOverallSuccessRate();
  const top = getTopProjectsByCountry(match.country, 10);
  const others = countries.filter((c) => c.country !== match.country).slice(0, 24);
  return { code: match.country, name: match.country_name || match.country, stats, funding, overall, top, others };
});

const YEAR = new Date().getFullYear();

function titleFor(name: string): string {
  return `Kickstarter in ${name} — Crowdfunding Statistics ${YEAR} | ${SITE_NAME}`;
}

function summaryFor(name: string, s: SeoSegmentStats): string {
  return (
    `Kicksonar has tracked ${formatInt(s.total)} ended Kickstarter campaigns from ${name}. ` +
    `${formatInt(s.successful)} were successfully funded — a ${s.success_rate}% success rate — ` +
    `raising a combined ${formatUsdCompact(s.total_pledged_m * 1_000_000)} from ${formatInt(s.total_backers)} backers, ` +
    `averaging ${formatUsdCompact(s.avg_pledged)} per campaign. ` +
    `Compare ${name}'s crowdfunding performance against other countries before planning a launch.`
  );
}

function avgBackers(s: SeoSegmentStats): number {
  return s.total ? Math.round(s.total_backers / s.total) : 0;
}

function hardnessAnswer(name: string, s: SeoSegmentStats, overall: number): string {
  const diff = Number((s.success_rate - overall).toFixed(1));
  const rel = diff >= 2 ? 'above' : diff <= -2 ? 'below' : 'in line with';
  const cmp = diff >= 2 ? 'easier' : diff <= -2 ? 'harder' : 'about as hard';
  return (
    `${s.success_rate}% of ended Kickstarter campaigns from ${name} reached their funding goal, ` +
    `${rel} the ${overall}% Kickstarter-wide average. ` +
    `That makes getting funded from ${name} ${cmp} than the global Kickstarter average. ` +
    `Of ${formatInt(s.total)} ended campaigns from ${name}, ${formatInt(s.successful)} succeeded and ${formatInt(s.failed)} fell short.`
  );
}

function goalAnswer(name: string, f: SeoFundingStats | null): string {
  if (!f || !f.median_pledged_successful) {
    return `Funding outcomes for campaigns from ${name} vary widely; review the top campaigns below for concrete reference points.`;
  }
  return (
    `Successful Kickstarter campaigns from ${name} raised a median of ${formatUsdCompact(f.median_pledged_successful)} ` +
    `(average ${formatUsdCompact(f.avg_pledged_successful)}). ` +
    `The median is the more realistic target, since a few breakout campaigns pull the average up.`
  );
}

function buildFaq(name: string, s: SeoSegmentStats, f: SeoFundingStats | null): FaqItem[] {
  const faq: FaqItem[] = [
    {
      question: `What percentage of Kickstarter campaigns from ${name} succeed?`,
      answer: `${s.success_rate}% of the ${formatInt(s.total)} ended Kickstarter campaigns from ${name} tracked by Kicksonar reached their funding goal (${formatInt(s.successful)} successful, ${formatInt(s.failed)} failed).`,
    },
    {
      question: `How much do Kickstarter campaigns from ${name} raise?`,
      answer: `Kickstarter campaigns from ${name} have raised a combined ${formatUsdCompact(s.total_pledged_m * 1_000_000)} from ${formatInt(s.total_backers)} backers, averaging ${formatUsdCompact(s.avg_pledged)} per campaign.`,
    },
  ];
  if (f && f.median_pledged_successful) {
    faq.push({
      question: `What is a realistic funding goal for a Kickstarter in ${name}?`,
      answer: `Successful campaigns from ${name} raised a median of ${formatUsdCompact(f.median_pledged_successful)} and an average of ${formatUsdCompact(f.avg_pledged_successful)} — a useful reference range when setting your goal.`,
    });
  }
  faq.push({
    question: `How many backers does a typical Kickstarter from ${name} get?`,
    answer: `Kickstarter campaigns from ${name} average ${formatInt(avgBackers(s))} backers each, totaling ${formatInt(s.total_backers)} backers across all tracked ${name} campaigns.`,
  });
  return faq;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) {
    return pageMetadata({
      title: `Country not found | ${SITE_NAME}`,
      description: 'This country could not be found on Kicksonar.',
      path: `/countries/${slug}`,
      noindex: true,
    });
  }
  return pageMetadata({
    title: titleFor(data.name),
    description: summaryFor(data.name, data.stats).slice(0, 300),
    path: `/countries/${slug}`,
    ogType: 'article',
  });
}

export default async function CountryStatsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { code, name, stats, funding, overall, top, others } = data;
  const path = `/countries/${code.toLowerCase()}`;
  const dateModified = getMaxProjectTimestamp();
  const faq = buildFaq(name, stats, funding);

  const cards = [
    { label: 'Ended campaigns', value: formatInt(stats.total) },
    { label: 'Success rate', value: `${stats.success_rate}%` },
    { label: 'Total raised', value: formatUsdCompact(stats.total_pledged_m * 1_000_000) },
    { label: 'Avg pledged', value: formatUsdCompact(stats.avg_pledged) },
    { label: 'Total backers', value: formatInt(stats.total_backers) },
    { label: 'Successful', value: formatInt(stats.successful) },
  ];

  return (
    <div className="max-w-5xl mx-auto px-1 py-2">
      <JsonLd
        data={[
          datasetLd({
            name: `Kickstarter crowdfunding statistics for ${name}`,
            description: summaryFor(name, stats),
            path,
            keywords: [`Kickstarter ${name}`, `crowdfunding ${name}`, `${name} success rate`],
            dateModified: dateModified ? new Date(dateModified * 1000).toISOString().slice(0, 10) : undefined,
          }),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Countries', path: '/countries' },
            { name, path },
          ]),
          itemListLd(
            `Top Kickstarter campaigns from ${name} by funds raised`,
            top.map((p) => ({ name: p.name, path: `/projects/${p.id}` })),
          ),
          faqLd(faq),
        ]}
      />

      <nav className="text-xs text-gray-500 mb-3">
        <Link href="/" className="hover:text-ks-green">Home</Link>
        {' / '}
        <Link href="/countries" className="hover:text-ks-green">Countries</Link>
        {' / '}
        <span className="text-gray-700">{name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900">Kickstarter in {name} — Statistics {YEAR}</h1>
      <p className="mt-3 text-gray-600 leading-relaxed">{summaryFor(name, stats)}</p>
      <p className="mt-3 text-gray-600 leading-relaxed">
        These benchmarks are computed from Kicksonar&apos;s full history of ended Kickstarter
        campaigns originating in {name}, sourced from public Kickstarter datasets. Use them to
        compare {name} against other countries and set realistic expectations before launching.
      </p>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-black text-gray-900">{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">
        How hard is it to get funded on Kickstarter from {name}?
      </h2>
      <p className="mt-3 text-gray-600 leading-relaxed">{hardnessAnswer(name, stats, overall)}</p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">
        What&apos;s a realistic funding goal for a campaign in {name}?
      </h2>
      <p className="mt-3 text-gray-600 leading-relaxed">{goalAnswer(name, funding)}</p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">Top campaigns from {name}</h2>
      <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {top.map((p, i) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
          >
            <span className="w-6 shrink-0 text-sm font-semibold text-gray-400">{i + 1}</span>
            <span className="flex-1 min-w-0">
              <span className="block truncate font-medium text-gray-900">{p.name}</span>
              {p.category_name && (
                <span className="block truncate text-xs text-gray-500">{p.category_name}</span>
              )}
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-semibold text-ks-green">{formatUsdCompact(p.usd_pledged)}</span>
              <span className="block text-xs text-gray-500">{formatInt(p.backers_count)} backers</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <Link href={`/projects?country=${encodeURIComponent(code)}`} className="text-ks-green font-medium hover:underline">
          Browse all projects from {name} →
        </Link>
        <Link href="/countries" className="text-gray-500 hover:underline">All countries →</Link>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-gray-900">Kickstarter {name} FAQ</h2>
      <div className="mt-3 space-y-4">
        {faq.map((item) => (
          <div key={item.question}>
            <h3 className="font-semibold text-gray-900">{item.question}</h3>
            <p className="mt-1 text-gray-600 leading-relaxed">{item.answer}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold text-gray-700">Other countries</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {others.map((c) => (
          <Link
            key={c.country}
            href={`/countries/${c.country.toLowerCase()}`}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-ks-green hover:text-ks-green"
          >
            {c.country_name || c.country}
          </Link>
        ))}
      </div>
    </div>
  );
}
