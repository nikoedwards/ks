import { NextRequest, NextResponse } from 'next/server';
import { getTrendingProjects } from '@/lib/db';
import { guardApi } from '@/lib/apiAuth';
import { getIndiegogoTrending } from '@/lib/platformProjects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TrendingHit {
  id: string;
  name: string;
  state: string | null;
  category_parent: string | null;
  usd_pledged: number;
  backers_count: number;
  image_url: string | null;
  image_thumb_url: string | null;
  platform: 'kickstarter' | 'indiegogo';
}

function ksTrending(): TrendingHit[] {
  return getTrendingProjects().map(r => ({
    id: r.id,
    name: r.name,
    state: r.state,
    category_parent: r.category_parent,
    usd_pledged: Number(r.usd_pledged ?? 0),
    backers_count: Number(r.backers_count ?? 0),
    image_url: r.image_url,
    image_thumb_url: r.image_thumb_url,
    platform: 'kickstarter',
  }));
}

function iggTrending(limit: number): TrendingHit[] {
  return getIndiegogoTrending(limit).map(r => ({
    id: r.id,
    name: r.name,
    state: r.state,
    category_parent: r.category_parent,
    usd_pledged: Number(r.usd_pledged ?? 0),
    backers_count: Number(r.backers_count ?? 0),
    image_url: r.image_url,
    image_thumb_url: r.image_thumb_url,
    platform: 'indiegogo',
  }));
}

// Powers the global search bar's default (empty-query) "hot projects" dropdown.
export async function GET(req: NextRequest) {
  try {
    const { limited } = guardApi(req);
    if (limited) return limited;
    const platform = req.nextUrl.searchParams.get('platform');

    if (platform === 'indiegogo') {
      return NextResponse.json({ rows: iggTrending(5) });
    }
    if (platform === 'global') {
      const merged = [...ksTrending(), ...iggTrending(5)]
        .sort((a, b) => b.usd_pledged - a.usd_pledged)
        .slice(0, 5);
      return NextResponse.json({ rows: merged });
    }
    return NextResponse.json({ rows: ksTrending() });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
