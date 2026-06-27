'use client';

export type PlatformView = 'global' | 'kickstarter' | 'indiegogo';

const OPTIONS: { id: PlatformView; en: string; cn: string }[] = [
  { id: 'global', en: 'Global', cn: '全局' },
  { id: 'kickstarter', en: 'Kickstarter', cn: 'Kickstarter' },
  { id: 'indiegogo', en: 'Indiegogo', cn: 'Indiegogo' },
];

const DOT: Record<PlatformView, string> = {
  global: 'bg-gradient-to-r from-ks-green to-blue-500',
  kickstarter: 'bg-ks-green',
  indiegogo: 'bg-pink-500',
};

export default function PlatformPicker({
  value,
  onChange,
  cn = false,
}: {
  value: PlatformView;
  onChange: (next: PlatformView) => void;
  cn?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5">
      {OPTIONS.map(opt => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOT[opt.id]}`} />
            {cn ? opt.cn : opt.en}
          </button>
        );
      })}
    </div>
  );
}
