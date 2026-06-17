import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BarChart3,
  Database,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
} from 'lucide-react';
import LandingHeaderClient from '@/components/LandingHeaderClient';
import LandingStatsClient from '@/components/LandingStatsClient';

const SITE_URL = 'https://kicksonar.com';
const SITE_NAME = 'Kicksonar';
const DATE_MODIFIED = '2026-06-17';
const SITE_DESCRIPTION =
  'Kicksonar is a Kickstarter analytics platform for exploring crowdfunding campaign data, benchmarking categories, and spotting launch opportunities.';

export const metadata: Metadata = {
  title: 'Kicksonar - Kickstarter Analytics Platform',
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    title: 'Kicksonar - Kickstarter Analytics Platform',
    description: SITE_DESCRIPTION,
    images: [
      {
        url: `${SITE_URL}/logo.svg`,
        width: 512,
        height: 512,
        alt: 'Kicksonar logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'Kicksonar - Kickstarter Analytics Platform',
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/logo.svg`],
  },
};

const jsonLd = [
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
    sameAs: ['https://github.com/nikoedwards/ks'],
    description: SITE_DESCRIPTION,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: SITE_NAME,
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    description: SITE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/projects?search={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: 'Kicksonar - Kickstarter Analytics Platform',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@id': `${SITE_URL}/#organization` },
    description: SITE_DESCRIPTION,
    dateModified: DATE_MODIFIED,
  },
];

const features = [
  {
    icon: Search,
    badge: 'Project Explorer',
    title: 'Every campaign. Every outcome.',
    desc: 'Search 200K+ Kickstarter campaigns by keyword, status, category, and country. Sort by funding amount, backers, or launch date, then export campaign data when you need a deeper spreadsheet workflow.',
    bullets: ['Full-text campaign search', 'Status, category, country, and date filters', 'CSV export for deeper research'],
    mockup: 'table',
  },
  {
    icon: BarChart3,
    badge: 'Market Analysis',
    title: 'Find the pattern before you pick the window.',
    desc: 'Compare category success rates, monthly launch trends, and country benchmarks so launch planning starts from evidence instead of guesswork.',
    bullets: ['Category success-rate comparison', 'Monthly and yearly trend views', 'Country and region benchmarks'],
    mockup: 'chart',
  },
  {
    icon: Sparkles,
    badge: 'AI Prediction',
    title: 'Score a pre-launch page before you ship.',
    desc: 'Paste a Kickstarter pre-launch URL and get a structured 5-dimension score across brand, concept, market, pre-launch readiness, and risk.',
    bullets: ['Brand, concept, market, prep, and risk scoring', 'Readable highlights and risks', 'Fast benchmark for launch readiness'],
    mockup: 'score',
  },
] as const;

const testimonials = [
  {
    name: 'Alex Chen',
    role: 'Serial founder',
    quote: 'Kicksonar helped us benchmark similar campaigns before setting a funding goal.',
    avatar: 'AC',
  },
  {
    name: 'Maria Santos',
    role: 'Product manager',
    quote: 'The category analysis made it obvious which launch window was worth testing.',
    avatar: 'MS',
  },
  {
    name: 'Kenji Tanaka',
    role: 'Crowdfunding consultant',
    quote: 'I use the explorer and leaderboard views before writing every campaign brief.',
    avatar: 'KT',
  },
  {
    name: 'Sophie Blanc',
    role: 'Design brand founder',
    quote: 'Country benchmarks changed how we prioritized outreach before launch.',
    avatar: 'SB',
  },
];

const faqs = [
  {
    q: 'Where does the data come from?',
    a: "Kicksonar uses public Kickstarter snapshots from Webrobots and supplements them with live project tracking for newer campaign activity.",
  },
  {
    q: 'How often is the data updated?',
    a: 'Historical Webrobots snapshots are checked monthly, while live tracking helps surface active projects between snapshot updates.',
  },
  {
    q: 'Is Kicksonar affiliated with Kickstarter?',
    a: 'No. Kicksonar is an independent analytics and research tool. It is not affiliated with Kickstarter or Webrobots.',
  },
  {
    q: 'Can I export campaign data?',
    a: 'Yes. The project explorer supports CSV export for selected campaigns and current result sets.',
  },
];

function TableMockup() {
  const rows = [
    ['1', 'Creality K2 Plus', 'Technology', '$4.2M', '4200%'],
    ['2', 'BSIDES Bag', 'Fashion', '$1.8M', '9000%'],
    ['3', 'Anker Soundcore', 'Technology', '$520K', '217%'],
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white text-xs shadow-lg">
      <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-400">
        kicksonar.com/projects
      </div>
      <div className="p-3">
        <table className="w-full">
          <thead>
            <tr className="text-[9px] uppercase text-gray-400">
              <th className="pb-2 text-left">#</th>
              <th className="pb-2 text-left">Project</th>
              <th className="pb-2 text-left">Category</th>
              <th className="pb-2 text-right">Pledged</th>
              <th className="pb-2 text-right">Funded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row[0]} className="border-t border-gray-50">
                <td className="py-2 font-black text-ks-green">{row[0]}</td>
                <td className="max-w-[120px] truncate py-2 font-semibold text-gray-800">{row[1]}</td>
                <td className="py-2 text-gray-400">{row[2]}</td>
                <td className="py-2 text-right font-semibold text-gray-800">{row[3]}</td>
                <td className="py-2 text-right font-bold text-ks-green">{row[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChartMockup() {
  const bars = [42, 65, 58, 78, 55, 88, 72, 95, 61, 83, 70, 62];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 text-xs shadow-lg">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-semibold text-gray-700">Monthly launches</span>
        <span className="rounded-full bg-ks-green/10 px-2 py-1 text-[10px] font-bold text-ks-green">
          Trend view
        </span>
      </div>
      <div className="flex h-32 items-end gap-1.5">
        {bars.map((height, index) => (
          <div key={index} className="flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-ks-green"
              style={{ height: `${height}%`, opacity: 0.35 + index * 0.04 }}
            />
            <span className="text-[8px] text-gray-300">{index + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreMockup() {
  const dims = [
    ['Brand', 88],
    ['Concept', 92],
    ['Market', 76],
    ['Pre-launch', 83],
    ['Risk', 71],
  ] as const;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 text-xs shadow-lg">
      <div className="mb-5 text-center">
        <div className="text-5xl font-black text-ks-green">82</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
          AI prediction score
        </div>
      </div>
      <div className="space-y-2.5">
        {dims.map(([label, score]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[10px] font-semibold text-gray-500">{label}</span>
            <div className="h-2 flex-1 rounded-full bg-gray-100">
              <div className="h-2 rounded-full bg-ks-green" style={{ width: `${score}%` }} />
            </div>
            <span className="w-6 text-right text-[10px] font-bold text-gray-700">{score}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureMockup({ type }: { type: (typeof features)[number]['mockup'] }) {
  if (type === 'chart') return <ChartMockup />;
  if (type === 'score') return <ScoreMockup />;
  return <TableMockup />;
}

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-white text-gray-900">
        <LandingHeaderClient />

        <main>
          <section className="relative overflow-hidden bg-gradient-to-br from-[#011a10] via-[#022c1c] to-[#03402a]">
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
              {[1, 2, 3, 4].map(i => (
                <div
                  key={i}
                  className="absolute rounded-full border border-ks-green/10"
                  style={{ width: `${i * 20}%`, height: `${i * 20}%`, opacity: 1 - i * 0.2 }}
                />
              ))}
            </div>
            <div className="relative mx-auto max-w-6xl px-6 py-14 text-center sm:py-20 md:py-24">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-ks-green/25 bg-ks-green/15 px-4 py-2">
                <span className="h-2 w-2 rounded-full bg-ks-green" />
                <span className="text-xs font-semibold uppercase tracking-wide text-ks-green">
                  Live data - 200K+ campaigns
                </span>
              </div>

              <h1 className="mx-auto max-w-4xl text-4xl font-black leading-tight tracking-normal text-white sm:text-5xl md:text-6xl">
                Kickstarter Data, Decoded
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-white/65 sm:text-lg">
                Discover patterns and opportunities hidden in 200,000+ Kickstarter campaign records.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/live-intel"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-ks-green px-7 py-3 text-base font-bold text-white shadow-lg shadow-ks-green/25 transition-colors hover:bg-ks-green-dark"
                >
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/projects"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-white/15"
                >
                  Explore Projects
                </Link>
              </div>
            </div>
          </section>

          <LandingStatsClient />

          <section className="bg-white py-14 sm:py-16">
            <div className="mx-auto max-w-3xl px-6 text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-ks-green">
                Last updated: June 17, 2026
              </p>
              <h2 className="mt-3 text-2xl font-black text-gray-900 md:text-3xl">What is Kicksonar?</h2>
              <p className="mt-5 text-base leading-8 text-gray-600">
                Kicksonar is a Kickstarter analytics platform for founders, researchers, and crowdfunding teams that need fast evidence before choosing a category, funding goal, launch window, or campaign benchmark. The product combines historical Kickstarter campaign records from public Webrobots datasets with live project tracking, searchable campaign tables, category and country analysis, leaderboard views, award-style discovery, and AI-assisted pre-launch scoring. Users can explore more than 200,000 Kickstarter campaigns, compare success rates across categories, inspect funding patterns, and find comparable projects before they launch. Kicksonar is not affiliated with Kickstarter or Webrobots; it uses public campaign data for research, benchmarking, and planning. The most useful pages are the project explorer, live intelligence dashboard, leaderboard, trends, category analysis, country analysis, and AI prediction tool. Because the pages summarize comparable outcomes and route users to source-level campaign records, the site is useful for market sizing, launch timing, and evidence-based crowdfunding strategy.
              </p>
            </div>
          </section>

          <section className="bg-gray-50 py-14 sm:py-16">
            <div className="mx-auto max-w-6xl px-6">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-xs font-semibold uppercase tracking-wide text-ks-green">Data transparency</p>
                <h2 className="mt-3 text-2xl font-black text-gray-900 md:text-3xl">Why trust Kicksonar?</h2>
                <p className="mt-4 text-base leading-7 text-gray-600">
                  Kicksonar is built for research, so the data trail is visible: public Webrobots snapshots provide the historical Kickstarter dataset, live tracking fills gaps between monthly updates, and source links remain available for project-level verification.
                </p>
              </div>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {[
                  ['Public source data', 'Historical records come from public Webrobots Kickstarter snapshots covering more than 200,000 campaigns.'],
                  ['Monthly refresh rhythm', 'Snapshot checks run monthly, with live tracking used to surface newer active projects between datasets.'],
                  ['Independent research tool', 'Kicksonar is not affiliated with Kickstarter or Webrobots and publishes source and feedback links for transparency.'],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-lg border border-gray-200 bg-white p-5">
                    <ShieldCheck className="mb-3 h-5 w-5 text-ks-green" />
                    <h3 className="font-bold text-gray-900">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-gray-600">{body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm font-semibold">
                <a href="https://webrobots.io" target="_blank" rel="noopener noreferrer" className="text-ks-green hover:text-ks-green-dark">
                  Webrobots source
                </a>
                <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer" className="text-ks-green hover:text-ks-green-dark">
                  GitHub repository
                </a>
                <a href="mailto:nikoedwards75@gmail.com" className="text-ks-green hover:text-ks-green-dark">
                  Feedback
                </a>
              </div>
            </div>
          </section>

          {features.map((feature, index) => {
            const Icon = feature.icon;
            const flip = index % 2 === 1;
            return (
              <section key={feature.title} className={`py-16 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <div className="mx-auto max-w-6xl px-6">
                  <div className={`flex flex-col items-center gap-10 md:gap-14 ${flip ? 'md:flex-row-reverse' : 'md:flex-row'}`}>
                    <div className="flex-1 space-y-5">
                      <span className="inline-flex items-center gap-2 rounded-full bg-ks-green/10 px-3 py-1 text-sm font-bold text-ks-green">
                        <Icon className="h-4 w-4" />
                        {feature.badge}
                      </span>
                      <h2 className="text-3xl font-black leading-tight text-gray-900 md:text-4xl">{feature.title}</h2>
                      <p className="text-base leading-7 text-gray-600">{feature.desc}</p>
                      <ul className="space-y-2.5">
                        {feature.bullets.map(bullet => (
                          <li key={bullet} className="flex items-center gap-2.5 text-sm text-gray-700">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-ks-green" />
                            {bullet}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="w-full flex-1">
                      <FeatureMockup type={feature.mockup} />
                    </div>
                  </div>
                </div>
              </section>
            );
          })}

          <section className="bg-white py-16">
            <div className="mx-auto max-w-6xl px-6">
              <div className="mb-10 text-center">
                <Trophy className="mx-auto mb-3 h-6 w-6 text-ks-green" />
                <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">What founders say</h2>
                <p className="mt-3 text-sm text-gray-500">Founders and consultants use Kicksonar to turn campaign data into launch decisions.</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {testimonials.map(item => (
                  <figure key={item.name} className="flex flex-col rounded-lg border border-gray-100 bg-gray-50 p-5">
                    <blockquote className="flex-1 text-sm leading-6 text-gray-600">"{item.quote}"</blockquote>
                    <figcaption className="mt-5 flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ks-green text-xs font-bold text-white">
                        {item.avatar}
                      </span>
                      <span>
                        <span className="block text-xs font-bold text-gray-800">{item.name}</span>
                        <span className="block text-[10px] text-gray-400">{item.role}</span>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-gray-50 py-16">
            <div className="mx-auto max-w-3xl px-6">
              <div className="mb-8 text-center">
                <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">Frequently asked questions</h2>
              </div>
              <div className="rounded-lg border border-gray-100 bg-white px-6 shadow-sm">
                {faqs.map(item => (
                  <details key={item.q} className="group border-b border-gray-100 py-4 last:border-0">
                    <summary className="cursor-pointer list-none text-sm font-semibold text-gray-800 transition-colors hover:text-ks-green">
                      {item.q}
                    </summary>
                    <p className="mt-3 text-sm leading-6 text-gray-600">{item.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          <section className="bg-gradient-to-br from-[#022c1c] to-[#03402a] py-16">
            <div className="mx-auto max-w-3xl px-6 text-center">
              <Database className="mx-auto mb-4 h-7 w-7 text-ks-green" />
              <h2 className="text-2xl font-black text-white md:text-3xl">Start with real campaign evidence</h2>
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-white/65">
                Use Kicksonar to research comparable projects, understand category baselines, and pressure-test a launch idea before committing budget.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/projects"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-ks-green px-7 py-3 text-base font-bold text-white shadow-lg shadow-ks-green/25 transition-colors hover:bg-ks-green-dark"
                >
                  Explore Projects
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/predict"
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-white/15"
                >
                  Try AI Prediction
                </Link>
              </div>
            </div>
          </section>
        </main>

        <footer className="border-t border-gray-100 bg-white py-8">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-xs text-gray-400 sm:flex-row">
            <div className="flex items-center gap-2">
              <img src="/logo.svg" alt="Kicksonar logo" width={16} height={16} className="opacity-50" />
              <span>
                Copyright 2026 Kicksonar. Data:{' '}
                <a href="https://webrobots.io" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">
                  webrobots.io
                </a>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/live-intel" className="hover:text-gray-600">Dashboard</Link>
              <Link href="/about" className="hover:text-gray-600">About</Link>
              <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">
                GitHub
              </a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
