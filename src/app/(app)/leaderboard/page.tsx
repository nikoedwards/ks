import type { Metadata } from 'next';
import LeaderboardClient from './LeaderboardClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Leaderboard — Top-Funded Campaigns | Kicksonar';
const DESCRIPTION =
  'The highest-funded Kickstarter campaigns of all time, ranked by USD pledged and backers. Filter the leaderboard by category to benchmark top performers.';
const PATH = '/leaderboard';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Leaderboard', path: PATH },
          ]),
        ]}
      />
      <LeaderboardClient />
    </>
  );
}
