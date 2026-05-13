'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Search, ArrowRight, User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, setLang } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import LoginModal from '@/components/LoginModal';

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
function ProjectTableMockup({ lang, rows: liveRows }: { lang: string; rows?: LandingProject[] }) {
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
            <span className="text-gray-400 text-[10px]">{lang === 'cn' ? '搜索项目...' : 'Search campaigns...'}</span>
          </div>
          <div className="bg-ks-green text-white text-[10px] px-2 py-1.5 rounded-lg font-semibold">{lang === 'cn' ? '筛选' : 'Filter'}</div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-gray-400 text-[9px] uppercase">
              <th className="text-left pb-2">#</th>
              <th className="text-left pb-2">{lang === 'cn' ? '项目' : 'Project'}</th>
              <th className="text-left pb-2">{lang === 'cn' ? '类目' : 'Category'}</th>
              <th className="text-right pb-2">{lang === 'cn' ? '金额' : 'Pledged'}</th>
              <th className="text-right pb-2">{lang === 'cn' ? '完成率' : 'Funded'}</th>
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
function ChartMockup({ lang }: { lang: string }) {
  const bars = [42, 65, 58, 78, 55, 88, 72, 95, 61, 83, 70, 62];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-1.5 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-2 text-gray-400 text-[10px]">{lang === 'cn' ? '月度趋势分析' : 'Monthly Trend Analysis'}</span>
      </div>
      <div className="p-4">
        <div className="text-[10px] text-gray-500 font-semibold mb-3">{lang === 'cn' ? '月度发起量 & 成功率' : 'Monthly Launches & Success Rate'}</div>
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
            { label: lang === 'cn' ? '总项目' : 'Total', val: '12,847' },
            { label: lang === 'cn' ? '成功率' : 'Rate', val: '36.2%' },
            { label: lang === 'cn' ? '峰值月' : 'Peak', val: 'Aug' },
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
function ScoreMockup({ lang }: { lang: string }) {
  const dims = [
    { label: lang === 'cn' ? '品牌' : 'Brand', score: 88 },
    { label: lang === 'cn' ? '概念' : 'Concept', score: 92 },
    { label: lang === 'cn' ? '市场' : 'Market', score: 76 },
    { label: lang === 'cn' ? '预热' : 'Pre-launch', score: 83 },
    { label: lang === 'cn' ? '风险' : 'Risk', score: 71 },
  ];
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden text-xs">
      <div className="bg-gray-50 px-3 py-2 flex items-center gap-1.5 border-b border-gray-100">
        <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        <span className="ml-2 text-gray-400 text-[10px]">{lang === 'cn' ? 'AI 预测评分' : 'AI Prediction Score'}</span>
      </div>
      <div className="p-4">
        <div className="text-center mb-4">
          <div className="text-4xl font-black text-ks-green">82</div>
          <div className="text-[10px] text-gray-400 mt-0.5">{lang === 'cn' ? '综合评分 / 100' : 'Overall Score / 100'}</div>
          <div className="mt-2 inline-flex items-center gap-1 bg-ks-green-light text-ks-green text-[10px] font-semibold px-3 py-1 rounded-full">
            {lang === 'cn' ? '✓ 较可能成功' : '✓ Likely to Succeed'}
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

// ── Main page ──────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user, logout, showLogin } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].landing;
  const router = useRouter();

  const [stats, setStats] = useState<PlatformStats | null>(null);
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
    const poll = window.setInterval(loadStats, 15000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [loadStats]);

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
    ? stats.total_pledged_usd + ((liveSummary?.pledged_delta_24h ?? 0) / 1_000_000 / 86400) * elapsedSeconds
    : 0;
  const projectedProjectTotal = stats
    ? stats.total + Math.floor(((liveSummary?.launched_24h ?? 0) / 86400) * elapsedSeconds)
    : 0;

  const platformStats = [
    { label: tr.stats.projects,   value: stats ? fmtNum(projectedProjectTotal)  : '200K+', color: 'text-ks-green' },
    { label: tr.stats.rate,       value: stats ? `${stats.success_rate}%`        : '35%',   color: 'text-white' },
    { label: tr.stats.raised,     value: stats ? `$${projectedPledgedM.toFixed(2)}M` : '$2B+',  color: 'text-white' },
    { label: tr.stats.categories, value: stats?.category_count ? String(stats.category_count) : '18', color: 'text-white' },
  ];

  const featureSections = lang === 'cn' ? [
    {
      badge: '🔍 项目探索',
      title: '20 万+项目，一搜即到',
      desc: '按融资额、支持人数、类目、国家多维筛选，支持 CSV 批量导出。无论你是想找竞品还是找灵感，Kicksonar 都能帮你快速定位。',
      bullets: ['关键词全文检索', '多条件精准筛选', 'CSV 导出 / 跨页多选', '行号徽章，金银排名'],
      mockup: 'table' as const,
      flip: false,
    },
    {
      badge: '📊 深度分析',
      title: '从数据里找规律',
      desc: '类目成功率、月度发起趋势、国家融资排名——三个维度一次看完。自定义时间范围，精准定位你的赛道。',
      bullets: ['类目成功率对比', '月度/年度趋势图表', '国家/地区对比', '自定义日期范围'],
      mockup: 'chart' as const,
      flip: true,
    },
    {
      badge: '🤖 AI 预测',
      title: '发起前，先让 AI 看一眼',
      desc: '粘贴 Kickstarter 预热页链接，AI 从品牌、概念、市场、预热和风险五个维度综合打分，30 秒给出预测结论。',
      bullets: ['5 维度独立评分', '成功/失败/不确定三档结论', '亮点 & 风险详细解析', '仅需粘贴链接，30 秒出结果'],
      mockup: 'score' as const,
      flip: false,
    },
  ] : [
    {
      badge: '🔍 Project Explorer',
      title: 'Every campaign. Every outcome.',
      desc: 'Search 200K+ Kickstarter campaigns by keyword, filter by status, category, and country. Sort by funding amount, backers, or launch date. Export to CSV in one click.',
      bullets: ['Full-text keyword search', 'Multi-dimension filters', 'CSV export with cross-page selection', 'Row badges & ranking'],
      mockup: 'table' as const,
      flip: false,
    },
    {
      badge: '📊 Deep Analysis',
      title: 'Find the pattern. Spot the window.',
      desc: 'Category success rates, monthly launch trends, and country breakdowns — all in one view. Custom date ranges let you zero in on your exact competitive window.',
      bullets: ['Category success rate comparison', 'Monthly / yearly trend charts', 'Country & region benchmarks', 'Custom date range filter'],
      mockup: 'chart' as const,
      flip: true,
    },
    {
      badge: '🤖 AI Prediction',
      title: 'Score before you launch.',
      desc: 'Paste any Kickstarter pre-launch URL and get a 5-dimension AI score: brand, concept, market, pre-launch prep, and risk. Results in under 30 seconds.',
      bullets: ['5-dimension independent scoring', 'Success / Uncertain / Fail verdict', 'Highlights & risk breakdown', 'Paste URL — done in 30 s'],
      mockup: 'score' as const,
      flip: false,
    },
  ];

  const testimonials = lang === 'cn' ? [
    { name: 'Alex Chen', role: '连续创业者', quote: 'Kicksonar 帮我在 2 天内分析完了竞品的融资数据，之前需要人工整理好几天。', avatar: 'AC' },
    { name: 'Maria Santos', role: '产品经理', quote: '发布前 AI 预测打了 88 分，结果项目超额 340% 完成，数据参考价值非常高。', avatar: 'MS' },
    { name: '田中 Kenji', role: '众筹顾问', quote: '每次给客户出方案前我都必须先跑一遍类目分析，帮助找准赛道和定价区间。', avatar: 'TK' },
    { name: 'Sophie Blanc', role: '设计品牌主理人', quote: '国家分析功能让我知道哪些市场更容易成功，直接优化了市场推广策略。', avatar: 'SB' },
  ] : [
    { name: 'Alex Chen', role: 'Serial Founder', quote: 'Kicksonar cut my competitive research from days to hours. I benchmarked 50+ similar campaigns before finalizing my funding goal.', avatar: 'AC' },
    { name: 'Maria Santos', role: 'Product Manager', quote: 'Our AI score was 88. We hit 340% funded. The dimension breakdown showed us exactly where to improve our pre-launch.', avatar: 'MS' },
    { name: 'Kenji Tanaka', role: 'Crowdfunding Consultant', quote: 'I run every client through the category analysis before writing a brief. Knowing the success rate baseline changes the whole strategy.', avatar: 'TK' },
    { name: 'Sophie Blanc', role: 'Design Brand Founder', quote: 'Country analysis showed the US success rate was 2× my home market. That one insight changed our entire launch strategy.', avatar: 'SB' },
  ];

  const faqs = lang === 'cn' ? [
    { q: '数据来源是什么？', a: '数据来源于 webrobots.io 每月爬取的 Kickstarter 全量快照，共计 20 万+ 个项目，覆盖 2016 年 3 月至今。' },
    { q: '数据多久更新一次？', a: '每月15日自动同步最新一期数据集，也可在"数据同步"页面手动触发更新。' },
    { q: 'AI 预测的准确率如何？', a: 'AI 基于公开预热页面信息，从品牌、概念、市场等5个维度综合打分。它是结构化参考工具，而非保证结论。历史回测中，80分以上的项目成功率显著高于平均水平。' },
    { q: '注册需要付费吗？', a: '完全免费。注册后即可解锁全部筛选、分析和 AI 预测功能，无需信用卡。' },
    { q: '可以导出数据吗？', a: '支持 CSV 导出。可跨页多选后批量导出，也可一键导出当前页全部数据。' },
  ] : [
    { q: 'Where does the data come from?', a: "Data is sourced from webrobots.io's monthly Kickstarter full snapshots — 200K+ projects from March 2016 to present." },
    { q: 'How often is the data updated?', a: 'Automatically synced on the 15th of each month. You can also trigger a manual sync from the Data Sync page.' },
    { q: 'How accurate is the AI prediction?', a: "The AI scores based on publicly available pre-launch page data across 5 dimensions. It's a structured reference tool, not a guarantee. In back-testing, projects scoring 80+ show meaningfully higher success rates than average." },
    { q: 'Is registration free?', a: 'Completely free. Register to unlock all filtering, analysis, and AI prediction features. No credit card required.' },
    { q: 'Can I export data?', a: 'Yes — CSV export supports cross-page multi-select (your selection persists across pages) or one-click export of the current page.' },
  ];

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
                    placeholder={lang === 'cn' ? '搜索项目名称...' : 'Search campaigns...'}
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
                      onClick={() => { router.push(`/projects/${s.id}`); setShowSuggestions(false); setNavSearch(''); }}
                    >
                      <Search className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{s.name}</div>
                        <div className="text-xs text-gray-400">{s.category_parent}</div>
                      </div>
                    </button>
                  )) : (
                    <div>
                      <p className="px-4 py-2 text-xs font-bold text-gray-400">{lang === 'cn' ? '近一个月新发起金额 Top 5' : 'Top funded launches in 30 days'}</p>
                      {defaultSuggestions.latestMonth.slice(0, 5).map(s => {
                        const img = s.image_thumb_url || s.image_url;
                        return (
                          <button key={s.id} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-gray-50" onClick={() => { router.push(`/projects/${s.id}`); setShowSuggestions(false); }}>
                            <span className="h-10 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                              {img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-gray-800">{s.name}</span>
                              <span className="block text-xs text-gray-400">{s.category_parent} · {fmtMoneyCompact(s.usd_pledged ?? 0)}</span>
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
                    {lang === 'cn' ? `搜索 "${navSearch}" →` : `Search for "${navSearch}" →`}
                  </button>}
                </div>
              )}
            </div>

            {/* Right nav */}
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/dashboard" className="hidden sm:flex text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
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
                {lang === 'cn' ? '实时数据 · 200K+ 众筹项目' : 'Live Data · 200K+ Campaigns'}
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
                {lang === 'cn' ? '用数据说话' : 'What founders say'}
              </h2>
              <p className="text-sm text-gray-400">
                {lang === 'cn' ? '来自使用 Kicksonar 的创业者和顾问' : 'From founders and consultants who use Kicksonar'}
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
                {lang === 'cn' ? '常见问题' : 'Frequently asked questions'}
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
              {lang === 'cn' ? '现在就开始' : 'Start for free'}
            </h2>
            <p className="text-white/60 text-sm mb-8">
              {lang === 'cn' ? '免费注册，解锁全部数据和分析功能，无需信用卡' : 'Free to register. Full data access. No credit card.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => showLogin()}
                className="inline-flex items-center gap-2 bg-ks-green hover:bg-ks-green-dark text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all shadow-lg shadow-ks-green/25 hover:-translate-y-0.5"
              >
                {lang === 'cn' ? '免费注册' : 'Create Free Account'}
                <ArrowRight className="w-4 h-4" />
              </button>
              <Link
                href="/live-intel"
                className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white px-8 py-3.5 rounded-xl font-semibold text-base transition-all border border-white/10"
              >
                {lang === 'cn' ? '先逛逛数据' : 'Explore Data'}
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
              <Link href="/dashboard" className="hover:text-gray-600 transition-colors">{tr.nav.dashboard}</Link>
              <Link href="/about" className="hover:text-gray-600 transition-colors">{tr.nav.about}</Link>
              <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub</a>
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {(['en', 'cn'] as const).map(l => (
                  <button
                    key={l}
                    onClick={() => setLang(l)}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase transition-all ${lang === l ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
