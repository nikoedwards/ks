'use client';

import { useState, type ReactNode } from 'react';

export default function ImagePreview({
  src,
  alt = '',
  className,
  children,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  children?: ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const imageSrc = src || '';

  return (
    <span
      className={className}
      onMouseEnter={() => imageSrc && setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
    >
      {children ?? (imageSrc ? <img src={imageSrc} alt={alt} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : null)}
      {visible && imageSrc && (
        <span
          className="pointer-events-none fixed z-[80] hidden w-80 overflow-hidden rounded-lg border border-white/80 bg-white shadow-2xl lg:block"
          style={{
            left: Math.min(pos.x + 18, window.innerWidth - 340),
            top: Math.min(pos.y + 18, window.innerHeight - 230),
          }}
        >
          <img src={imageSrc} alt="" className="aspect-video w-full object-cover" referrerPolicy="no-referrer" />
        </span>
      )}
    </span>
  );
}
