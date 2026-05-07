'use client';

import { useState, useEffect } from 'react';
import type { Lang } from '@/lib/i18n';

const KEY = 'ks_lang';
const EVENT = 'ks_lang_change';

function getLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  return (localStorage.getItem(KEY) as Lang) ?? 'en';
}

export function setLang(lang: Lang) {
  localStorage.setItem(KEY, lang);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }));
}

export function useLanguage(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    setLangState(getLang());
    const handler = (e: Event) => setLangState((e as CustomEvent<Lang>).detail);
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return [lang, setLang];
}
