'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Lock, Mail, Loader2, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

type Step = 'login' | 'register' | 'otp';

export default function LoginModal() {
  const { loginVisible, hideLogin, login, register, verifyOtp, onLoginSuccess } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].auth;

  const [tab, setTab]     = useState<'login' | 'register'>('login');
  const [step, setStep]   = useState<Step>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginVisible) {
      setTab('login');
      setStep('login');
      setEmail('');
      setPassword('');
      setOtp('');
      setError('');
    }
  }, [loginVisible]);

  useEffect(() => {
    if (step === 'otp') otpRef.current?.focus();
  }, [step]);

  if (!loginVisible) return null;

  const switchTab = (k: 'login' | 'register') => {
    setTab(k);
    setStep(k);
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);

    if (step === 'otp') {
      const result = await verifyOtp(email, otp.trim());
      setBusy(false);
      if (!result.ok) { setError(result.error ?? tr.errorGeneric); return; }
      hideLogin();
      onLoginSuccess?.();
      return;
    }

    if (tab === 'login') {
      const result = await login(email, password);
      setBusy(false);
      if (!result.ok) { setError(result.error ?? tr.errorGeneric); return; }
      hideLogin();
      onLoginSuccess?.();
    } else {
      const result = await register(email, password);
      setBusy(false);
      if (!result.ok) { setError(result.error ?? tr.errorGeneric); return; }
      if (result.needsOtp) { setStep('otp'); }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={hideLogin} />

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

        {/* Tabs (hidden during OTP step) */}
        {step !== 'otp' && (
          <div className="flex border-b border-gray-100">
            {(['login', 'register'] as const).map(k => (
              <button key={k} onClick={() => switchTab(k)}
                className={`flex-1 py-3 text-sm font-semibold transition-all ${tab === k ? 'text-ks-green border-b-2 border-ks-green' : 'text-gray-400 hover:text-gray-600'}`}>
                {k === 'login' ? tr.signIn : tr.createAccount}
              </button>
            ))}
          </div>
        )}

        {/* OTP step */}
        {step === 'otp' ? (
          <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 bg-ks-green-light rounded-full flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6 text-ks-green" />
              </div>
              <h3 className="font-bold text-gray-900">{lang === 'cn' ? '验证你的邮箱' : 'Verify your email'}</h3>
              <p className="text-xs text-gray-500">
                {lang === 'cn' ? `验证码已发送到 ${email}` : `We sent a 6-digit code to ${email}`}
              </p>
            </div>

            <div className="relative">
              <input
                ref={otpRef}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={lang === 'cn' ? '输入 6 位验证码' : 'Enter 6-digit code'}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg text-center text-2xl font-mono tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-ks-green"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={busy || otp.length < 6}
              className="w-full py-2.5 bg-ks-green hover:bg-ks-green-dark disabled:opacity-60 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {lang === 'cn' ? '验证并登录' : 'Verify & Sign In'}
            </button>

            <button type="button" onClick={() => { setStep('register'); setOtp(''); setError(''); }}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600">
              {lang === 'cn' ? '← 返回修改邮箱' : '← Back'}
            </button>
          </form>
        ) : (
          /* Login / Register form */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-3.5">
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={tr.emailPlaceholder}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
                autoComplete="email"
                required
              />
            </div>

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

            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <button type="submit" disabled={busy}
              className="w-full py-2.5 bg-ks-green hover:bg-ks-green-dark disabled:opacity-60 text-white rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {tab === 'login' ? tr.signIn : tr.createAccount}
            </button>

            {tab === 'register' && (
              <p className="text-center text-[11px] text-gray-400">
                {lang === 'cn' ? '注册后我们会发送验证码到你的邮箱' : 'We\'ll send a verification code to your email'}
              </p>
            )}

            <p className="text-center text-xs text-gray-400">
              {tab === 'login' ? tr.noAccount : tr.hasAccount}{' '}
              <button type="button" onClick={() => switchTab(tab === 'login' ? 'register' : 'login')}
                className="text-ks-green font-semibold hover:underline">
                {tab === 'login' ? tr.createAccount : tr.signIn}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
