import type { Metadata } from 'next';
import LandingPageClient from '@/components/LandingPageClient';
import { AuthProvider } from '@/contexts/AuthContext';

const SITE_URL = 'https://kicksonar.com';
const SITE_NAME = 'Kicksonar';
const SITE_DESCRIPTION =
  'Kicksonar is a Kickstarter analytics platform for exploring crowdfunding campaign data, benchmarking categories, and spotting launch opportunities.';

export const metadata: Metadata = {
  title: 'Kicksonar - Kickstarter Analytics Platform',
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'Kicksonar - Kickstarter Analytics Platform',
    description: SITE_DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/logo.svg`,
        width: 512,
        height: 512,
        alt: 'Kicksonar logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Kicksonar - Kickstarter Analytics Platform',
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/logo.svg`],
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
    sameAs: ['https://github.com/nikoedwards/ks'],
    description: SITE_DESCRIPTION,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    description: SITE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/projects?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: 'Kicksonar - Kickstarter Analytics Platform',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@id': `${SITE_URL}/#organization` },
    description: SITE_DESCRIPTION,
    dateModified: '2026-06-17',
  },
];

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AuthProvider>
        <LandingPageClient />
      </AuthProvider>
    </>
  );
}
