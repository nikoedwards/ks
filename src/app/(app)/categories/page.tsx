import type { Metadata } from 'next';
import CategoriesClient from './CategoriesClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Categories — Success Rates & Funding by Category | Kicksonar';
const DESCRIPTION =
  'Browse Kickstarter performance by category: success rates, average funding, and total raised for Technology, Games, Design, Tabletop, and more.';
const PATH = '/categories';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Categories', path: PATH },
          ]),
        ]}
      />
      <CategoriesClient />
    </>
  );
}
