'use client';

import { useEffect, useState } from 'react';

interface Meta {
  earliestDate: string | null;
  latestDate: string | null;
  lastSyncDate: string | null;
}

let cachedMeta: Meta | null = null;

export default function DataSource() {
  const [meta, setMeta] = useState<Meta | null>(cachedMeta);

  useEffect(() => {
    if (cachedMeta) return;
    fetch('/api/meta')
      .then(r => r.json())
      .then((d: Meta) => { cachedMeta = d; setMeta(d); })
      .catch(() => {});
  }, []);

  const range = meta?.earliestDate && meta?.latestDate
    ? `${meta.earliestDate} ~ ${meta.latestDate}`
    : null;
  const synced = meta?.lastSyncDate ? `同步于 ${meta.lastSyncDate}` : null;

  return (
    <p className="text-xs text-gray-400 text-right pt-1">
      数据来源:{' '}
      <a
        href="https://webrobots.io/kickstarter-datasets/"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-gray-600 transition-colors"
      >
        webrobots.io
      </a>
      {range && <span> · {range}</span>}
      {synced && <span> · {synced}</span>}
    </p>
  );
}
