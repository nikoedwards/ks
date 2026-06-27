import type { Metadata } from 'next';
import AwardsClient from './AwardsClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kicksonar Awards — Standout Kickstarter Campaigns | Kicksonar';
const DESCRIPTION =
  'Curated awards highlighting standout Kickstarter campaigns by funding, momentum, and backer support across categories.';
const PATH = '/awards';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Awards', path: PATH },
          ]),
        ]}
      />
      <AwardsClient />
    </>
  );
}
