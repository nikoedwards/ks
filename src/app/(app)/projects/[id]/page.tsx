import type { Metadata } from 'next';
import { cache } from 'react';
import JsonLd from '@/components/JsonLd';
import ProjectDetailClient, { type Project } from './ProjectDetailClient';
import { loadCoreSeoProject } from '@/lib/coreSeo';
import {
  SITE_NAME,
  WEBSITE_ID,
  absoluteUrl,
  pageMetadata,
  isProjectIndexable,
  projectCreativeWorkLd,
  breadcrumbLd,
  formatUsdCompact,
  formatInt,
} from '@/lib/seo';

// Detail pages read per-request from Core, so render dynamically (never try to
// resolve Railway private networking during the Web image build).
export const dynamic = 'force-dynamic';

type Row = Record<string, unknown>;

// Page server components can receive the dynamic segment still percent-encoded
// (e.g. a "kt:" id arrives as "kt%3A..."), unlike route handlers. Decode so the
// Core lookup matches the stored id.
function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function isIndiegogoId(id: string): boolean {
  return id.startsWith('igg-');
}

const loadRow = cache(async (id: string): Promise<Row | null> => {
  try {
    return await loadCoreSeoProject(id);
  } catch {
    return null;
  }
});

function str(v: unknown): string {
  return v == null ? '' : String(v);
}

function buildTitleDescription(p: Row): { title: string; description: string } {
  const name = str(p.name) || 'Kickstarter project';
  const category = [str(p.category_parent), str(p.category_name)].filter(Boolean).join(' / ');
  const pledged = Number(p.usd_pledged ?? 0);
  const backers = Number(p.backers_count ?? 0);
  const creator = str(p.creator_name);
  const platform = isIndiegogoId(str(p.id)) ? 'Indiegogo' : 'Kickstarter';

  const stats =
    pledged > 0
      ? `${formatUsdCompact(pledged)} raised${backers > 0 ? ` from ${formatInt(backers)} backers` : ''}`
      : '';

  const title = stats
    ? `${name} — ${stats} | ${SITE_NAME}`
    : `${name} — ${platform}${category ? ` ${category}` : ''} campaign | ${SITE_NAME}`;

  const stateWord =
    str(p.state) === 'live' ? 'Currently live' :
    str(p.state) === 'successful' ? 'Successfully funded' :
    str(p.state) === 'failed' ? 'Did not reach its goal' : 'Tracked';

  const parts = [
    p.blurb ? str(p.blurb) : '',
    `${name} is a ${platform}${category ? ` ${category}` : ''} campaign${creator ? ` by ${creator}` : ''}.`,
    stats ? `${stateWord} with ${stats}.` : '',
    'See its funding curve, pledge history, and similar projects on Kicksonar.',
  ].filter(Boolean);

  const description = parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  return { title, description };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id: rawId } = await params;
  const id = decodeId(rawId);
  const row = await loadRow(id);
  const path = `/projects/${id}`;

  if (!row) {
    return pageMetadata({
      title: `Project not found | ${SITE_NAME}`,
      description: 'This Kickstarter project could not be found on Kicksonar.',
      path,
      noindex: true,
    });
  }

  const { title, description } = buildTitleDescription(row);
  return pageMetadata({
    title,
    description,
    path,
    noindex: !isProjectIndexable(row),
    ogType: 'article',
  });
}

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = decodeId(rawId);
  const row = await loadRow(id);

  // Seed SSR content for Kickstarter rows (the bulk of the corpus). Indiegogo
  // rows store a narrower field set, so let the client fetch handle them.
  const seed: Project | null = row && !isIndiegogoId(id) ? (row as unknown as Project) : null;

  const jsonLd = row
    ? [
        projectCreativeWorkLd({
          id,
          name: str(row.name),
          blurb: str(row.blurb) || null,
          path: `/projects/${id}`,
          category_parent: str(row.category_parent) || null,
          category_name: str(row.category_name) || null,
          creator_name: str(row.creator_name) || null,
          creator_url: str(row.creator_url) || null,
          source_url: str(row.source_url) || null,
          image_url: str(row.image_url) || null,
          launched_at: row.launched_at != null ? Number(row.launched_at) : null,
          state: str(row.state) || null,
        }),
        breadcrumbLd([
          { name: 'Home', path: '/' },
          { name: 'Projects', path: '/projects' },
          { name: str(row.name) || 'Project', path: `/projects/${id}` },
        ]),
        {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          '@id': `${absoluteUrl(`/projects/${id}`)}#webpage`,
          url: absoluteUrl(`/projects/${id}`),
          name: str(row.name),
          isPartOf: { '@id': WEBSITE_ID },
        },
      ]
    : null;

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <ProjectDetailClient initialProject={seed} />
    </>
  );
}
