'use client';

import { useState, useEffect } from 'react';
import { X, User, Lock, Mail, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

export default function LoginModal() {
  const { loginVisible, hideLogin, login, register, onLoginSuccess } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].auth;

  const [tab, setTab]           = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail]       = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);

  useEffect(() => {
    if (loginVisible) { setTab('login'); setUsername(''); setPassword(''); setEmail(''); setError(''); }
  }, [loginVisible]);

  if (!loginVisible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const result = tab === 'login'
      ? await login(username, password)
      : await register(username, password, email || undefined);
    setBusy(false);
    if (!result.ok) { setError(result.error ?? tr.errorGeneric); return; }
    hideLogin();
    onLoginSuccess?.();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={hideLogin} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-[#022c22] to-[#05CE78]/80 px-6 py-5">
          <div className="flex items-center gap-2.5 mb-1">
            <Sparkles className="w-5 h-5 text-white/80" />
            <span className="font-bold text-white text-lg">Kicksonar</span>
          </div>
          <p className="text-white/70 text-xs">{tr.headerDesc}</p>
          <button onClick={hideLogin} className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          {(['login', 'register'] as const).map(k => (
            <button
              key={k}
              onClick={() => { setTab(k); setError(''); }}
              className={`flex-1 py-3 text-sm font-semibold transition-all ${tab === k ? 'text-ks-green border-b-2 border-ks-green' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {k === 'login' ? tr.signIn : tr.createAccount}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3.5">
          <div className="relative">
            <User className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={tr.usernamePlaceholder}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
              autoComplete="username"
              required
            />
          </div>

          {tab === 'register' && (
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={tr.emailPlaceholder}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
                autoComplete="email"
              />
            </div>
          )}

          <div className="relative">
            <Lock className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={tr.passwordPlaceholder}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              required
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full py-2.5 bg-ks-green hover:bg-ks-green-dark disabled:opacity-60 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {tab === 'login' ? tr.signIn : tr.createAccount}
          </button>

          <p className="text-center text-xs text-gray-400">
            {tab === 'login' ? tr.noAccount : tr.hasAccount}{' '}
            <button type="button" onClick={() => { setTab(tab === 'login' ? 'register' : 'login'); setError(''); }}
              className="text-ks-green font-semibold hover:underline">
              {tab === 'login' ? tr.createAccount : tr.signIn}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
