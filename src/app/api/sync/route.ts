import { NextRequest, NextResponse } from 'next/server';
import { getSyncState } from '@/lib/syncState';
import { runSync, getLatestDatasetUrl } from '@/lib/sync';
import { getLastSync } from '@/lib/db';
import { requireAdmin } from '@/lib/apiAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseDatasetDate(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/Kickstarter_(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// Cache the latest-dataset lookup briefly so the admin panel doesn't re-scrape
// webrobots.io on every mount/poll. Monthly dataset → 10 min cache is plenty.
let latestCache: { url: string; at: number } | null = null;
async function cachedLatestUrl(): Promise<string> {
  if (latestCache && Date.now() - latestCache.at < 10 * 60 * 1000) return latestCache.url;
  const url = await getLatestDatasetUrl();
  latestCache = { url, at: Date.now() };
  return url;
}

// GET → webrobots dataset status (current vs latest, whether an import is needed).
export async function GET() {
  try {
    const [latestUrl, lastSync] = await Promise.all([
      cachedLatestUrl(),
      getLastSync() as Promise<{ url?: string; status?: string; completed_at?: string } | null>,
    ]);
    const upToDate = lastSync?.status === 'completed' && lastSync?.url === latestUrl;
    return NextResponse.json({
      latestUrl,
      latestDate: parseDatasetDate(latestUrl),
      syncedUrl: lastSync?.url ?? null,
      syncedDate: parseDatasetDate(lastSync?.url),
      syncedAt: lastSync?.completed_at ?? null,
      upToDate,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const current = getSyncState();
  if (current.status === 'running') {
    return NextResponse.json({ error: 'Sync already running' }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { force?: boolean };

  // Default ("check for update"): only import when a new dataset has been
  // published. Webrobots publishes monthly, so this almost always skips.
  if (!body.force) {
    try {
      const [latestUrl, lastSync] = await Promise.all([
        cachedLatestUrl(),
        getLastSync() as Promise<{ url?: string; status?: string } | null>,
      ]);
      if (lastSync?.status === 'completed' && lastSync?.url === latestUrl) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          message: '已是最新数据集，无需导入',
          latestDate: parseDatasetDate(latestUrl),
        });
      }
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Run sync in the background — do not await.
  runSync().catch(err => console.error('[Kicksonar] Sync error:', err));
  return NextResponse.json({ ok: true, message: body.force ? '强制重新导入已开始' : '检测到新数据集，导入已开始' });
}
