'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { t, uiCopy, type Lang } from '@/lib/i18n';
import LoginModal from '@/components/LoginModal';
import LanguageSelect from '@/components/LanguageSelect';

interface PlatformStats { total: number; success_rate: number; total_pledged_usd: number; category_count?: number; }
interface LiveSummary { pledged_delta_24h?: number; launched_24h?: number; }
interface SearchHit {
  id: string;
  name: string;
  category_parent: string;
  state: string;
  usd_pledged?: number;
  launched_at?: number;
  image_url?: string | null;
  image_thumb_url?: string | null;
}
interface LandingProject extends SearchHit { backers_count?: number; goal?: number; }

function fmtMoneyCompact(value: number) {
  const v = Number(value ?? 0);
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function RollingValue({ value, className }: { value: string; className?: string }) {
  return <span key={value} className={`inline-block animate-[bounce_0.45s_ease-out_1] ${className ?? ''}`}>{value}</span>;
}

function landingStateLabel(state: string, lang: Lang) {
  return uiCopy[lang].landing.stateLabels[state] ?? state;
}

function landingStateClass(state: string) {
  if (state === 'live') return 'border-blue-100 bg-blue-50 text-blue-600';
  if (state === 'successful') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (state === 'failed') return 'border-red-100 bg-red-50 text-red-600';
  return 'border-gray-100 bg-gray-50 text-gray-500';
}

function LandingStatePill({ state, lang }: { state: string; lang: Lang }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${landingStateClass(state)}`}>
      {state === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />}
      {landingStateLabel(state, lang)}
    </span>
  );
}

function LandingTrendMark({ state }: { state: string }) {
  const up = state === 'live' || state === 'successful';
  return <span className={`text-xs font-black ${up ? 'text-emerald-500' : 'text-red-500'}`}>{up ? '↗' : '↘'}</span>;
}

// ── FAQ accordion ──────────────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        className="w-full flex items-center justify-between py-4 text-left text-sm font-semibold text-gray-800 hover:text-ks-green transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {q}
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="text-sm text-gray-500 pb-4 leading-relaxed">{a}</p>}
    </div>
  );
}

// ── Mockup: Project Table ──────────────────────────────────────────────────────
function ProjectTableMockup({ lang, rows: liveRows }: { lang: Lang; rows?: LandingProject[] }) {
  const copy = uiCopy[lang].landing;
  const rows = (liveRows?.length ? liveRows : [
    { id: '1', name: 'Creality K2 Plus', category_parent: 'Technology', state: 'successful', usd_pledged: 4200000, goal: 100000 },
    { id: '2', name: 'BSIDES Bag', category_parent: 'Fashion', state: 'successful', usd_pledged: 1800000, goal: 20000 },
    { id: '3', name: 'Anker Soundcore', category_parent: 'Technology', state: 'successful', usd_pledged: 520000, goal: 240000 },
  ]).slice(0, 3);
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-1.5 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <div className="flex-1 mx-3 bg-white border border-gray-200 rounded px-2 py-0.5 text-gray-400 text-[10px]">kicksonar.com/projects</div>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 bg-gray-100 rounded-lg px-2 py-1.5 flex items-center gap-1">
            <Search className="w-3 h-3 text-gray-400" />
            <span className="text-gray-400 text-[10px]">{copy.searchCampaigns}</span>
          </div>
          <div className="bg-ks-green text-white text-[10px] px-2 py-1.5 rounded-lg font-semibold">{copy.filter}</div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-[9px] uppercase">
              <th className="text-left pb-2">#</th>
              <th className="text-left pb-2">{copy.project}</th>
              <th className="text-left pb-2">{copy.category}</th>
              <th className="text-right pb-2">{copy.pledged}</th>
              <th className="text-right pb-2">{copy.funded}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-gray-50">
                <td className="py-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-black ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                </td>
                <td className="py-1.5">
                  <div className="font-semibold text-gray-800 text-[10px] truncate max-w-[80px]">{r.name}</div>
                  <span className={`mt-0.5 inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${landingStateClass(r.state)}`}>
                    {landingStateLabel(r.state, lang)}
                  </span>
                </td>
                <td className="py-1.5 text-gray-400 text-[10px]">{r.category_parent}</td>
                <td className="py-1.5 text-right text-gray-800 font-semibold text-[10px]">{fmtMoneyCompact(r.usd_pledged ?? 0)}</td>
                <td className="py-1.5 text-right">
                  <span className="text-ks-green text-[10px] font-bold">{r.goal ? `${Math.round(((r.usd_pledged ?? 0) / Math.max(1, r.goal)) * 100)}%` : '-'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mockup: Chart ──────────────────────────────────────────────────────────────
function ChartMockup({ lang }: { lang: Lang }) {
  const copy = uiCopy[lang].landing;
  const bars = [42, 65, 58, 78, 55, 88, 72, 95, 61, 83, 70, 62];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-1.5 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-2 text-gray-400 text-[10px]">{copy.monthlyTrend}</span>
      </div>
      <div className="p-4">
        <div className="text-[10px] text-gray-500 font-semibold mb-3">{copy.launchesRate}</div>
        <div className="flex items-end gap-1 h-28">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t transition-all"
                style={{ height: `${h}%`, background: `linear-gradient(to top, rgba(5,206,120,0.9), rgba(5,206,120,0.4))` }} />
              <span className="text-[7px] text-gray-300">{months[i].slice(0, 1)}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: copy.total, val: '12,847' },
            { label: copy.rate, val: '36.2%' },
            { label: copy.peak, val: 'Aug' },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 rounded-lg p-2 text-center">
              <div className="text-[11px] font-black text-gray-800">{s.val}</div>
              <div className="text-[9px] text-gray-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Mockup: AI Score Card ──────────────────────────────────────────────────────
function ScoreMockup({ lang }: { lang: Lang }) {
  const copy = uiCopy[lang].landing;
  const dims = [
    { label: copy.brand, score: 88 },
    { label: copy.concept, score: 92 },
    { label: copy.market, score: 76 },
    { label: copy.prelaunch, score: 83 },
    { label: copy.risk, score: 71 },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-1.5 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-2 text-gray-400 text-[10px]">{copy.aiScore}</span>
      </div>
      <div className="p-4">
        <div className="text-center mb-4">
          <div className="text-4xl font-black text-ks-green">82</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{copy.overallScore}</div>
          <div className="mt-2 inline-flex items-center gap-1 bg-ks-green-light text-ks-green text-[10px] font-semibold px-3 py-1 rounded-full">
            {copy.likelySuccess}
          </div>
        </div>
        <div className="space-y-2">
          {dims.map(d => (
            <div key={d.label} className="flex items-center gap-2">
              <span className="text-[9px] text-gray-500 w-14 shrink-0">{d.label}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div className="h-1.5 rounded-full bg-ks-green transition-all" style={{ width: `${d.score}%` }} />
              </div>
              <span className="text-[10px] font-bold text-gray-700 w-5 text-right">{d.score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type LandingFeature = {
  badge: string;
  title: string;
  desc: string;
  bullets: string[];
  mockup: 'table' | 'chart' | 'score';
  flip: boolean;
};

type LandingLongCopy = {
  featureSections: LandingFeature[];
  testimonials: Array<{ name: string; role: string; quote: string; avatar: string }>;
  faqs: Array<{ q: string; a: string }>;
};

const landingLongCopy: Record<Lang, LandingLongCopy> = {
  en: {
    featureSections: [
      {
        badge: '🔍 Project Explorer',
        title: 'Every campaign. Every outcome.',
        desc: 'Search 200K+ Kickstarter campaigns by keyword, filter by status, category, and country. Sort by funding amount, backers, or launch date. Export to CSV in one click.',
        bullets: ['Full-text keyword search', 'Multi-dimension filters', 'CSV export with cross-page selection', 'Row badges & ranking'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 Deep Analysis',
        title: 'Find the pattern. Spot the window.',
        desc: 'Category success rates, monthly launch trends, and country breakdowns, all in one view. Custom date ranges let you zero in on your exact competitive window.',
        bullets: ['Category success rate comparison', 'Monthly / yearly trend charts', 'Country & region benchmarks', 'Custom date range filter'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI Prediction',
        title: 'Score before you launch.',
        desc: 'Paste any Kickstarter pre-launch URL and get a 5-dimension AI score: brand, concept, market, pre-launch prep, and risk. Results in under 30 seconds.',
        bullets: ['5-dimension independent scoring', 'Success / Uncertain / Fail verdict', 'Highlights & risk breakdown', 'Paste URL, done in 30 s'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: 'Serial Founder', quote: 'Kicksonar cut my competitive research from days to hours. I benchmarked 50+ similar campaigns before finalizing my funding goal.', avatar: 'AC' },
      { name: 'Maria Santos', role: 'Product Manager', quote: 'Our AI score was 88. We hit 340% funded. The dimension breakdown showed us exactly where to improve our pre-launch.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'Crowdfunding Consultant', quote: 'I run every client through the category analysis before writing a brief. Knowing the success rate baseline changes the whole strategy.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'Design Brand Founder', quote: 'Country analysis showed the US success rate was 2x my home market. That one insight changed our entire launch strategy.', avatar: 'SB' },
    ],
    faqs: [
      { q: 'Where does the data come from?', a: "Data is sourced from webrobots.io's monthly Kickstarter full snapshots, covering 200K+ projects from March 2016 to today." },
      { q: 'How often is the data updated?', a: 'Automatically synced on the 15th of each month. You can also trigger a manual sync from the Data Sync page.' },
      { q: 'How accurate is the AI prediction?', a: "The AI scores based on publicly available pre-launch page data across 5 dimensions. It's a structured reference tool, not a guarantee. In back-testing, projects scoring 80+ show meaningfully higher success rates than average." },
      { q: 'Is registration free?', a: 'Completely free. Register to unlock all filtering, analysis, and AI prediction features. No credit card required.' },
      { q: 'Can I export data?', a: 'Yes, CSV export supports cross-page multi-select, and your selection persists across pages. You can also export the current page in one click.' },
    ],
  },
  cn: {
    featureSections: [
      {
        badge: '🔍 项目探索',
        title: '20 万+项目，一搜即到',
        desc: '按融资额、支持人数、类目、国家多维筛选，支持 CSV 批量导出。无论你是想找竞品还是找灵感，Kicksonar 都能帮你快速定位。',
        bullets: ['关键词全文检索', '多条件精准筛选', 'CSV 导出 / 跨页多选', '行号徽章，金银排名'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 深度分析',
        title: '从数据里找规律',
        desc: '类目成功率、月度发起趋势、国家融资排名，三个维度一次看完。自定义时间范围，精准定位你的赛道。',
        bullets: ['类目成功率对比', '月度/年度趋势图表', '国家/地区对比', '自定义日期范围'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI 预测',
        title: '发起前，先让 AI 看一眼',
        desc: '粘贴 Kickstarter 预热页链接，AI 从品牌、概念、市场、预热和风险五个维度综合打分，30 秒给出预测结论。',
        bullets: ['5 维度独立评分', '成功/失败/不确定三档结论', '亮点 & 风险详细解析', '仅需粘贴链接，30 秒出结果'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: '连续创业者', quote: 'Kicksonar 帮我在 2 天内分析完了竞品的融资数据，之前需要人工整理好几天。', avatar: 'AC' },
      { name: 'Maria Santos', role: '产品经理', quote: '发布前 AI 预测打了 88 分，结果项目超额 340% 完成，数据参考价值非常高。', avatar: 'MS' },
      { name: '田中 Kenji', role: '众筹顾问', quote: '每次给客户出方案前我都必须先跑一遍类目分析，帮助找准赛道和定价区间。', avatar: 'TK' },
      { name: 'Sophie Blanc', role: '设计品牌主理人', quote: '国家分析功能让我知道哪些市场更容易成功，直接优化了市场推广策略。', avatar: 'SB' },
    ],
    faqs: [
      { q: '数据来源是什么？', a: '数据来源于 webrobots.io 每月爬取的 Kickstarter 全量快照，共计 20 万+ 个项目，覆盖 2016 年 3 月至今。' },
      { q: '数据多久更新一次？', a: '每月15日自动同步最新一期数据集，也可在"数据同步"页面手动触发更新。' },
      { q: 'AI 预测的准确率如何？', a: 'AI 基于公开预热页面信息，从品牌、概念、市场等5个维度综合打分。它是结构化参考工具，而非保证结论。历史回测中，80分以上的项目成功率显著高于平均水平。' },
      { q: '注册需要付费吗？', a: '完全免费。注册后即可解锁全部筛选、分析和 AI 预测功能，无需信用卡。' },
      { q: '可以导出数据吗？', a: '支持 CSV 导出。可跨页多选后批量导出，也可一键导出当前页全部数据。' },
    ],
  },
  'zh-tw': {
    featureSections: [
      {
        badge: '🔍 項目探索',
        title: '20 萬+項目，一搜即到',
        desc: '按募資額、支持者、類目與國家多維篩選，並支援 CSV 批量匯出。無論你要找競品或靈感，都能快速定位。',
        bullets: ['關鍵字全文檢索', '多條件精準篩選', 'CSV 匯出 / 跨頁多選', '行號徽章與排名'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 深度分析',
        title: '從數據裡找規律',
        desc: '類目成功率、月度發起趨勢、國家募資排名，三個維度一次看完。自訂時間範圍，精準定位賽道。',
        bullets: ['類目成功率比較', '月度 / 年度趨勢圖', '國家與地區基準', '自訂日期範圍'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI 預測',
        title: '發起前，先讓 AI 看一眼',
        desc: '貼上 Kickstarter 預熱頁連結，AI 從品牌、概念、市場、預熱與風險五個維度評分，快速給出預測結論。',
        bullets: ['5 維度獨立評分', '成功 / 不確定 / 失敗結論', '亮點與風險拆解', '貼上連結即可分析'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: '連續創業者', quote: 'Kicksonar 讓我兩天內看完競品募資資料，以前需要人工整理好幾天。', avatar: 'AC' },
      { name: 'Maria Santos', role: '產品經理', quote: '發布前 AI 預測分數是 88，結果項目達成 340% 募資，維度拆解很有參考價值。', avatar: 'MS' },
      { name: '田中 Kenji', role: '眾籌顧問', quote: '每次給客戶做方案前，我都會先跑類目分析，幫助找準賽道和定價區間。', avatar: 'TK' },
      { name: 'Sophie Blanc', role: '設計品牌主理人', quote: '國家分析讓我看清哪些市場更容易成功，直接改變了推廣策略。', avatar: 'SB' },
    ],
    faqs: [
      { q: '數據來源是什麼？', a: '數據來源於 webrobots.io 每月爬取的 Kickstarter 全量快照，涵蓋 20 萬+個項目，自 2016 年 3 月至今。' },
      { q: '數據多久更新一次？', a: '每月15日自動同步最新資料集，也可在「數據同步」頁面手動觸發更新。' },
      { q: 'AI 預測準確率如何？', a: 'AI 基於公開預熱頁資訊，從 5 個維度做結構化評分。它是參考工具，不是保證結論。歷史回測中，80 分以上項目的成功率明顯高於平均。' },
      { q: '註冊需要付費嗎？', a: '完全免費。註冊後即可解鎖完整篩選、分析與 AI 預測功能，無需信用卡。' },
      { q: '可以匯出數據嗎？', a: '支援 CSV 匯出。可跨頁多選後批量匯出，也可一鍵匯出目前頁面。' },
    ],
  },
  ja: {
    featureSections: [
      {
        badge: '🔍 プロジェクト探索',
        title: '20万件以上の案件をすぐ検索',
        desc: '調達額、支援者数、カテゴリ、国で Kickstarter キャンペーンを絞り込み、CSV でまとめて書き出せます。競合調査にもアイデア探しにも使えます。',
        bullets: ['全文キーワード検索', '複数条件フィルタ', 'CSV 出力 / 複数ページ選択', '順位バッジ表示'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 詳細分析',
        title: 'データから勝ち筋を読む',
        desc: 'カテゴリ別成功率、月次ローンチ傾向、国別の調達状況を一画面で確認できます。期間を指定して、自分の市場に絞り込めます。',
        bullets: ['カテゴリ別成功率比較', '月次 / 年次トレンド', '国と地域の比較', 'カスタム日付範囲'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI 予測',
        title: '公開前に AI で確認',
        desc: 'Kickstarter のプレローンチ URL を貼るだけで、ブランド、コンセプト、市場、準備状況、リスクの5軸スコアを取得できます。',
        bullets: ['5軸の独立スコア', '成功 / 不確実 / 失敗の判定', '強みとリスクの整理', 'URL を貼るだけで分析'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: '連続起業家', quote: 'Kicksonar のおかげで競合の調達データを数時間で把握できました。以前なら数日かかっていました。', avatar: 'AC' },
      { name: 'Maria Santos', role: 'プロダクトマネージャー', quote: 'AI スコアは 88。実際の達成率は 340% でした。改善すべき準備項目がはっきりしました。', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'クラウドファンディング顧問', quote: 'クライアント提案の前には必ずカテゴリ分析を見ます。成功率の基準が戦略を変えます。', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'デザインブランド創業者', quote: '国別分析で狙うべき市場が見え、ローンチ前のプロモーション計画を組み直せました。', avatar: 'SB' },
    ],
    faqs: [
      { q: 'データの出所は？', a: 'webrobots.io が毎月取得する Kickstarter の全量スナップショットを利用し、2016年3月以降の20万件以上のプロジェクトを対象にしています。' },
      { q: '更新頻度は？', a: '毎月15日に自動同期します。「データ同期」ページから手動更新することもできます。' },
      { q: 'AI 予測の精度は？', a: '公開プレローンチページの情報をもとに5つの観点でスコア化します。保証ではなく、構造化された参考情報です。過去検証では80点以上の案件は平均より高い成功率を示しています。' },
      { q: '登録は無料ですか？', a: '完全無料です。登録すると全フィルタ、分析、AI 予測を利用できます。クレジットカードは不要です。' },
      { q: 'データを書き出せますか？', a: 'CSV 出力に対応しています。複数ページをまたいだ選択と、現在ページの一括書き出しができます。' },
    ],
  },
  ko: {
    featureSections: [
      {
        badge: '🔍 프로젝트 탐색',
        title: '20만 개 이상 캠페인을 빠르게 검색',
        desc: '키워드, 상태, 카테고리, 국가, 모금액, 후원자 수로 Kickstarter 캠페인을 필터링하고 CSV로 내보낼 수 있습니다.',
        bullets: ['전체 텍스트 검색', '다중 조건 필터', 'CSV 내보내기 / 페이지 간 선택', '순위 배지 표시'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 심층 분석',
        title: '데이터에서 패턴 찾기',
        desc: '카테고리 성공률, 월별 출시 흐름, 국가별 모금 성과를 한 화면에서 확인하고 원하는 기간으로 범위를 좁힐 수 있습니다.',
        bullets: ['카테고리 성공률 비교', '월별 / 연도별 추세', '국가와 지역 벤치마크', '사용자 지정 날짜 범위'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI 예측',
        title: '출시 전에 AI로 점검',
        desc: 'Kickstarter 프리런치 URL을 붙여 넣으면 브랜드, 콘셉트, 시장, 사전 준비, 리스크 5개 차원에서 점수를 확인할 수 있습니다.',
        bullets: ['5개 차원 독립 평가', '성공 / 불확실 / 실패 판정', '강점과 리스크 분석', 'URL만 붙여 넣으면 분석'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: '연쇄 창업가', quote: 'Kicksonar 덕분에 경쟁 캠페인 조사를 며칠에서 몇 시간으로 줄였습니다.', avatar: 'AC' },
      { name: 'Maria Santos', role: '제품 매니저', quote: 'AI 점수는 88점이었고 실제 캠페인은 340% 달성했습니다. 보완할 부분이 분명해졌습니다.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: '크라우드펀딩 컨설턴트', quote: '고객 제안서를 쓰기 전에 항상 카테고리 분석을 확인합니다. 성공률 기준이 전략을 바꿉니다.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: '디자인 브랜드 창업자', quote: '국가 분석으로 어떤 시장에 집중해야 할지 알 수 있었고 출시 전략을 수정했습니다.', avatar: 'SB' },
    ],
    faqs: [
      { q: '데이터 출처는 어디인가요?', a: 'webrobots.io의 월간 Kickstarter 전체 스냅샷을 기반으로 하며, 2016년 3월 이후 20만 개 이상의 프로젝트를 포함합니다.' },
      { q: '데이터는 얼마나 자주 업데이트되나요?', a: '매월 15일 자동 동기화되며, 데이터 동기화 페이지에서 수동으로도 업데이트할 수 있습니다.' },
      { q: 'AI 예측은 얼마나 정확한가요?', a: '공개 프리런치 페이지 정보를 바탕으로 5개 차원을 평가하는 참고 도구입니다. 보장은 아니지만, 과거 검증에서 80점 이상 프로젝트는 평균보다 높은 성공률을 보였습니다.' },
      { q: '가입은 무료인가요?', a: '완전히 무료입니다. 가입하면 전체 필터, 분석, AI 예측 기능을 사용할 수 있으며 카드가 필요하지 않습니다.' },
      { q: '데이터를 내보낼 수 있나요?', a: 'CSV 내보내기를 지원합니다. 여러 페이지에 걸쳐 선택하거나 현재 페이지를 한 번에 내보낼 수 있습니다.' },
    ],
  },
  de: {
    featureSections: [
      {
        badge: '🔍 Projekt Explorer',
        title: 'Über 200.000 Kampagnen sofort durchsuchen',
        desc: 'Suche Kickstarter-Kampagnen nach Keywords und filtere nach Status, Kategorie, Land, Finanzierungsvolumen und Unterstützern. Export als CSV inklusive.',
        bullets: ['Volltextsuche', 'Mehrdimensionale Filter', 'CSV-Export / seitenübergreifende Auswahl', 'Rang- und Badge-Anzeige'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 Tiefenanalyse',
        title: 'Muster erkennen, Timing finden',
        desc: 'Erfolgsraten nach Kategorie, monatliche Launch-Trends und Länder-Benchmarks in einer Ansicht. Eigene Zeiträume helfen beim präzisen Marktvergleich.',
        bullets: ['Vergleich der Erfolgsraten', 'Monats- und Jahrestrends', 'Länder- und Regionen-Benchmarks', 'Eigener Datumsbereich'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 AI Prognose',
        title: 'Vor dem Launch bewerten',
        desc: 'Füge eine Kickstarter-Prelaunch-URL ein und erhalte einen 5-Dimensionen-Score für Marke, Konzept, Markt, Vorbereitung und Risiko.',
        bullets: ['5 unabhängige Dimensionen', 'Erfolg / Unsicher / Risiko-Urteil', 'Stärken- und Risikoanalyse', 'URL einfügen und analysieren'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: 'Seriengründer', quote: 'Kicksonar hat meine Wettbewerbsanalyse von Tagen auf Stunden verkürzt.', avatar: 'AC' },
      { name: 'Maria Santos', role: 'Produktmanagerin', quote: 'Unser AI Score lag bei 88 und die Kampagne erreichte 340%. Die Dimensionen zeigten klar, wo wir nachschärfen mussten.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'Crowdfunding-Berater', quote: 'Vor jedem Kundenbriefing prüfe ich die Kategorieanalyse. Die Erfolgsrate verändert die ganze Strategie.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'Designmarken-Gründerin', quote: 'Die Länderanalyse zeigte, welche Märkte am vielversprechendsten sind. Das hat unseren Launch-Plan verändert.', avatar: 'SB' },
    ],
    faqs: [
      { q: 'Woher stammen die Daten?', a: 'Die Daten stammen aus den monatlichen Kickstarter-Snapshots von webrobots.io und umfassen über 200.000 Projekte seit März 2016.' },
      { q: 'Wie oft werden die Daten aktualisiert?', a: 'Die Synchronisierung läuft automatisch am 15. jedes Monats. Manuelle Updates sind über die Data-Sync-Seite möglich.' },
      { q: 'Wie genau ist die AI Prognose?', a: 'Sie bewertet öffentlich verfügbare Prelaunch-Informationen in 5 Dimensionen. Sie ist ein strukturiertes Referenzwerkzeug, keine Garantie. In Rücktests waren Projekte mit 80+ Punkten deutlich erfolgreicher als der Durchschnitt.' },
      { q: 'Ist die Registrierung kostenlos?', a: 'Ja, komplett kostenlos. Nach der Registrierung sind Filter, Analysen und AI Prognosen freigeschaltet. Keine Kreditkarte nötig.' },
      { q: 'Kann ich Daten exportieren?', a: 'Ja, CSV-Export unterstützt seitenübergreifende Mehrfachauswahl sowie den Export der aktuellen Seite.' },
    ],
  },
  it: {
    featureSections: [
      {
        badge: '🔍 Esplora progetti',
        title: 'Oltre 200.000 campagne a portata di ricerca',
        desc: 'Cerca campagne Kickstarter per parola chiave e filtra per stato, categoria, paese, raccolta e sostenitori. Esporta tutto in CSV quando serve.',
        bullets: ['Ricerca full-text', 'Filtri multidimensionali', 'Export CSV / selezione multi-pagina', 'Badge e ranking di riga'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 Analisi profonda',
        title: 'Trova pattern e finestre di lancio',
        desc: 'Tassi di successo per categoria, trend mensili e benchmark per paese in una sola vista. I range personalizzati aiutano a leggere il tuo mercato.',
        bullets: ['Confronto tassi di successo', 'Trend mensili / annuali', 'Benchmark per paese e regione', 'Intervallo date personalizzato'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 Previsione AI',
        title: 'Valuta prima del lancio',
        desc: 'Incolla un URL pre-lancio Kickstarter e ottieni un punteggio AI su 5 dimensioni: brand, concept, mercato, preparazione e rischio.',
        bullets: ['5 dimensioni indipendenti', 'Verdetto successo / incerto / rischio', 'Analisi di punti forti e rischi', 'Incolla l’URL e analizza'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: 'Founder seriale', quote: 'Kicksonar ha ridotto la mia ricerca competitiva da giorni a poche ore.', avatar: 'AC' },
      { name: 'Maria Santos', role: 'Product Manager', quote: 'Il nostro score AI era 88 e la campagna ha raggiunto il 340%. Le dimensioni ci hanno indicato dove migliorare.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'Consulente crowdfunding', quote: 'Prima di ogni brief cliente controllo l’analisi di categoria. Il benchmark di successo cambia la strategia.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'Fondatrice brand design', quote: 'L’analisi per paese ci ha mostrato dove puntare e ha cambiato il piano di lancio.', avatar: 'SB' },
    ],
    faqs: [
      { q: 'Da dove arrivano i dati?', a: 'I dati provengono dagli snapshot mensili Kickstarter di webrobots.io e coprono oltre 200.000 progetti da marzo 2016 a oggi.' },
      { q: 'Ogni quanto vengono aggiornati?', a: 'La sincronizzazione automatica avviene il 15 di ogni mese. Puoi anche avviare un aggiornamento manuale dalla pagina Data Sync.' },
      { q: 'Quanto è accurata la previsione AI?', a: 'Valuta le informazioni pubbliche della pagina pre-lancio su 5 dimensioni. È uno strumento di riferimento strutturato, non una garanzia. Nei test storici, i progetti sopra 80 punti hanno avuto tassi di successo più alti della media.' },
      { q: 'La registrazione è gratuita?', a: 'Sì, completamente gratuita. Registrandoti sblocchi filtri, analisi e previsione AI senza carta di credito.' },
      { q: 'Posso esportare i dati?', a: 'Sì, l’export CSV supporta selezioni su più pagine e l’esportazione immediata della pagina corrente.' },
    ],
  },
  fr: {
    featureSections: [
      {
        badge: '🔍 Explorateur de projets',
        title: 'Plus de 200 000 campagnes à explorer',
        desc: 'Recherchez des campagnes Kickstarter par mot-clé et filtrez par statut, catégorie, pays, montant collecté et contributeurs. Export CSV inclus.',
        bullets: ['Recherche plein texte', 'Filtres multidimensionnels', 'Export CSV / sélection multi-page', 'Badges et classement'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 Analyse approfondie',
        title: 'Repérez les tendances et le bon timing',
        desc: 'Taux de réussite par catégorie, tendances mensuelles et benchmarks par pays dans une seule vue. Les périodes personnalisées affinent votre analyse.',
        bullets: ['Comparaison des taux de réussite', 'Tendances mensuelles / annuelles', 'Benchmarks pays et régions', 'Plage de dates personnalisée'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 Prédiction AI',
        title: 'Évaluez avant de lancer',
        desc: 'Collez une URL de pré-lancement Kickstarter et obtenez un score AI en 5 dimensions : marque, concept, marché, préparation et risque.',
        bullets: ['5 dimensions indépendantes', 'Verdict succès / incertain / risque', 'Analyse des forces et risques', 'Collez l’URL et analysez'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: 'Entrepreneur en série', quote: 'Kicksonar a réduit ma recherche concurrentielle de plusieurs jours à quelques heures.', avatar: 'AC' },
      { name: 'Maria Santos', role: 'Product Manager', quote: 'Notre score AI était de 88 et la campagne a atteint 340%. Les dimensions nous ont montré quoi améliorer.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'Consultant crowdfunding', quote: 'Avant chaque brief client, je consulte l’analyse de catégorie. Le benchmark de réussite change toute la stratégie.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'Fondatrice de marque design', quote: 'L’analyse par pays nous a montré où concentrer le lancement et a modifié notre plan marketing.', avatar: 'SB' },
    ],
    faqs: [
      { q: 'D’où viennent les données ?', a: 'Les données viennent des snapshots Kickstarter mensuels de webrobots.io et couvrent plus de 200 000 projets depuis mars 2016.' },
      { q: 'À quelle fréquence sont-elles mises à jour ?', a: 'La synchronisation automatique se lance le 15 de chaque mois. Une synchronisation manuelle est aussi disponible depuis la page Data Sync.' },
      { q: 'Quelle est la précision de la prédiction AI ?', a: 'Elle évalue les informations publiques de la page de pré-lancement sur 5 dimensions. C’est un outil de référence structuré, pas une garantie. En back-test, les projets au-dessus de 80 points réussissent nettement plus souvent que la moyenne.' },
      { q: 'L’inscription est-elle gratuite ?', a: 'Oui, totalement gratuite. Elle débloque les filtres, l’analyse et la prédiction AI sans carte bancaire.' },
      { q: 'Puis-je exporter les données ?', a: 'Oui, l’export CSV prend en charge la sélection multi-page et l’export de la page actuelle en un clic.' },
    ],
  },
  es: {
    featureSections: [
      {
        badge: '🔍 Explorador de proyectos',
        title: 'Más de 200.000 campañas para buscar',
        desc: 'Busca campañas de Kickstarter por palabra clave y filtra por estado, categoría, país, recaudación y patrocinadores. Exporta a CSV cuando lo necesites.',
        bullets: ['Búsqueda de texto completo', 'Filtros multidimensionales', 'Exportación CSV / selección multi-página', 'Insignias y ranking'],
        mockup: 'table',
        flip: false,
      },
      {
        badge: '📊 Análisis profundo',
        title: 'Detecta patrones y el mejor momento',
        desc: 'Tasas de éxito por categoría, tendencias mensuales y benchmarks por país en una sola vista. Los rangos personalizados afinan tu análisis.',
        bullets: ['Comparación de tasas de éxito', 'Tendencias mensuales / anuales', 'Benchmarks por país y región', 'Rango de fechas personalizado'],
        mockup: 'chart',
        flip: true,
      },
      {
        badge: '🤖 Predicción AI',
        title: 'Evalúa antes de lanzar',
        desc: 'Pega una URL de prelanzamiento de Kickstarter y recibe un score AI en 5 dimensiones: marca, concepto, mercado, preparación y riesgo.',
        bullets: ['5 dimensiones independientes', 'Veredicto éxito / incierto / riesgo', 'Análisis de fortalezas y riesgos', 'Pega la URL y analiza'],
        mockup: 'score',
        flip: false,
      },
    ],
    testimonials: [
      { name: 'Alex Chen', role: 'Fundador serial', quote: 'Kicksonar redujo mi investigación competitiva de días a unas pocas horas.', avatar: 'AC' },
      { name: 'Maria Santos', role: 'Product Manager', quote: 'Nuestro score AI fue 88 y la campaña llegó al 340%. Las dimensiones nos mostraron dónde mejorar.', avatar: 'MS' },
      { name: 'Kenji Tanaka', role: 'Consultor de crowdfunding', quote: 'Antes de cada propuesta reviso el análisis de categoría. El benchmark de éxito cambia toda la estrategia.', avatar: 'TK' },
      { name: 'Sophie Blanc', role: 'Fundadora de marca de diseño', quote: 'El análisis por país mostró dónde enfocar el lanzamiento y cambió nuestro plan de marketing.', avatar: 'SB' },
    ],
    faqs: [
      { q: '¿De dónde vienen los datos?', a: 'Los datos provienen de los snapshots mensuales de Kickstarter de webrobots.io y cubren más de 200.000 proyectos desde marzo de 2016.' },
      { q: '¿Cada cuánto se actualizan?', a: 'La sincronización automática se ejecuta el día 15 de cada mes. También puedes iniciar una actualización manual desde Data Sync.' },
      { q: '¿Qué tan precisa es la predicción AI?', a: 'Evalúa la información pública de la página de prelanzamiento en 5 dimensiones. Es una referencia estructurada, no una garantía. En pruebas históricas, los proyectos con 80+ puntos tuvieron tasas de éxito claramente superiores al promedio.' },
      { q: '¿Registrarse es gratis?', a: 'Sí, completamente gratis. El registro desbloquea filtros, análisis y predicción AI sin tarjeta de crédito.' },
      { q: '¿Puedo exportar datos?', a: 'Sí, la exportación CSV permite selección multi-página y exportar la página actual con un clic.' },
    ],
  },
};

// ── Main page ──────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user, logout, showLogin } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].landing;
  const copy = uiCopy[lang].landing;
  const router = useRouter();

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [statsFactor, setStatsFactor] = useState(0.92);
  const [liveSummary, setLiveSummary] = useState<LiveSummary | null>(null);
  const [statsFetchedAt, setStatsFetchedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [top2026, setTop2026] = useState<LandingProject[]>([]);
  const [defaultSuggestions, setDefaultSuggestions] = useState<{ latestMonth: SearchHit[] }>({ latestMonth: [] });
  const [navSearch, setNavSearch] = useState('');
  const [suggestions, setSuggestions] = useState<SearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadStats = useCallback(() => {
    fetch('/api/stats').then(r => r.json()).then(d => {
      if (d.stats) setStats(d.stats);
      if (d.liveSummary) {
        setLiveSummary({
          pledged_delta_24h: Number(d.liveSummary.pledged_delta_24h ?? 0),
          launched_24h: Number(d.liveSummary.launched_24h ?? 0),
        });
        setStatsFetchedAt(Date.now());
      }
      if (d.landing) {
        setTop2026(d.landing.top2026 ?? []);
        setDefaultSuggestions({
          latestMonth: d.landing.latestMonth ?? [],
        });
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    loadStats();
    const poll = window.setInterval(loadStats, 30000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [loadStats]);

  useEffect(() => {
    setStatsFactor(0.92);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / 3600);
      setStatsFactor(0.92 + 0.08 * progress);
      if (progress >= 1) window.clearInterval(timer);
    }, 120);
    return () => window.clearInterval(timer);
  }, [stats?.total, stats?.total_pledged_usd, stats?.category_count]);

  const fetchSuggestions = useCallback((q: string) => {
    if (!q.trim()) {
      setSuggestions([]);
      return;
    }
    if (q.length < 2) { setSuggestions([]); return; }
    fetch(`/api/projects?search=${encodeURIComponent(q)}&limit=5&page=1`)
      .then(r => r.json())
      .then(d => setSuggestions(d.rows?.slice(0, 5) ?? []))
      .catch(() => {});
  }, []);

  const handleNavSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setNavSearch(v);
    setShowSuggestions(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(v), 300);
  };

  const showDefaultSearch = () => {
    setShowSuggestions(true);
    if (!navSearch.trim()) setSuggestions([]);
  };

  const handleNavSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (navSearch.trim()) {
      router.push(`/projects?search=${encodeURIComponent(navSearch.trim())}`);
      setShowSuggestions(false);
    }
  };

  const openProjectFromSuggestion = (id: string) => {
    if (!id) return;
    window.open(`/projects/${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
    setShowSuggestions(false);
    setNavSearch('');
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fmtNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M+`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K+`;
    return String(n);
  };

  const elapsedSeconds = statsFetchedAt ? Math.max(0, (clock - statsFetchedAt) / 1000) : 0;
  const projectedPledgedM = stats
    ? (stats.total_pledged_usd + ((liveSummary?.pledged_delta_24h ?? 0) / 1_000_000 / 86400) * elapsedSeconds) * statsFactor
    : 0;
  const projectedProjectTotal = stats
    ? (stats.total + Math.floor(((liveSummary?.launched_24h ?? 0) / 86400) * elapsedSeconds)) * statsFactor
    : 0;

  const platformStats = [
    { label: tr.stats.projects,   value: stats ? fmtNum(projectedProjectTotal)  : '200K+', color: 'text-ks-green' },
    { label: tr.stats.rate,       value: stats ? `${(stats.success_rate * statsFactor).toFixed(1)}%` : '35%',   color: 'text-white' },
    { label: tr.stats.raised,     value: stats ? `$${projectedPledgedM.toFixed(2)}M` : '$2B+',  color: 'text-white' },
    { label: tr.stats.categories, value: stats?.category_count ? String(Math.max(1, Math.round(stats.category_count * statsFactor))) : '18', color: 'text-white' },
  ];

  const { featureSections, testimonials, faqs } = landingLongCopy[lang];

  return (
    <>
      <LoginModal />
      <div className="min-h-screen flex flex-col bg-white">

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-4">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Image src="/logo.svg" alt="Kicksonar" width={26} height={26} />
              <span className="font-bold text-gray-900 text-base hidden sm:block">Kicksonar</span>
            </Link>

            {/* Search */}
            <div className="flex-1 max-w-xl mx-auto relative" ref={suggestRef}>
              <form onSubmit={handleNavSearchSubmit}>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={navSearch}
                    onChange={handleNavSearchChange}
                    onFocus={showDefaultSearch}
                    placeholder={copy.searchProjects}
                    className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-ks-green/40 focus:border-ks-green bg-gray-50 transition-all"
                  />
                </div>
              </form>
              {showSuggestions && (suggestions.length > 0 || !navSearch.trim()) && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden z-50">
                  {navSearch.trim() ? suggestions.map(s => (
                    <button
                      key={s.id}
                      className="w-full px-4 py-2.5 text-left hover:bg-gray-50 transition-colors flex items-center gap-3 border-b border-gray-50 last:border-0"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => openProjectFromSuggestion(s.id)}
                    >
                      <span className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                        {(s.image_thumb_url || s.image_url) ? (
                          <img src={s.image_thumb_url || s.image_url || ''} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
                        ) : (
                          <Search className="m-3 h-4 w-4 text-gray-300" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{s.name}</div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                          <span>{s.category_parent}</span>
                          <LandingStatePill state={s.state} lang={lang} />
                          {typeof s.usd_pledged === 'number' && (
                            <span className="inline-flex items-center gap-1">{fmtMoneyCompact(s.usd_pledged)} <LandingTrendMark state={s.state} /></span>
                          )}
                        </div>
                      </div>
                    </button>
                  )) : (
                    <div>
                      {defaultSuggestions.latestMonth.slice(0, 5).map(s => {
                        const img = s.image_thumb_url || s.image_url;
                        return (
                          <button
                            key={s.id}
                            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50"
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => openProjectFromSuggestion(s.id)}
                          >
                            <span className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                              {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-gray-800">{s.name}</span>
                              <span className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                                <span>{s.category_parent}</span>
                                <LandingStatePill state={s.state} lang={lang} />
                                <span className="inline-flex items-center gap-1">{fmtMoneyCompact(s.usd_pledged ?? 0)} <LandingTrendMark state={s.state} /></span>
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {navSearch.trim() && <button
                    className="w-full px-4 py-2 text-left text-xs text-ks-green font-semibold hover:bg-ks-green-light transition-colors"
                    onClick={() => handleNavSearchSubmit()}
                  >
                    {copy.searchFor(navSearch)}
                  </button>}
                </div>
              )}
            </div>

            {/* Right nav */}
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/live-intel" className="hidden sm:flex text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                {tr.nav.dashboard}
              </Link>
              <Link href="/about" className="hidden md:flex text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
                {tr.nav.about}
              </Link>
              {user ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-ks-green/10 px-3 py-1.5 rounded-full">
                    <div className="w-5 h-5 rounded-full bg-ks-green flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">{user.username[0].toUpperCase()}</span>
                    </div>
                    <span className="text-xs font-semibold text-ks-green-dark hidden sm:block">{user.username}</span>
                  </div>
                  <button onClick={logout} className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors" title={t[lang].auth.logout}>
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => showLogin()}
                  className="flex items-center gap-1.5 bg-ks-green hover:bg-ks-green-dark text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                  <User className="w-3.5 h-3.5" />
                  <span className="hidden sm:block">{t[lang].auth.signIn}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#011a10] via-[#022c1c] to-[#03402a] flex-shrink-0">
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="absolute rounded-full border border-ks-green/10"
                style={{ width: `${i * 20}%`, height: `${i * 20}%`, opacity: 1 - i * 0.2 }} />
            ))}
          </div>

          <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 text-center">
            <div className="inline-flex items-center gap-2 bg-ks-green/15 border border-ks-green/25 rounded-full px-4 py-1.5 mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-ks-green animate-pulse" />
              <span className="text-ks-green text-xs font-semibold tracking-wide uppercase">
                {copy.liveBadge}
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight mb-6">
              {tr.tagline}
            </h1>
            <p className="text-lg text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
              {tr.subtitle}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/live-intel"
                className="inline-flex items-center gap-2 bg-ks-green hover:bg-ks-green-dark text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all shadow-lg shadow-ks-green/25 hover:shadow-ks-green/40 hover:-translate-y-0.5"
              >
                {tr.cta}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/live-intel"
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-8 py-3.5 rounded-xl font-semibold text-base transition-all border border-white/10"
              >
                {tr.learnMore}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        <section className="bg-[#022c1c] border-t border-ks-green/20">
          <div className="max-w-6xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
            {platformStats.map(s => (
              <div key={s.label}>
                <div className={`text-3xl md:text-4xl font-black ${s.color}`}><RollingValue value={s.value} /></div>
                <div className="text-white/50 text-xs font-medium mt-1 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature sections ────────────────────────────────────────────── */}
        {featureSections.map((f, i) => (
          <section key={i} className={`py-20 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
            <div className="max-w-6xl mx-auto px-6">
              <div className={`flex flex-col ${f.flip ? 'md:flex-row-reverse' : 'md:flex-row'} items-center gap-12 md:gap-16`}>
                {/* Text */}
                <div className="flex-1 space-y-5">
                  <span className="inline-block text-sm font-bold text-ks-green bg-ks-green/10 px-3 py-1 rounded-full">{f.badge}</span>
                  <h2 className="text-3xl md:text-4xl font-black text-gray-900 leading-tight">{f.title}</h2>
                  <p className="text-gray-500 leading-relaxed text-base">{f.desc}</p>
                  <ul className="space-y-2.5">
                    {f.bullets.map((b, j) => (
                      <li key={j} className="flex items-center gap-2.5 text-sm text-gray-700">
                        <div className="w-4 h-4 rounded-full bg-ks-green-light flex items-center justify-center shrink-0">
                          <div className="w-1.5 h-1.5 rounded-full bg-ks-green" />
                        </div>
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Mockup */}
                <div className="flex-1 w-full">
                  {f.mockup === 'table' && <ProjectTableMockup lang={lang} rows={top2026} />}
                  {f.mockup === 'chart' && <ChartMockup lang={lang} />}
                  {f.mockup === 'score' && <ScoreMockup lang={lang} />}
                </div>
              </div>
            </div>
          </section>
        ))}

        {/* ── Testimonials ────────────────────────────────────────────────── */}
        <section className="py-20 bg-white">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                {copy.foundersSay}
              </h2>
              <p className="text-sm text-gray-400">
                {copy.foundersSub}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {testimonials.map((item, i) => (
                <div key={i} className="bg-gray-50 rounded-2xl p-5 border border-gray-100 flex flex-col">
                  <p className="text-sm text-gray-600 leading-relaxed flex-1 mb-4">"{item.quote}"</p>
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-ks-green flex items-center justify-center shrink-0">
                      <span className="text-white text-xs font-bold">{item.avatar}</span>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-gray-800">{item.name}</div>
                      <div className="text-[10px] text-gray-400">{item.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ─────────────────────────────────────────────────────────── */}
        <section className="py-20 bg-gray-50">
          <div className="max-w-3xl mx-auto px-6">
            <div className="text-center mb-10">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                {copy.faq}
              </h2>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 px-6 shadow-sm">
              {faqs.map((f, i) => (
                <FaqItem key={i} q={f.q} a={f.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="py-16 bg-gradient-to-br from-[#022c1c] to-[#03402a]">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-2xl md:text-3xl font-black text-white mb-4">
              {copy.start}
            </h2>
            <p className="text-white/60 text-sm mb-8">
              {copy.startSub}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => showLogin()}
                className="inline-flex items-center gap-2 bg-ks-green hover:bg-ks-green-dark text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all shadow-lg shadow-ks-green/25 hover:-translate-y-0.5"
              >
                {copy.createFree}
                <ArrowRight className="w-4 h-4" />
              </button>
              <Link
                href="/live-intel"
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-8 py-3.5 rounded-xl font-semibold text-base transition-all border border-white/10"
              >
                {copy.exploreData}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="bg-white border-t border-gray-100 py-8">
          <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <Image src="/logo.svg" alt="" width={16} height={16} className="opacity-50" />
              <span>© 2026 Kicksonar · Data: <a href="https://webrobots.io" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">webrobots.io</a></span>
            </div>
            <div className="flex items-center gap-4 flex-wrap justify-center">
              <Link href="/live-intel" className="hover:text-gray-600 transition-colors">{tr.nav.dashboard}</Link>
              <Link href="/about" className="hover:text-gray-600 transition-colors">{tr.nav.about}</Link>
              <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub</a>
              <LanguageSelect variant="light" />
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
