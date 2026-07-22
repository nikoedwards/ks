import { ImageResponse } from 'next/og';
import { loadCoreSeoProject } from '@/lib/coreSeo';
import { SITE_NAME, formatUsdCompact, formatInt } from '@/lib/seo';

export const runtime = 'nodejs';
export const alt = 'Kickstarter campaign on Kicksonar';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Row = Record<string, unknown>;

function isIndiegogoId(id: string): boolean {
  return id.startsWith('igg-');
}

export default async function ProjectOgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    id = rawId;
  }
  let row: Row | null = null;
  try {
    row = await loadCoreSeoProject(id);
  } catch {}

  const name = row ? String(row.name ?? '') : 'Project not found';
  const category = row ? [row.category_parent, row.category_name].filter(Boolean).join(' / ') : '';
  const pledged = Number(row?.usd_pledged ?? 0);
  const backers = Number(row?.backers_count ?? 0);
  const platform = isIndiegogoId(id) ? 'Indiegogo' : 'Kickstarter';

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
          <div style={{ fontSize: 22, color: '#9fb3c8', marginLeft: 8 }}>
            {`· ${platform}${category ? ` · ${category}` : ''}`}
          </div>
        </div>

        <div style={{ fontSize: 60, fontWeight: 800, lineHeight: 1.08, maxWidth: 1050, display: 'flex' }}>
          {name.length > 90 ? `${name.slice(0, 90)}…` : name}
        </div>

        <div style={{ display: 'flex', gap: 64 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 52, fontWeight: 800, color: '#05CE78' }}>{formatUsdCompact(pledged)}</div>
            <div style={{ fontSize: 24, color: '#9fb3c8' }}>raised</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 52, fontWeight: 800 }}>{formatInt(backers)}</div>
            <div style={{ fontSize: 24, color: '#9fb3c8' }}>backers</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
