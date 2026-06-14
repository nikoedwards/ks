'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { uiCopy } from '@/lib/i18n';

interface Announcement {
  id: number;
  title: string;
  body: string;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
}

export default function UpdateAnnouncementModal() {
  const [lang] = useLanguage();
  const copy = uiCopy[lang].announcements;
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const openedAt = useRef(0);

  useEffect(() => {
    fetch('/api/announcements', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (d.announcement) {
          setAnnouncement(d.announcement);
          openedAt.current = Date.now();
          fetch('/api/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ announcementId: d.announcement.id, eventType: 'view' }),
          }).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const close = () => {
    if (!announcement) return;
    fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        announcementId: announcement.id,
        eventType: 'dismiss',
        durationMs: Date.now() - openedAt.current,
      }),
    }).catch(() => {});
    setAnnouncement(null);
  };

  const clickCta = () => {
    if (!announcement) return;
    fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        announcementId: announcement.id,
        eventType: 'click',
        durationMs: Date.now() - openedAt.current,
      }),
    }).catch(() => {});
  };

  if (!announcement) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
        {announcement.image_url ? (
          <img src={announcement.image_url} alt="" className="aspect-[16/7] w-full object-cover" />
        ) : (
          <div className="bg-gradient-to-br from-ks-green to-emerald-500 px-6 py-7 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
              <Sparkles className="h-4 w-4" />
              {copy.recentUpdates}
            </div>
            <p className="mt-3 text-2xl font-black leading-tight">{announcement.title}</p>
          </div>
        )}
        <div className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              {announcement.image_url && (
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ks-green">
                  <Sparkles className="h-4 w-4" />
                  {copy.featureUpdate}
                </div>
              )}
              {announcement.image_url && <h2 className="text-xl font-black text-gray-900">{announcement.title}</h2>}
              <p className="mt-2 whitespace-pre-line text-sm leading-6 text-gray-600">{announcement.body}</p>
            </div>
            <button onClick={close} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button onClick={close} className="text-sm font-semibold text-gray-400 hover:text-gray-700">
              {copy.maybeLater}
            </button>
            {announcement.cta_url && (
              <a
                href={announcement.cta_url}
                onClick={clickCta}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-gray-800"
              >
                {announcement.cta_label || copy.explore}
                <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
