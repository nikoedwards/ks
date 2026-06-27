import type { Metadata } from 'next';
import AnalysisClient from './AnalysisClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Data Analysis — Categories, Countries & Time Trends | Kicksonar';
const DESCRIPTION =
  'Deep-dive Kickstarter analytics: success rates and funding by category, country, and month. Compare crowdfunding performance across the full historical dataset.';
const PATH = '/analysis';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Analysis', path: PATH },
          ]),
        ]}
      />
      <AnalysisClient />
    </>
  );
}
