import { ImageResponse } from 'next/og';
import { loadCoreCountrySeo } from '@/lib/coreSeo';
import { SITE_NAME, formatUsdCompact } from '@/lib/seo';

export const runtime = 'nodejs';
export const alt = 'Kickstarter crowdfunding statistics by country on Kicksonar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function CountryOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let data = null;
  try {
    data = await loadCoreCountrySeo(slug);
  } catch {}
  const name = data?.name ?? 'Kickstarter';
  const stats = data?.stats ?? null;
  const totalRaised = stats ? formatUsdCompact(stats.total_pledged_m * 1_000_000) : null;
  const successRate = stats ? `${stats.success_rate}%` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #0b1120 0%, #0f291f 100%)',
          color: '#ffffff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#05CE78',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 800,
              color: '#0b1120',
            }}
          >
            K
          </div>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 22, color: '#9fb3c8', marginLeft: 8 }}>· Country statistics</div>
        </div>

        <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.08, maxWidth: 1050, display: 'flex' }}>
          Kickstarter in {name}
        </div>

        <div style={{ display: 'flex', gap: 64 }}>
          {successRate && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 52, fontWeight: 800, color: '#05CE78' }}>{successRate}</div>
              <div style={{ fontSize: 24, color: '#9fb3c8' }}>success rate</div>
            </div>
          )}
          {totalRaised && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 52, fontWeight: 800 }}>{totalRaised}</div>
              <div style={{ fontSize: 24, color: '#9fb3c8' }}>total raised</div>
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
