'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { getUnifiedCategoryMapping } from '@/lib/categoryMap';

// Small info affordance shown next to the category selector in Global mode.
// On hover/focus it explains how each unified parent maps to the raw
// Kickstarter and Indiegogo categories underneath.
export default function CategoryMappingTooltip({ cn = false }: { cn?: boolean }) {
  const [open, setOpen] = useState(false);
  const mapping = getUnifiedCategoryMapping();

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={cn ? '类目映射说明' : 'Category mapping help'}
        className="text-gray-400 hover:text-ks-green transition-colors"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-50 w-[min(92vw,560px)] rounded-xl border border-gray-200 bg-white p-4 text-left shadow-xl">
          <p className="mb-1 text-sm font-bold text-gray-900">
            {cn ? '统一类目映射' : 'Unified category mapping'}
          </p>
          <p className="mb-3 text-xs leading-relaxed text-gray-500">
            {cn
              ? '“全局”视图把两个平台的原始类目归并到统一父类后再筛选。单平台视图仍使用各自的原始类目。下面是每个统一父类对应的原始类目:'
              : 'The Global view folds each platform\'s raw categories into a shared parent before filtering. Single-platform views keep their own raw categories. Each unified parent maps to:'}
          </p>
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white text-[11px] font-semibold uppercase text-gray-400">
                <tr>
                  <th className="py-1 pr-2 text-left">{cn ? '统一父类' : 'Unified'}</th>
                  <th className="py-1 pr-2 text-left">Kickstarter</th>
                  <th className="py-1 text-left">Indiegogo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 align-top">
                {mapping.map(row => (
                  <tr key={row.unified}>
                    <td className="py-1.5 pr-2 font-medium text-gray-800">
                      {cn ? `${row.labelZh}` : row.unified}
                    </td>
                    <td className="py-1.5 pr-2 text-gray-500">
                      {row.kickstarter.length ? row.kickstarter.join(', ') : '—'}
                    </td>
                    <td className="py-1.5 text-gray-500">
                      {row.indiegogo.length ? row.indiegogo.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </span>
  );
}
