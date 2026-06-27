import type { Metadata } from 'next';
import LandingPageClient from '@/components/LandingPageClient';
import { AuthProvider } from '@/contexts/AuthContext';
import JsonLd from '@/components/JsonLd';
import {
  SITE_URL,
  SITE_DESCRIPTION,
  WEBSITE_ID,
  ORG_ID,
  organizationLd,
  websiteLd,
  pageMetadata,
} from '@/lib/seo';

const TITLE = 'Kicksonar - Kickstarter Analytics Platform';

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: SITE_DESCRIPTION,
  path: '/',
});

const jsonLd = [
  organizationLd(),
  websiteLd(),
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: TITLE,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORG_ID },
    description: SITE_DESCRIPTION,
  },
];

export default function Page() {
  return (
    <>
      <JsonLd data={jsonLd} />
      <AuthProvider>
        <LandingPageClient />
      </AuthProvider>
    </>
  );
}
