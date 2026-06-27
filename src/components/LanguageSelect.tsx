'use client';

import { ChevronDown, Languages } from 'lucide-react';
import { LANGS, LANGUAGE_META, uiCopy, type Lang } from '@/lib/i18n';
import { useLanguage } from '@/hooks/useLanguage';

export default function LanguageSelect({
  variant = 'light',
  className = '',
}: {
  variant?: 'dark' | 'light';
  className?: string;
}) {
  const [lang, setLang] = useLanguage();
  const copy = uiCopy[lang].common;
  const dark = variant === 'dark';

  return (
    <label className={`block ${className}`}>
      <span className="sr-only">{copy.language}</span>
      <div
        className={`relative flex items-center gap-2 rounded-lg border transition-colors ${
          dark
            ? 'border-white/10 bg-white/[0.03] text-white/70 focus-within:border-ks-green/70 focus-within:bg-white/[0.06]'
            : 'border-gray-200 bg-gray-50 text-gray-600 focus-within:border-ks-green focus-within:bg-white focus-within:ring-2 focus-within:ring-ks-green/20'
        }`}
      >
        <Languages className={`ml-2.5 h-3.5 w-3.5 shrink-0 ${dark ? 'text-white/35' : 'text-gray-400'}`} />
        <select
          value={lang}
          onChange={e => setLang(e.target.value as Lang)}
          className={`min-w-0 flex-1 appearance-none bg-transparent py-2 pl-0 pr-8 text-xs font-semibold outline-none ${
            dark ? 'text-white/75' : 'text-gray-700'
          }`}
          aria-label={copy.language}
        >
          {LANGS.map(code => (
            <option key={code} value={code} className="bg-white text-gray-900">
              {LANGUAGE_META[code].label} · {LANGUAGE_META[code].shortLabel}
            </option>
          ))}
        </select>
        <ChevronDown className={`pointer-events-none absolute right-2.5 h-3.5 w-3.5 ${dark ? 'text-white/30' : 'text-gray-400'}`} />
      </div>
    </label>
  );
}
