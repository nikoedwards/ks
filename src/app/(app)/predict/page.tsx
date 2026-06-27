import type { Metadata } from 'next';
import PredictClient from './PredictClient';
import JsonLd from '@/components/JsonLd';
import { pageMetadata, breadcrumbLd, collectionPageLd } from '@/lib/seo';

const TITLE = 'Kickstarter Launch Predictor — AI Pre-Launch Scoring | Kicksonar';
const DESCRIPTION =
  'Paste a Kickstarter pre-launch URL and get AI-powered scoring across brand, concept, market, preparation, and risk to gauge launch readiness.';
const PATH = '/predict';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          collectionPageLd(TITLE, DESCRIPTION, PATH),
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'Predict', path: PATH },
          ]),
        ]}
      />
      <PredictClient />
    </>
  );
}
