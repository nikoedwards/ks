import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/seo';

export const runtime = 'nodejs';
export const alt = 'Kicksonar — Kickstarter Analytics Platform';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Default social card used for every page that does not provide its own
// opengraph-image. A real PNG (not the SVG logo) so Facebook / X / LinkedIn /
// Slack render a preview image.
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0b1120 0%, #0f291f 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#05CE78',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 34,
              fontWeight: 800,
              color: '#0b1120',
            }}
          >
            K
          </div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{SITE_NAME}</div>
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, marginTop: 40, maxWidth: 980 }}>
          Track What Funds. Launch What Works.
        </div>
        <div style={{ fontSize: 30, color: '#9fb3c8', marginTop: 28, maxWidth: 940 }}>
          Explore 200,000+ Kickstarter campaigns — benchmark categories, track live
          projects, and spot launch opportunities.
        </div>
      </div>
    ),
    size,
  );
}
