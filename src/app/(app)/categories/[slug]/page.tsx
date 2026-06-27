import type { Metadata } from 'next';
import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import {
  getCategoryList,
  getCategoryDetailStats,
  getTopProjectsByCategory,
  getMaxProjectTimestamp,
  type SeoSegmentStats,
  type SeoTopProject,
} from '@/lib/db';
import JsonLd from '@/components/JsonLd';
import {
  SITE_NAME,
  slugify,
  pageMetadata,
  breadcrumbLd,
  datasetLd,
  formatUsdCompact,
  formatInt,
} from '@/lib/seo';

export const dynamic = 'force-dynamic';

interface Loaded {
  category: string;
  stats: SeoSegmentStats;
  top: SeoTopProject[];
  others: string[];
}

const load = cache(async (slug: string): Promise<Loaded | null> => {
  const categories = await getCategoryList();
  const category = categories.find((c) => slugify(c) === slug);
  if (!category) return null;
  const stats = getCategoryDetailStats(category);
  if (!stats) return null;
  const top = getTopProjectsByCategory(category, 10);
  const others = categories.filter((c) => c !== category);
  return { category, stats, top, others };
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
  const { category, stats, top, others } = data;
  const path = `/categories/${slug}`;
  const dateModified = getMaxProjectTimestamp();

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

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="text-2xl font-black text-gray-900">{c.value}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

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

      <h2 className="mt-8 text-sm font-semibold text-gray-700">Other categories</h2>
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
