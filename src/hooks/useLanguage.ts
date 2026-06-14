'use client';

import { useState, useEffect } from 'react';
import { LANGUAGE_META, normalizeLang, type Lang } from '@/lib/i18n';

const KEY = 'ks_lang';
const EVENT = 'ks_lang_change';

function getLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  const lang = normalizeLang(localStorage.getItem(KEY));
  localStorage.setItem(KEY, lang);
  return lang;
}

function applyHtmlLang(lang: Lang) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LANGUAGE_META[lang].locale;
}

export function setLang(lang: Lang) {
  const next = normalizeLang(lang);
  localStorage.setItem(KEY, next);
  applyHtmlLang(next);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

export function useLanguage(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const current = getLang();
    setLangState(current);
    applyHtmlLang(current);
    const handler = (e: Event) => {
      const next = normalizeLang((e as CustomEvent<Lang>).detail);
      setLangState(next);
      applyHtmlLang(next);
    };
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);

  return [lang, setLang];
}
