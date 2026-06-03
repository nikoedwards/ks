'use client';

import { type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

/**
 * Wraps "detailed" content that guests may preview but not fully read. For
 * logged-in users it renders children untouched. For guests it blurs + disables
 * the children and overlays a centered "sign in to view" card that opens the
 * existing login modal (via showLogin from AuthContext). Purely client-side UX
 * gating — consistent with the app's existing gate()/showLogin pattern; it does
 * not protect the underlying API.
 */
export function LockedSection({
  children,
  title,
  desc,
  minHeight = 240,
}: {
  children: ReactNode;
  title?: string;
  desc?: string;
  minHeight?: number;
}) {
  const { user, isLoading, showLogin } = useAuth();
  const [lang] = useLanguage();
  const authTr = t[lang].auth;

  // While auth state is resolving, render children to avoid a lock flash.
  if (isLoading || user) return <>{children}</>;

  return (
    <div className="relative" style={{ minHeight }}>
      <div className="pointer-events-none select-none blur-[6px] opacity-50" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex items-start justify-center bg-gradient-to-b from-white/30 via-white/70 to-white px-6 pt-12">
        <div className="max-w-sm rounded-2xl border border-gray-100 bg-white/95 px-7 py-8 text-center shadow-lg backdrop-blur">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ks-green/10">
            <Lock className="h-5 w-5 text-ks-green" />
          </div>
          <p className="text-base font-semibold text-gray-900">{title ?? authTr.unlockSection}</p>
          <p className="mt-1.5 text-sm text-gray-500">{desc ?? authTr.unlockHint}</p>
          <button
            onClick={() => showLogin()}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-ks-green px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-ks-green/90"
          >
            {authTr.signIn}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook helper that mirrors the existing `gate()` pattern used on a couple of
 * pages, so all sections can gate interactions consistently: runs `fn`
 * immediately for logged-in users, otherwise opens the login modal and runs
 * `fn` after a successful login.
 */
export function useAuthGate() {
  const { user, showLogin } = useAuth();
  return (fn: () => void) => {
    if (user) { fn(); return; }
    showLogin(fn);
  };
}
