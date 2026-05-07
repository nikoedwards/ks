'use client';

import Image from 'next/image';
import { Github, Mail } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

const CONTENT = {
  en: {
    tagline: 'Kickstarter Crowdfunding Intelligence',
    origin: `Kicksonar is named after sonar — just as sonar detects objects underwater through sound waves, Kicksonar detects patterns and opportunities inside Kickstarter's crowdfunding ecosystem. It helps creators, investors, and researchers surface insights from campaign data: which categories succeed most, which periods are best for launching, and which regions drive the most backers.`,
    missionTitle: 'Our (Very Small) Ambition',
    mission: [
      `Kicksonar has a very small ambition. Embarrassingly small, honestly: to genuinely serve 100 people.`,
      `Not 100,000. Not 1 million. Just 100 humans who actually find this useful. We're starting with 5, then 10, then 50 — slow and intentional, like a Kickstarter campaign that actually knows its audience.`,
      `We built the shovel. What you dig for is up to you.`,
      `Whether you're a solo creator shipping your first product, a scrappy studio, a founder trying to prove the market exists, or a brand's marketing team doing competitive research — if Kickstarter is on your radar, Kicksonar was built for you.`,
    ],
    featuresTitle: 'Features',
    features: [
      { label: 'Dashboard', desc: 'Platform-wide KPIs at a glance' },
      { label: 'Project Explorer', desc: 'Search & filter 200K+ campaigns' },
      { label: 'Data Analysis', desc: 'Categories, trends, countries' },
      { label: 'Project Predict', desc: 'AI-powered campaign scoring' },
      { label: 'Live Tracking', desc: 'Real-time data from Kickstarter & Kicktraq' },
      { label: 'Similar Projects', desc: 'Smart similarity matching' },
    ],
    dataTitle: 'Data Source',
    dataBody: `Primary data from `,
    dataBody2: `, updated monthly, covering all public Kickstarter campaigns since 2009. Enriched with real-time scraping of live projects. For research purposes only — Kicksonar is not affiliated with Kickstarter or webrobots.io.`,
    stackTitle: 'Tech Stack',
    contactTitle: 'Contact',
  },
  cn: {
    tagline: 'Kickstarter 众筹数据分析平台',
    origin: `Kicksonar 的名字来源于声呐（Sonar）——就像声呐通过声波探测水下目标，Kicksonar 通过数据分析探测众筹市场中的模式与机会。它帮助创作者、投资人和研究者从 Kickstarter 的历史数据中发现规律，理解哪些类目最容易成功、哪些时期最适合发起、哪些地区贡献了最多支持者。`,
    missionTitle: '我们的（很小的）野心',
    mission: [
      `Kicksonar 的目标很小——说实话，小得有点不像话：服务好 100 个人。`,
      `不是一百万，不是十万，就是这 100 个人。我们会从 5 个、10 个、50 个一步步往上走，像一个知道自己受众是谁的众筹项目一样，慢慢来。`,
      `铲子已经造好了，你用它挖什么，我们管不着。`,
      `不管你是第一次出手的个人创作者、拼命折腾的小工作室、正在验证市场的创业者，还是大品牌里负责「去 Kickstarter 踩盘子」的营销同学——只要你跟 Kickstarter 众筹搭得上边，这个平台就是为你建的。`,
    ],
    featuresTitle: '功能',
    features: [
      { label: '数据概览', desc: '平台级关键指标一览' },
      { label: '项目列表', desc: '搜索、筛选 20 万+ 历史项目' },
      { label: '数据分析', desc: '类目、趋势、国家多维分析' },
      { label: '项目预测', desc: 'AI 驱动的项目评分系统' },
      { label: '实时追踪', desc: '从 Kickstarter 和 Kicktraq 抓取实时数据' },
      { label: '相似项目', desc: '基于算法的智能匹配' },
    ],
    dataTitle: '数据来源',
    dataBody: `数据主要来源于 `,
    dataBody2: `，该数据集每月更新，涵盖 Kickstarter 平台全量公开项目信息（2009 年至今）。同时通过实时爬取补充在线项目数据。数据仅用于学习和研究目的，Kicksonar 与 Kickstarter 及 webrobots.io 无任何隶属关系。`,
    stackTitle: '技术栈',
    contactTitle: '联系',
  },
} as const;

export default function AboutPage() {
  const [lang] = useLanguage();
  const c = CONTENT[lang];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Hero */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-center gap-4 mb-6">
          <Image src="/logo.svg" alt="Kicksonar" width={52} height={52} />
          <div>
            <h1 className="text-3xl font-black text-gray-900">Kicksonar</h1>
            <p className="text-gray-400 text-sm mt-0.5">{c.tagline}</p>
          </div>
        </div>
        <p className="text-gray-600 leading-relaxed">
          {c.origin.split('探测众筹市场中的模式与机会').length > 1 ? (
            <>
              {c.origin.split('探测众筹市场中的模式与机会')[0]}
              <span className="text-ks-green font-semibold">探测众筹市场中的模式与机会</span>
              {c.origin.split('探测众筹市场中的模式与机会')[1]}
            </>
          ) : (
            c.origin.split('patterns and opportunities').length > 1 ? (
              <>
                {c.origin.split('patterns and opportunities')[0]}
                <span className="text-ks-green font-semibold">patterns and opportunities</span>
                {c.origin.split('patterns and opportunities')[1]}
              </>
            ) : c.origin
          )}
        </p>
      </div>

      {/* Mission */}
      <div className="bg-gray-900 rounded-xl p-8 space-y-4">
        <h2 className="font-bold text-white text-lg">{c.missionTitle}</h2>
        {c.mission.map((para, i) => (
          <p key={i} className={`leading-relaxed ${
            i === 2
              ? 'text-ks-green font-semibold text-base'
              : i === 0
              ? 'text-white font-medium'
              : 'text-gray-400 text-sm'
          }`}>
            {para}
          </p>
        ))}
        <div className="pt-2 flex flex-wrap gap-3 text-xs text-gray-500">
          {(lang === 'cn'
            ? ['个人创作者 / 工作室', '创业者 / 品牌方', '营销团队']
            : ['Solo creators & studios', 'Founders & brand owners', 'Marketing teams']
          ).map(tag => (
            <span key={tag} className="px-3 py-1 rounded-full border border-gray-700 text-gray-400">{tag}</span>
          ))}
        </div>
      </div>

      {/* Features */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">{c.featuresTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {c.features.map(f => (
            <div key={f.label} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <div className="w-2 h-2 rounded-full bg-ks-green mt-1.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-gray-800">{f.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data source */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-3">{c.dataTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed">
          {c.dataBody}
          <a href="https://webrobots.io/kickstarter-datasets/" target="_blank" rel="noopener noreferrer"
            className="text-ks-green font-medium underline">
            webrobots.io Kickstarter Datasets
          </a>
          {c.dataBody2}
        </p>
      </div>

      {/* Tech stack */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-3">{c.stackTitle}</h2>
        <div className="flex flex-wrap gap-2">
          {['Next.js 15', 'TypeScript', 'better-sqlite3', 'Tailwind CSS', 'Recharts', 'Railway'].map(tech => (
            <span key={tech} className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{tech}</span>
          ))}
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">{c.contactTitle}</h2>
        <div className="flex flex-col gap-3">
          <a href="mailto:nikoedwards75@gmail.com"
            className="flex items-center gap-3 text-sm text-gray-600 hover:text-ks-green transition-colors group">
            <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-ks-green-light flex items-center justify-center transition-colors">
              <Mail className="w-4 h-4 text-gray-500 group-hover:text-ks-green transition-colors" />
            </div>
            nikoedwards75@gmail.com
          </a>
          <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 text-sm text-gray-600 hover:text-ks-green transition-colors group">
            <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-ks-green-light flex items-center justify-center transition-colors">
              <Github className="w-4 h-4 text-gray-500 group-hover:text-ks-green transition-colors" />
            </div>
            github.com/nikoedwards/ks
          </a>
        </div>
      </div>
    </div>
  );
}
