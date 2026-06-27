'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Plug, Terminal, Copy, Check, ArrowRight, ShieldCheck, Gauge } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { isZhLang } from '@/lib/i18n';

const CONTENT = {
  en: {
    badge: 'API / MCP Access',
    title: 'Connect the data to your own LLM',
    intro: 'Generate a personal API key and plug the entire crowdfunding dataset into your own model—Claude, Cursor, ChatGPT, or any MCP-capable client. Then just ask, in plain language, and your model pulls and analyzes the data for you.',
    whatTitle: 'What is this?',
    whatBody: 'Traditional web pages are centralized: you see what the page shows you. This gives you the raw data instead, under your account, so your own model can do flexible, personalized analysis. Three pieces work together:',
    pieces: [
      { icon: 'key', label: 'API Key', desc: 'Your credential. A browser logs in with a cookie; a program proves it is you with an "ks_…" key. Both MCP and CLI sit on top of it.' },
      { icon: 'plug', label: 'MCP', desc: 'A "data socket" for AI clients (Cursor / Claude). Paste one config and your own model can call our data as tools—this is the part you actually want.' },
      { icon: 'term', label: 'CLI', desc: 'A terminal command a human types to query or export data. Same API underneath; handy for scripts. (Not shipped yet.)' },
    ],
    howTitle: 'How to use it (3 steps)',
    steps: [
      { t: 'Generate a key', d: 'Open Settings → API / MCP Access and click Generate. Copy the "ks_…" key—it is shown only once.' },
      { t: 'Add the MCP config', d: 'Paste the snippet below into your Cursor / Claude MCP settings and replace KS_API_KEY with your key.' },
      { t: 'Ask your model', d: 'In natural language, e.g. "Analyze the success rate of tech campaigns over the last 30 days." Your model calls the tools and reasons over the results.' },
    ],
    clientsNote: 'Cursor: Settings → MCP (or edit ~/.cursor/mcp.json). Claude Desktop: edit claude_desktop_config.json and restart.',
    toolsTitle: 'Available tools (read-only)',
    tools: [
      { name: 'search_projects', desc: 'Search / filter campaigns by platform, category, country, state, text, sort, pagination (≤100 rows/call).' },
      { name: 'get_project', desc: 'Full detail for one project id, plus similar projects.' },
      { name: 'get_trends', desc: 'Monthly trend series: launches, success rate, pledged.' },
      { name: 'get_leaderboard', desc: 'Top projects / creators / agencies with summary totals.' },
      { name: 'get_stats', desc: 'Aggregate totals, success rate, state distribution, live summary.' },
    ],
    notesTitle: 'Quotas & security',
    notes: [
      { icon: 'gauge', t: 'Limits', d: 'Per-user rate limits identical to the website, plus a per-key daily request cap (resets 00:00 UTC) so no single key can bulk-export the dataset.' },
      { icon: 'shield', t: 'Security', d: 'Only the hash of a key is stored; plaintext is shown once. Revoke any key anytime. Read-only data endpoints only—no sync/admin/write access.' },
    ],
    ctaTitleIn: 'Ready to go',
    ctaBtnIn: 'Generate an API key',
    ctaTitleOut: 'Sign in to get started',
    ctaBtnOut: 'Sign in',
    ctaHint: 'Keys are managed on the Settings page.',
    copy: 'Copy',
    snippetNote: 'Replace KS_API_KEY with the key from your Settings page.',
  },
  cn: {
    badge: 'API / MCP 接入',
    title: '把数据接入你自己的大模型',
    intro: '生成一个个人 API Key，把全站众筹数据接入你自己的模型——Claude、Cursor、ChatGPT 或任意支持 MCP 的客户端。之后你只用大白话提问，模型就会自己取数、自己分析。',
    whatTitle: '它是干啥的？',
    whatBody: '传统网页是中心化的：页面给你看什么，你就只能看什么。这个能力把原始数据直接交到你账号名下，让你自己的模型做灵活、个性化的分析。三个东西配合工作：',
    pieces: [
      { icon: 'key', label: 'API Key', desc: '你的身份凭证。浏览器靠 cookie 登录；程序则靠一串「ks_…」证明「我是你」。MCP 和 CLI 都建在它之上。' },
      { icon: 'plug', label: 'MCP', desc: '给 AI 客户端（Cursor / Claude）用的「数据插座」。贴一段配置，你自己的模型就能把我们的数据当工具来调用——这才是你真正想要的那块。' },
      { icon: 'term', label: 'CLI', desc: '给人在终端里敲命令查数 / 导出用。底层同一套 API，适合写脚本。（暂未提供）' },
    ],
    howTitle: '怎么用（三步）',
    steps: [
      { t: '生成 Key', d: '打开「设置 → API / MCP 接入」，点「生成」。复制那串「ks_…」——它只显示这一次。' },
      { t: '填入 MCP 配置', d: '把下面的配置贴进 Cursor / Claude 的 MCP 设置，并把 KS_API_KEY 换成你的 Key。' },
      { t: '让你的模型干活', d: '直接用大白话提问，例如「帮我分析过去 30 天科技类众筹的成功率趋势」。模型会自动调用工具并基于结果推理。' },
    ],
    clientsNote: 'Cursor：设置 → MCP（或编辑 ~/.cursor/mcp.json）。Claude Desktop：编辑 claude_desktop_config.json 后重启。',
    toolsTitle: '可用工具（只读）',
    tools: [
      { name: 'search_projects', desc: '按平台 / 分类 / 国家 / 状态 / 关键词搜索筛选，支持排序与分页（每次 ≤100 条）。' },
      { name: 'get_project', desc: '单个项目的完整详情，附带相似项目。' },
      { name: 'get_trends', desc: '按月趋势序列：发起数、成功率、募集额。' },
      { name: 'get_leaderboard', desc: '项目 / 创作者 / 代运营排行榜，含汇总数据。' },
      { name: 'get_stats', desc: '整体汇总：总量、成功率、状态分布、实时概览。' },
    ],
    notesTitle: '配额与安全',
    notes: [
      { icon: 'gauge', t: '额度', d: '与网站一致的按用户限流，外加每个 Key 的每日调用上限（每天 00:00 UTC 重置），防止单个 Key 把整库拖走。' },
      { icon: 'shield', t: '安全', d: 'Key 仅存哈希，明文只显示一次，可随时吊销。仅开放只读数据接口——不涉及任何同步 / 管理 / 写操作。' },
    ],
    ctaTitleIn: '可以开始了',
    ctaBtnIn: '生成 API Key',
    ctaTitleOut: '登录后即可开始',
    ctaBtnOut: '登录',
    ctaHint: 'Key 在「设置」页统一管理。',
    copy: '复制',
    snippetNote: '把 KS_API_KEY 换成你在「设置」页生成的 Key。',
  },
} as const;

const pieceIcon = { key: KeyRound, plug: Plug, term: Terminal } as const;
const noteIcon = { gauge: Gauge, shield: ShieldCheck } as const;

export default function McpDocsClient() {
  const [lang] = useLanguage();
  const { user, showLogin } = useAuth();
  const c = CONTENT[isZhLang(lang) ? 'cn' : 'en'];

  const [origin, setOrigin] = useState('https://your-domain');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const snippet = useMemo(() => JSON.stringify({
    mcpServers: {
      kicksonar: {
        command: 'npx',
        args: ['-y', 'ks-mcp'],
        env: { KS_API_KEY: 'ks_your_key_here', KS_BASE_URL: origin },
      },
    },
  }, null, 2), [origin]);

  const copySnippet = () => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Hero */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ks-green-light text-ks-green-dark text-xs font-semibold">
          <Plug className="w-3.5 h-3.5" />
          {c.badge}
        </span>
        <h1 className="text-3xl font-black text-gray-900 mt-4">{c.title}</h1>
        <p className="text-gray-600 leading-relaxed mt-3">{c.intro}</p>
      </div>

      {/* What is this */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-2">{c.whatTitle}</h2>
        <p className="text-sm text-gray-600 leading-relaxed mb-4">{c.whatBody}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {c.pieces.map(p => {
            const Icon = pieceIcon[p.icon as keyof typeof pieceIcon];
            return (
              <div key={p.label} className="rounded-lg bg-gray-50 p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 text-ks-green shrink-0" />
                  <span className="text-sm font-semibold text-gray-800">{p.label}</span>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{p.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* How to use */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">{c.howTitle}</h2>
        <ol className="space-y-4">
          {c.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-ks-green text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
              <div>
                <div className="text-sm font-semibold text-gray-800">{s.t}</div>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="relative mt-4">
          <pre className="bg-[#1a1a1a] text-gray-100 rounded-lg p-4 text-xs overflow-x-auto"><code>{snippet}</code></pre>
          <button
            onClick={copySnippet}
            className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-semibold"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {c.copy}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">{c.snippetNote}</p>
        <p className="text-[11px] text-gray-400 mt-1">{c.clientsNote}</p>
      </div>

      {/* Tools */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">{c.toolsTitle}</h2>
        <div className="space-y-2">
          {c.tools.map(t => (
            <div key={t.name} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 p-3 rounded-lg bg-gray-50">
              <code className="shrink-0 text-xs font-mono font-semibold text-ks-green-dark">{t.name}</code>
              <span className="text-xs text-gray-500 leading-relaxed">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
        <h2 className="font-bold text-gray-800 mb-4">{c.notesTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {c.notes.map(n => {
            const Icon = noteIcon[n.icon as keyof typeof noteIcon];
            return (
              <div key={n.t} className="flex items-start gap-3 p-3 rounded-lg bg-gray-50">
                <Icon className="w-4 h-4 text-ks-green mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-gray-800">{n.t}</div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{n.d}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <div className="bg-gray-900 rounded-xl p-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-bold text-white text-lg">{user ? c.ctaTitleIn : c.ctaTitleOut}</h2>
          <p className="text-gray-400 text-sm mt-1">{c.ctaHint}</p>
        </div>
        {user ? (
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ks-green hover:bg-ks-green-dark text-white rounded-lg font-semibold text-sm transition-colors shrink-0"
          >
            <KeyRound className="w-4 h-4" />
            {c.ctaBtnIn}
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <button
            onClick={() => showLogin()}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-ks-green hover:bg-ks-green-dark text-white rounded-lg font-semibold text-sm transition-colors shrink-0"
          >
            {c.ctaBtnOut}
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
