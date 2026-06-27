import type { Metadata } from 'next';
import ProjectsClient from './ProjectsClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Project Explorer — Search 200,000+ Campaigns | Kicksonar';
const DESCRIPTION =
  'Search and filter 200,000+ Kickstarter campaigns by category, country, status, and funding. Sort by pledged, backers, or success rate and export the results.';
const PATH = '/projects';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Projects', path: PATH },
          ]),
        ]}
      />
      <ProjectsClient />
    </>
  );
}
