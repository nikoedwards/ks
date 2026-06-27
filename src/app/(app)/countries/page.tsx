import type { Metadata } from 'next';
import CountriesClient from './CountriesClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter by Country — Funding & Success Rates | Kicksonar';
const DESCRIPTION =
  'Compare Kickstarter crowdfunding by country: project counts, success rates, total funds raised, and backers across the global dataset.';
const PATH = '/countries';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Countries', path: PATH },
          ]),
        ]}
      />
      <CountriesClient />
    </>
  );
}
