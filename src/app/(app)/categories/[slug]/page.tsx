import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import {
  getCategoryList,
  getCategoryDetailStats,
  getCategoryFundingStats,
  getOverallSuccessRate,
  getTopProjectsByCategory,
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
  category: string;
  stats: SeoSegmentStats;
  funding: SeoFundingStats | null;
  overall: number;
  top: SeoTopProject[];
  others: string[];
}

const load = cache(async (slug: string): Promise<Loaded | null> => {
  const categories = await getCategoryList();
  const category = categories.find((c) => slugify(c) === slug);
  if (!category) return null;
  const stats = getCategoryDetailStats(category);
  if (!stats) return null;
  const funding = getCategoryFundingStats(category);
  const overall = getOverallSuccessRate();
  const top = getTopProjectsByCategory(category, 10);
  const others = categories.filter((c) => c !== category);
  return { category, stats, funding, overall, top, others };
});

const YEAR = new Date().getFullYear();

function titleFor(category: string): string {
  return `Kickstarter ${category} Statistics ${YEAR} — Success Rate & Funding | ${SITE_NAME}`;
}

function summaryFor(category: string, s: SeoSegmentStats): string {
  return (
    `Kicksonar has tracked ${formatInt(s.total)} ended Kickstarter ${category} campaigns. ` +
    `${formatInt(s.successful)} reached their funding goal — a ${s.success_rate}% success rate — ` +
    `raising a combined ${formatUsdCompact(s.total_pledged_m * 1_000_000)} from ${formatInt(s.total_backers)} backers, ` +
    `averaging ${formatUsdCompact(s.avg_pledged)} pledged per campaign. ` +
    `Use these ${category} benchmarks to set a realistic goal and gauge demand before launching.`
  );
}

function avgBackers(s: SeoSegmentStats): number {
  return s.total ? Math.round(s.total_backers / s.total) : 0;
}

function hardnessAnswer(category: string, s: SeoSegmentStats, overall: number): string {
  const diff = Number((s.success_rate - overall).toFixed(1));
  const rel = diff >= 2 ? 'above' : diff <= -2 ? 'below' : 'in line with';
  const cmp = diff >= 2 ? 'easier' : diff <= -2 ? 'harder' : 'about as hard';
  return (
    `${s.success_rate}% of ended Kickstarter ${category} campaigns reached their funding goal, ` +
    `${rel} the ${overall}% Kickstarter-wide average. ` +
    `That makes getting funded in ${category} ${cmp} than the typical Kickstarter category. ` +
    `Of ${formatInt(s.total)} ended ${category} campaigns, ${formatInt(s.successful)} succeeded and ${formatInt(s.failed)} fell short.`
  );
}

function goalAnswer(category: string, f: SeoFundingStats | null): string {
  if (!f || !f.median_pledged_successful) {
    return `Funding outcomes for ${category} campaigns vary widely; review the top campaigns below for concrete reference points.`;
  }
  return (
    `Successful Kickstarter ${category} campaigns raised a median of ${formatUsdCompact(f.median_pledged_successful)} ` +
    `(average ${formatUsdCompact(f.avg_pledged_successful)}). ` +
    `Because a few breakout campaigns pull the average up, the median is the more realistic target — ` +
    `a goal near or below it is generally more achievable than an outlier figure.`
  );
}

function buildFaq(category: string, s: SeoSegmentStats, f: SeoFundingStats | null): FaqItem[] {
  const faq: FaqItem[] = [
    {
      question: `What percentage of Kickstarter ${category} projects succeed?`,
      answer: `${s.success_rate}% of the ${formatInt(s.total)} ended Kickstarter ${category} campaigns tracked by Kicksonar reached their funding goal (${formatInt(s.successful)} successful, ${formatInt(s.failed)} failed).`,
    },
    {
      question: `How much money do Kickstarter ${category} campaigns raise?`,
      answer: `Kickstarter ${category} campaigns have raised a combined ${formatUsdCompact(s.total_pledged_m * 1_000_000)} from ${formatInt(s.total_backers)} backers, averaging ${formatUsdCompact(s.avg_pledged)} per campaign.`,
    },
  ];
  if (f && f.median_pledged_successful) {
    faq.push({
      question: `What is a realistic funding goal for a ${category} Kickstarter?`,
      answer: `Successful ${category} campaigns raised a median of ${formatUsdCompact(f.median_pledged_successful)} and an average of ${formatUsdCompact(f.avg_pledged_successful)} — a useful reference range when setting your goal.`,
    });
  }
  faq.push({
    question: `How many backers does a typical ${category} Kickstarter get?`,
    answer: `Kickstarter ${category} campaigns average ${formatInt(avgBackers(s))} backers each, totaling ${formatInt(s.total_backers)} backers across all tracked ${category} campaigns.`,
  });
  return faq;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) {
    return pageMetadata({
      title: `Category not found | ${SITE_NAME}`,
      description: 'This Kickstarter category could not be found on Kicksonar.',
      path: `/categories/${slug}`,
      noindex: true,
    });
  }
  return pageMetadata({
    title: titleFor(data.category),
    description: summaryFor(data.category, data.stats).slice(0, 300),
    path: `/categories/${slug}`,
    ogType: 'article',
  });
}

export default async function CategoryStatsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { category, stats, funding, overall, top, others } = data;
  const path = `/categories/${slug}`;
  const dateModified = getMaxProjectTimestamp();
  const faq = buildFaq(category, stats, funding);

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
            name: `Kickstarter ${category} statistics`,
            description: summaryFor(category, stats),
            path,
            keywords: [`Kickstarter ${category}`, `${category} crowdfunding`, `${category} success rate`],
            dateModified: dateModified ? new Date(dateModified * 1000).toISOString().slice(0, 10) : undefined,
          }),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Categories', path: '/categories' },
            { name: category, path },
          ]),
          itemListLd(
            `Top Kickstarter ${category} campaigns by funds raised`,
            top.map((p) => ({ name: p.name, path: `/projects/${p.id}` })),
          ),
          faqLd(faq),
        ]}
      />

      <nav className="text-xs text-gray-500 mb-3">
        <Link href="/" className="hover:text-ks-green">Home</Link>
        {' / '}
        <Link href="/categories" className="hover:text-ks-green">Categories</Link>
        {' / '}
        <span className="text-gray-700">{category}</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900">
        Kickstarter {category} Statistics {YEAR}
      </h1>
      <p className="mt-3 text-gray-600 leading-relaxed">{summaryFor(category, stats)}</p>
      <p className="mt-3 text-gray-600 leading-relaxed">
        The benchmarks below are computed from Kicksonar&apos;s full history of ended Kickstarter{' '}
        {category} campaigns, sourced from public Kickstarter datasets. Use them to gauge demand,
        set a realistic funding goal, and study the campaigns that raised the most in {category}.
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
        How hard is it to get funded in {category} on Kickstarter?
      </h2>
      <p className="mt-3 text-gray-600 leading-relaxed">{hardnessAnswer(category, stats, overall)}</p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">
        What&apos;s a realistic funding goal for a {category} campaign?
      </h2>
      <p className="mt-3 text-gray-600 leading-relaxed">{goalAnswer(category, funding)}</p>

      <h2 className="mt-8 text-lg font-semibold text-gray-900">
        Top {category} campaigns by funds raised
      </h2>
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
              {p.creator_name && (
                <span className="block truncate text-xs text-gray-500">by {p.creator_name}</span>
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
        <Link href={`/projects?category=${encodeURIComponent(category)}`} className="text-ks-green font-medium hover:underline">
          Browse all {category} projects →
        </Link>
        <Link href="/analysis" className="text-gray-500 hover:underline">Full data analysis →</Link>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-gray-900">
        Kickstarter {category} FAQ
      </h2>
      <div className="mt-3 space-y-4">
        {faq.map((item) => (
          <div key={item.question}>
            <h3 className="font-semibold text-gray-900">{item.question}</h3>
            <p className="mt-1 text-gray-600 leading-relaxed">{item.answer}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-sm font-semibold text-gray-700">Other categories</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {others.map((c) => (
          <Link
            key={c}
            href={`/categories/${slugify(c)}`}
            className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs text-gray-600 hover:border-ks-green hover:text-ks-green"
          >
            {c}
          </Link>
        ))}
      </div>
    </div>
  );
}
