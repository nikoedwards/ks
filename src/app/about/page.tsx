import Image from 'next/image';
import { Github, Mail } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Hero */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-center gap-4 mb-6">
          <Image src="/logo.svg" alt="Kicksonar" width={52} height={52} />
          <div>
            <h1 className="text-3xl font-black text-gray-900">Kicksonar</h1>
            <p className="text-gray-400 text-sm mt-0.5">Kickstarter 众筹数据分析平台</p>
          </div>
        </div>

        <p className="text-gray-600 leading-relaxed mb-4">
          Kicksonar 的名字来源于声呐（Sonar）——就像声呐通过声波探测水下目标，Kicksonar 通过数据分析
          <span className="text-ks-green font-semibold">探测众筹市场中的模式与机会</span>。
          它帮助创作者、投资人和研究者从 Kickstarter 的历史数据中发现规律，理解哪些类目最容易成功、
          哪些时期最适合发起、哪些地区贡献了最多支持者。
        </p>

        <p className="text-gray-500 text-sm leading-relaxed">
          Kicksonar is named after <em>sonar</em> — just as sonar detects objects underwater through sound waves,
          Kicksonar detects patterns and opportunities within Kickstarter's crowdfunding ecosystem.
          It helps creators, investors, and researchers surface insights from historical campaign data:
          which categories succeed most, which periods are best for launching, and which regions drive the most backers.
        </p>
      </div>

      {/* Features */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">功能 / Features</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { cn: '数据概览', en: 'Dashboard', desc: '平台级关键指标一览' },
            { cn: '项目列表', en: 'Project Explorer', desc: '搜索、筛选 20万+ 历史项目' },
            { cn: '类目分析', en: 'Category Analysis', desc: '各类目成功率与融资对比' },
            { cn: '趋势分析', en: 'Trend Analysis', desc: '36个月月度众筹趋势' },
            { cn: '国家分析', en: 'Country Analysis', desc: '全球 Top 20 国家/地区对比' },
            { cn: '项目详情', en: 'Project Detail', desc: '单项目深度指标与资金曲线' },
          ].map(f => (
            <div key={f.cn} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
              <div className="w-2 h-2 rounded-full bg-ks-green mt-1.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-gray-800">{f.cn} <span className="text-gray-400 font-normal">/ {f.en}</span></div>
                <div className="text-xs text-gray-500 mt-0.5">{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data source */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-3">数据来源 / Data Source</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-2">
          数据来源于{' '}
          <a href="https://webrobots.io/kickstarter-datasets/" target="_blank" rel="noopener noreferrer"
            className="text-ks-green font-medium underline">
            webrobots.io Kickstarter Datasets
          </a>
          ，该数据集每月更新，涵盖 Kickstarter 平台全量公开项目信息（2009 年至今）。
          数据仅用于学习和研究目的，Kicksonar 与 Kickstarter 及 webrobots.io 无任何隶属关系。
        </p>
        <p className="text-xs text-gray-400 leading-relaxed">
          Data sourced from webrobots.io Kickstarter Datasets, updated monthly, covering all public
          Kickstarter campaigns since 2009. For learning and research purposes only. Kicksonar is not
          affiliated with Kickstarter or webrobots.io.
        </p>
      </div>

      {/* Tech stack */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-3">技术栈 / Tech Stack</h2>
        <div className="flex flex-wrap gap-2">
          {['Next.js 15', 'TypeScript', 'better-sqlite3', 'Tailwind CSS', 'Recharts', 'Railway'].map(t => (
            <span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{t}</span>
          ))}
        </div>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">联系 / Contact</h2>
        <div className="flex flex-col gap-3">
          <a
            href="mailto:nikoedwards75@gmail.com"
            className="flex items-center gap-3 text-sm text-gray-600 hover:text-ks-green transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-ks-green-light flex items-center justify-center transition-colors">
              <Mail className="w-4 h-4 text-gray-500 group-hover:text-ks-green transition-colors" />
            </div>
            nikoedwards75@gmail.com
          </a>
          <a
            href="https://github.com/nikoedwards/ks"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 text-sm text-gray-600 hover:text-ks-green transition-colors group"
          >
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
