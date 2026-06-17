import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Trust - Kicksonar',
  description: 'Privacy, terms, security, and contact information for Kicksonar.',
  alternates: {
    canonical: 'https://kicksonar.com/trust',
  },
};

const sections = [
  {
    id: 'privacy',
    title: 'Privacy',
    body: 'Kicksonar uses Google Analytics to understand aggregate site usage and improve the product. Account and authentication data are used only to provide access to saved workflows and application features.',
  },
  {
    id: 'terms',
    title: 'Terms',
    body: 'Kicksonar is an independent research and analytics tool for Kickstarter campaign data. The service is provided for benchmarking, discovery, and planning, not as financial, legal, or launch-success advice.',
  },
  {
    id: 'security',
    title: 'Security',
    body: 'Kicksonar serves pages over HTTPS, blocks crawler access to private API and account routes, and keeps analytics, authentication, and crawler-facing metadata separated from internal tooling.',
  },
  {
    id: 'contact',
    title: 'Contact',
    body: 'For feedback, corrections, or data questions, contact the Kicksonar maintainer at nikoedwards75@gmail.com.',
  },
] as const;

export default function TrustPage() {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <section className="border-b border-gray-100 bg-gray-50 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <Link href="/" className="text-sm font-semibold text-ks-green hover:text-ks-green-dark">
            Kicksonar
          </Link>
          <h1 className="mt-5 text-4xl font-black tracking-normal text-gray-900">Trust</h1>
          <p className="mt-4 text-base leading-8 text-gray-600">
            Practical privacy, terms, security, and contact notes for people using Kicksonar to research Kickstarter campaign data.
          </p>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto grid max-w-3xl gap-5 px-6">
          {sections.map(section => (
            <article key={section.id} id={section.id} className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="text-xl font-black text-gray-900">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-gray-600">{section.body}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
