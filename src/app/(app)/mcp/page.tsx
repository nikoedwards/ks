import type { Metadata } from 'next';
import McpDocsClient from './McpDocsClient';
import JsonLd from '@/components/JsonLd';
import {
  WEBSITE_ID,
  ORG_ID,
  absoluteUrl,
  pageMetadata,
  breadcrumbLd,
} from '@/lib/seo';

const TITLE = 'API / MCP Access — Connect Kicksonar to Your Own LLM | Kicksonar';
const DESCRIPTION =
  'Use a personal API key and the Kicksonar MCP server to connect 200,000+ crowdfunding campaigns to your own LLM (Claude, Cursor, ChatGPT) for custom analysis.';
const PATH = '/mcp';

export const metadata: Metadata = pageMetadata({ title: TITLE, description: DESCRIPTION, path: PATH });

const articleLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  '@id': `${absoluteUrl(PATH)}#webpage`,
  url: absoluteUrl(PATH),
  name: TITLE,
  headline: TITLE,
  description: DESCRIPTION,
  isPartOf: { '@id': WEBSITE_ID },
  about: { '@id': ORG_ID },
};

export default function Page() {
  return (
    <>
      <JsonLd
        data={[
          articleLd,
          breadcrumbLd([
            { name: 'Home', path: '/' },
            { name: 'API / MCP Access', path: PATH },
          ]),
        ]}
      />
      <McpDocsClient />
    </>
  );
}
