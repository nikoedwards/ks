'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BarChart2, Search, Sparkles, ArrowRight, User, LogOut, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage, setLang } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import LoginModal from '@/components/LoginModal';

interface PlatformStats {
  total: number;
  success_rate: number;
  total_pledged_usd: number;
}

export default function LandingPage() {
  const { user, logout, showLogin } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].landing;

  const [stats, setStats] = useState<PlatformStats | null>(null);

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(d => {
      if (d.stats) setStats(d.stats);
    }).catch(() => {});
  }, []);

  const fmtNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M+`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K+`;
    return String(n);
  };

  const platformStats = [
    { label: tr.stats.projects,   value: stats ? fmtNum(stats.total)              : '200K+', color: 'text-ks-green' },
    { label: tr.stats.rate,       value: stats ? `${stats.success_rate}%`          : '35%',   color: 'text-white' },
    { label: tr.stats.raised,     value: stats ? `$${stats.total_pledged_usd}M`    : '$2B+',  color: 'text-white' },
    { label: tr.stats.categories, value: '18',                                                color: 'text-white' },
  ];

  const features = [
    { icon: Search,   title: tr.feature1Title, desc: tr.feature1Desc, href: '/projects',  color: '#05CE78' },
    { icon: BarChart2, title: tr.feature2Title, desc: tr.feature2Desc, href: '/analysis', color: '#3B82F6' },
    { icon: Sparkles, title: tr.feature3Title, desc: tr.feature3Desc, href: '/predict',  color: '#8B5CF6' },
  ];

  return (
    <>
      <LoginModal />
      <div className="min-h-screen flex flex-col bg-white">

        {/* ── Nav ─────────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2.5 shrink-0">
              <Image src="/logo.svg" alt="Kicksonar" width={26} height={26} />
              <span className="font-bold text-gray-900 text-base">Kicksonar</span>
            </div>

            {/* Nav links + actions */}
            <div className="flex items-center gap-3">
              {/* Lang switcher */}
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

              <Link href="/dashboard" className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                {tr.nav.dashboard}
              </Link>

              <Link href="/about" className="hidden sm:flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
                {tr.nav.about}
              </Link>

              {/* Auth */}
              {user ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-ks-green/10 px-3 py-1.5 rounded-full">
                    <div className="w-5 h-5 rounded-full bg-ks-green flex items-center justify-center">
                      <span className="text-white text-[10px] font-bold">{user.username[0].toUpperCase()}</span>
                    </div>
                    <span className="text-xs font-semibold text-ks-green-dark">{user.username}</span>
                  </div>
                  <button
                    onClick={logout}
                    className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                    title={t[lang].auth.logout}
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => showLogin()}
                  className="flex items-center gap-1.5 bg-ks-green hover:bg-ks-green-dark text-white px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                  <User className="w-3.5 h-3.5" />
                  {t[lang].auth.signIn}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-gradient-to-br from-[#011a10] via-[#022c1c] to-[#03402a] flex-shrink-0">
          {/* Sonar rings */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none">
            {[1,2,3,4].map(i => (
              <div
                key={i}
                className="absolute rounded-full border border-ks-green/10"
                style={{ width: `${i * 20}%`, height: `${i * 20}%`, opacity: 1 - i * 0.2 }}
              />
            ))}
          </div>

          <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 text-center">
            <div className="inline-flex items-center gap-2 bg-ks-green/15 border border-ks-green/25 rounded-full px-4 py-1.5 mb-8">
              <div className="w-1.5 h-1.5 rounded-full bg-ks-green animate-pulse" />
              <span className="text-ks-green text-xs font-semibold tracking-wide uppercase">Kickstarter Analytics</span>
            </div>

            <h1 className="text-4xl md:text-6xl font-black text-white tracking-tight leading-tight mb-6">
              {tr.tagline}
            </h1>
            <p className="text-lg text-white/60 max-w-2xl mx-auto mb-10 leading-relaxed">
              {tr.subtitle}
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 bg-ks-green hover:bg-ks-green-dark text-white px-8 py-3.5 rounded-xl font-bold text-base transition-all shadow-lg shadow-ks-green/25 hover:shadow-ks-green/40 hover:-translate-y-0.5"
              >
                {tr.cta}
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/about"
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
                <div className={`text-3xl md:text-4xl font-black ${s.color}`}>{s.value}</div>
                <div className="text-white/50 text-xs font-medium mt-1 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="flex-1 bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-6">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3">
                {lang === 'cn' ? '三大核心功能' : 'Everything you need'}
              </h2>
              <p className="text-gray-500 max-w-xl mx-auto text-sm leading-relaxed">
                {lang === 'cn'
                  ? '从数据浏览、深度分析到 AI 预测，Kicksonar 帮你在众筹决策前看清全局。'
                  : 'From data exploration to AI-powered scoring, Kicksonar gives you the edge before you launch.'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {features.map(({ icon: Icon, title, desc, href, color }) => (
                <Link key={href} href={href}
                  className="group bg-white rounded-2xl border border-gray-100 p-6 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all"
                >
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: color + '18' }}>
                    <Icon className="w-5 h-5" style={{ color }} />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-2">{title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed mb-4">{desc}</p>
                  <div className="flex items-center gap-1 text-xs font-semibold" style={{ color }}>
                    {lang === 'cn' ? '前往 →' : 'Explore →'}
                    <ChevronRight className="w-3 h-3" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="bg-white border-t border-gray-100 py-6">
          <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <div className="flex items-center gap-2">
              <Image src="/logo.svg" alt="" width={16} height={16} className="opacity-50" />
              <span>© 2025 Kicksonar · Data: <a href="https://webrobots.io" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600">webrobots.io</a></span>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="hover:text-gray-600 transition-colors">{tr.nav.dashboard}</Link>
              <Link href="/about" className="hover:text-gray-600 transition-colors">{tr.nav.about}</Link>
              <a href="https://github.com/nikoedwards/ks" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">GitHub</a>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
