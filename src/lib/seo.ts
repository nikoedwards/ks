// Centralized SEO/GEO helpers: site constants, metadata builders, JSON-LD
// constructors, and the project-indexing quality gate. Keep this framework-only
// (no JSX) so it can be imported from any server component or route.

import type { Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://kicksonar.com').replace(/\/+$/, '');
export const SITE_NAME = 'Kicksonar';
export const SITE_DESCRIPTION =
  'Kicksonar is a Kickstarter analytics platform for exploring crowdfunding campaign data, benchmarking categories, and spotting launch opportunities.';

// Brand entity signals (sameAs) — the single biggest GEO lever for AI search,
// which weighs off-site brand presence heavily. Add ONLY real, owned profiles
// (never fabricate). Create and paste the live URLs as they go up:
//   - X / Twitter:      https://x.com/<handle>
//   - LinkedIn company: https://www.linkedin.com/company/<slug>
//   - Product Hunt:     https://www.producthunt.com/products/<slug>
//   - Crunchbase:       https://www.crunchbase.com/organization/<slug>
//   - Reddit:           https://www.reddit.com/user/<handle>  (or a subreddit)
export const ORG_SAME_AS = [
  'https://github.com/nikoedwards/ks',
];

export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Join a path onto the canonical site origin. `'/'` returns the bare origin. */
export function absoluteUrl(path = '/'): string {
  if (!path || path === '/') return SITE_URL;
  return `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** URL-safe slug: lowercase, `&` -> `and`, non-alphanumerics -> single hyphen. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Compact USD for titles/descriptions, e.g. 5_599_379 -> "$5.6M", 1.4e9 -> "$1.4B". */
export function formatUsdCompact(n: number | null | undefined): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 10_000_000) return `$${Math.round(v / 1_000_000)}M`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export function formatInt(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(Math.round(Number(n) || 0));
}

// ── Page metadata builder ────────────────────────────────────────────────────

export interface PageMetaInput {
  title: string;
  description: string;
  /** Path relative to the site origin, e.g. `/projects` or `/projects/123`. */
  path: string;
  /** When true, emit robots noindex (still follow) for thin/low-value pages. */
  noindex?: boolean;
  ogType?: 'website' | 'article';
}

/**
 * Build a complete, canonical-aware Metadata object. og:image / twitter:image
 * are intentionally omitted so Next.js file-based `opengraph-image` routes
 * supply them (a real PNG that social platforms can render).
 */
export function pageMetadata({ title, description, path, noindex, ogType = 'website' }: PageMetaInput): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    alternates: { canonical: url },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      type: ogType,
      url,
      siteName: SITE_NAME,
      title,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

// ── Project indexing quality gate (curated) ──────────────────────────────────

export const INDEX_MIN_PLEDGED_USD = 1000;
export const INDEX_MIN_BACKERS = 10;

export interface IndexableProjectFields {
  state?: string | null;
  staff_pick?: number | null;
  usd_pledged?: number | null;
  backers_count?: number | null;
}

/**
 * Curated indexing gate: a project page is worth indexing when it is live or
 * successful, a staff pick, or has meaningful traction. Everything else
 * (tiny/failed long-tail) is rendered noindex and kept out of the sitemap to
 * avoid thin-content / index-bloat penalties across the 200k+ corpus.
 */
export function isProjectIndexable(p: IndexableProjectFields): boolean {
  const state = String(p.state ?? '').toLowerCase();
  if (state === 'live' || state === 'successful') return true;
  if (Number(p.staff_pick) === 1) return true;
  return (
    Number(p.usd_pledged ?? 0) >= INDEX_MIN_PLEDGED_USD &&
    Number(p.backers_count ?? 0) >= INDEX_MIN_BACKERS
  );
}

// ── JSON-LD constructors ─────────────────────────────────────────────────────
// All return plain objects; render them with the <JsonLd> component.

export type JsonLdNode = Record<string, unknown>;

export function organizationLd(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORG_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
    sameAs: ORG_SAME_AS,
    description: SITE_DESCRIPTION,
  };
}

export function websiteLd(): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { '@id': ORG_ID },
    description: SITE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/projects?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbLd(items: BreadcrumbItem[]): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };
}

export interface ProjectLdInput {
  id: string;
  name: string;
  blurb?: string | null;
  path: string;
  category_parent?: string | null;
  category_name?: string | null;
  creator_name?: string | null;
  creator_url?: string | null;
  source_url?: string | null;
  image_url?: string | null;
  launched_at?: number | null;
  state?: string | null;
}

/**
 * Model a crowdfunding campaign as a CreativeWork. We deliberately avoid
 * fabricating ratings/offers; only properties backed by real data are emitted.
 */
export function projectCreativeWorkLd(p: ProjectLdInput): JsonLdNode {
  const url = absoluteUrl(p.path);
  const genre = [p.category_parent, p.category_name].filter(Boolean).join(' / ') || undefined;
  const node: JsonLdNode = {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    '@id': `${url}#campaign`,
    name: p.name,
    url,
    isPartOf: { '@id': WEBSITE_ID },
  };
  if (p.blurb) node.description = p.blurb;
  if (genre) node.genre = genre;
  if (p.image_url) node.image = p.image_url;
  if (p.source_url) node.sameAs = p.source_url;
  if (p.launched_at) node.datePublished = new Date(p.launched_at * 1000).toISOString().slice(0, 10);
  if (p.creator_name) {
    node.creator = {
      '@type': 'Person',
      name: p.creator_name,
      ...(p.creator_url ? { url: p.creator_url } : {}),
    };
  }
  return node;
}

export interface DatasetLdInput {
  name: string;
  description: string;
  path: string;
  keywords?: string[];
  dateModified?: string;
}

/** Statistics / data-insight pages describe an aggregate Dataset. */
export function datasetLd({ name, description, path, keywords, dateModified }: DatasetLdInput): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    url: absoluteUrl(path),
    isPartOf: { '@id': WEBSITE_ID },
    creator: { '@id': ORG_ID },
    ...(keywords && keywords.length ? { keywords } : {}),
    ...(dateModified ? { dateModified } : {}),
  };
}

export interface ItemListEntry {
  name: string;
  path: string;
}

/** Ordered list (e.g. "top campaigns by funds raised") as schema.org ItemList. */
export function itemListLd(name: string, items: ItemListEntry[]): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: absoluteUrl(it.path),
    })),
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

/**
 * Editorial FAQ as schema.org FAQPage. Note: Google retired FAQ rich results in
 * May 2026, so this no longer yields a SERP feature — it is kept for AI-search
 * citation (ChatGPT/Perplexity/AI Overviews parse Q&A pairs).
 */
export function faqLd(items: FaqItem[]): JsonLdNode {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((it) => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: { '@type': 'Answer', text: it.answer },
    })),
  };
}

export function collectionPageLd(name: string, description: string, path: string): JsonLdNode {
  const url = absoluteUrl(path);
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    isPartOf: { '@id': WEBSITE_ID },
  };
}
