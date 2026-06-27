'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { KeyRound, Copy, Check, Trash2, Plus, Loader2, ShieldAlert, ArrowRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { localeOf, t, uiCopy } from '@/lib/i18n';

interface ApiKeyInfo {
  id: number;
  name: string | null;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export default function SettingsPage() {
  const { user, showLogin } = useAuth();
  const [lang] = useLanguage();
  const authTr = t[lang].auth;
  const zh = lang !== 'en';

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState('https://your-domain');

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const load = () => {
    if (!user) { setLoading(false); return; }
    fetch('/api/keys')
      .then(r => r.json())
      .then(d => { setKeys(d.keys ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(load, [user]);

  const createKey = async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || undefined }),
      });
      const d = await res.json();
      if (res.ok && d.key) {
        setFreshKey(d.key);
        setNewName('');
        load();
      }
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: number) => {
    await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    setKeys(prev => prev.filter(k => k.id !== id));
  };

  const copy = (text: string, tag: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(tag);
      setTimeout(() => setCopied(c => (c === tag ? null : c)), 1500);
    });
  };

  const activeKey = freshKey ?? 'ks_xxxxxxxxxxxxxxxxxxxxxxxx';
  const mcpSnippet = useMemo(() => JSON.stringify({
    mcpServers: {
      kicksonar: {
        command: 'npx',
        args: ['-y', 'ks-mcp'],
        env: { KS_API_KEY: activeKey, KS_BASE_URL: origin },
      },
    },
  }, null, 2), [activeKey, origin]);

  if (!user) return (
    <div className="max-w-7xl mx-auto">
      <div className="mt-12 text-center">
        <KeyRound className="w-12 h-12 text-gray-200 mx-auto mb-4" />
        <p className="text-gray-500 mb-4">{zh ? '请登录后管理 API Key' : 'Sign in to manage API keys'}</p>
        <button
          onClick={() => showLogin()}
          className="px-6 py-2.5 bg-ks-green hover:bg-ks-green-dark text-white rounded-lg font-semibold text-sm transition-colors"
        >
          {authTr.signIn}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-ks-green" />
          {zh ? 'API / MCP 接入' : 'API / MCP Access'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {zh
            ? '生成个人 API Key，把全站数据接入你自己的大模型（Claude / Cursor / ChatGPT）做个性化分析。Key 等同于你的身份凭证，请妥善保管。'
            : 'Generate a personal API key to connect the full dataset to your own LLM (Claude / Cursor / ChatGPT). A key acts as your credential—keep it secret.'}
        </p>
      </div>

      {/* Create */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-800 mb-3">{zh ? '新建 Key' : 'Create a key'}</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={zh ? '名称（可选，如 "Cursor 笔记本"）' : 'Name (optional, e.g. "Cursor laptop")'}
            maxLength={80}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-ks-green/40"
          />
          <button
            onClick={createKey}
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-ks-green hover:bg-ks-green-dark disabled:opacity-60 text-white rounded-lg font-semibold text-sm transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {zh ? '生成' : 'Generate'}
          </button>
        </div>

        {freshKey && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-amber-700 text-xs font-semibold mb-2">
              <ShieldAlert className="w-3.5 h-3.5" />
              {zh ? '请立即复制保存，此明文只显示这一次。' : 'Copy now—this plaintext key is shown only once.'}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-white border border-amber-200 rounded text-xs font-mono break-all text-gray-800">{freshKey}</code>
              <button
                onClick={() => copy(freshKey, 'fresh')}
                className="shrink-0 inline-flex items-center gap-1 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold"
              >
                {copied === 'fresh' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {zh ? '复制' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Existing keys */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-800">{zh ? '我的 Key' : 'Your keys'}</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-24 text-gray-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {uiCopy[lang].common.loading}
          </div>
        ) : keys.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-400">{zh ? '还没有任何 Key。' : 'No keys yet.'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="px-5 py-3">{zh ? '名称' : 'Name'}</th>
                <th className="px-5 py-3">{zh ? '前缀' : 'Prefix'}</th>
                <th className="px-5 py-3">{zh ? '创建时间' : 'Created'}</th>
                <th className="px-5 py-3">{zh ? '最近使用' : 'Last used'}</th>
                <th className="px-5 py-3 text-center">{zh ? '状态' : 'Status'}</th>
                <th className="px-5 py-3 text-center">{zh ? '操作' : 'Action'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {keys.map(k => {
                const revoked = !!k.revoked_at;
                return (
                  <tr key={k.id} className={revoked ? 'opacity-50' : 'hover:bg-gray-50/80'}>
                    <td className="px-5 py-3 text-gray-800">{k.name || <span className="text-gray-400">—</span>}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">{k.prefix}…</td>
                    <td className="px-5 py-3 text-gray-500">{new Date(k.created_at * 1000).toLocaleDateString(localeOf(lang))}</td>
                    <td className="px-5 py-3 text-gray-500">{k.last_used_at ? new Date(k.last_used_at * 1000).toLocaleString(localeOf(lang)) : '—'}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${revoked ? 'bg-gray-100 text-gray-500' : 'bg-ks-green-light text-ks-green-dark'}`}>
                        {revoked ? (zh ? '已吊销' : 'Revoked') : (zh ? '有效' : 'Active')}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      {!revoked && (
                        <button
                          onClick={() => revokeKey(k.id)}
                          className="p-1.5 text-red-400 hover:text-red-600 transition-colors"
                          title={zh ? '吊销' : 'Revoke'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* MCP setup */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="text-sm font-semibold text-gray-800">{zh ? '接入你的大模型（MCP）' : 'Connect your LLM (MCP)'}</h2>
          <Link href="/mcp" className="inline-flex items-center gap-1 text-xs font-semibold text-ks-green hover:underline shrink-0">
            {zh ? '查看完整文档' : 'View full docs'}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          {zh
            ? '把下面的配置粘贴到 Cursor / Claude 的 MCP 配置里，并把 KS_API_KEY 换成你上面生成的 Key，你的模型就能直接分析全站数据。'
            : 'Paste the config below into your Cursor / Claude MCP settings and replace KS_API_KEY with the key you generated above—your model can then analyze the full dataset.'}
        </p>
        <div className="relative">
          <pre className="bg-[#1a1a1a] text-gray-100 rounded-lg p-4 text-xs overflow-x-auto"><code>{mcpSnippet}</code></pre>
          <button
            onClick={() => copy(mcpSnippet, 'mcp')}
            className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded text-xs font-semibold"
          >
            {copied === 'mcp' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {zh ? '复制' : 'Copy'}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-3">
          {zh
            ? '注意：每个 Key 有每日调用上限以防止整库批量导出；超出后次日（UTC）自动恢复。仅开放只读数据接口。'
            : 'Note: each key has a daily call quota to prevent bulk export; it resets the next day (UTC). Read-only data endpoints only.'}
        </p>
      </div>
    </div>
  );
}
