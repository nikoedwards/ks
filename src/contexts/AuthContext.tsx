'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export interface AuthUser { id: number; username: string; }

interface AuthCtx {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (username: string, password: string, email?: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  showLogin: (onSuccess?: () => void) => void;
  hideLogin: () => void;
  loginVisible: boolean;
  onLoginSuccess: (() => void) | null;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginVisible, setLoginVisible] = useState(false);
  const [onLoginSuccess, setOnLoginSuccess] = useState<(() => void) | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      setUser(d.user ?? null);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.error };
    setUser(d.user);
    return { ok: true };
  }, []);

  const register = useCallback(async (username: string, password: string, email?: string) => {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, email }),
    });
    const d = await r.json();
    if (!r.ok) return { ok: false, error: d.error };
    setUser(d.user);
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
  }, []);

  const showLogin = useCallback((onSuccess?: () => void) => {
    setOnLoginSuccess(onSuccess ? () => onSuccess : null);
    setLoginVisible(true);
  }, []);

  const hideLogin = useCallback(() => {
    setLoginVisible(false);
    setOnLoginSuccess(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, isLoading, login, register, logout, showLogin, hideLogin, loginVisible, onLoginSuccess }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
