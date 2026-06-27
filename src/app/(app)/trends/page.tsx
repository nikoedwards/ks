import type { Metadata } from 'next';
import TrendsClient from './TrendsClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Trends — Monthly Funding & Success Rates | Kicksonar';
const DESCRIPTION =
  'Track Kickstarter crowdfunding trends over time: monthly project launches, success rates, and total funds raised across categories.';
const PATH = '/trends';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Trends', path: PATH },
          ]),
        ]}
      />
      <TrendsClient />
    </>
  );
}
