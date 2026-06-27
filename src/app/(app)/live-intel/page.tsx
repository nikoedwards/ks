import type { Metadata } from 'next';
import LiveIntelClient from './LiveIntelClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Live Kickstarter Intelligence — Trending Campaigns | Kicksonar';
const DESCRIPTION =
  'Track live Kickstarter campaigns gaining funding momentum right now, with real-time pledge and backer signals.';
const PATH = '/live-intel';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Live Intel', path: PATH },
          ]),
        ]}
      />
      <LiveIntelClient />
    </>
  );
}
