import type { JsonLdNode } from '@/lib/seo';

/**
 * Server-rendered JSON-LD. Accepts a single node or an array; emits one
 * <script type="application/ld+json"> so the structured data is present in the
 * initial HTML for search engines and AI crawlers.
 */
export default function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
