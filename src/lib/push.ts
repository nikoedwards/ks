import {
  listPushRules,
  getUserCreatedAt,
  hasSeenPush,
  getLiveDeltasForProjects,
  getLiveIntel,
  type PushSegment,
  type PushTemplate,
  type PushGuideStep,
  type PushRule,
} from './db';
import { getFavoriteIds } from './auth';

export interface PushProject {
  id: string;
  name: string;
  image: string | null;
  state: string;
  currency: string;
  pledgedUsd: number;
  fundedPct: number;
  daysLeft: number | null;
  pledgedDelta24h: number;
  backersDelta24h: number;
}

export interface PushSummary {
  live_projects: number;
  pledged_delta_24h: number;
  backers_delta_24h: number;
  launched_24h: number;
  ending_24h: number;
  overfunded_projects: number;
}

export interface PushPayload {
  segment: PushSegment;
  template: PushTemplate;
  generatedAt: number;
  headerNote?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  favorites?: {
    totalPledgedDelta: number;
    totalBackersDelta: number;
    liveCount: number;
    items: PushProject[];
    show: { pledgedDelta: boolean; backersDelta: boolean; fundedPct: boolean; daysLeft: boolean };
  };
  digest?: {
    summary: PushSummary;
    sections: { key: string; title: string; metric: 'pledged' | 'backers' | 'days' | 'none'; items: PushProject[] }[];
  };
  guide?: { intro: string; steps: PushGuideStep[] };
}

type SessionUser = { id: number } | null | undefined;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
}

function mapProject(row: Record<string, unknown>, now: number): PushProject {
  const deadline = num(row.deadline);
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    image: (row.image_thumb_url as string) || (row.image_url as string) || null,
    state: String(row.live_state ?? row.state ?? 'live'),
    currency: String(row.currency ?? 'USD'),
    pledgedUsd: num(row.pledged_usd),
    fundedPct: num(row.funded_pct),
    daysLeft: deadline > now ? Math.ceil((deadline - now) / 86400) : null,
    pledgedDelta24h: num(row.pledged_delta_24h),
    backersDelta24h: num(row.backers_delta_24h),
  };
}

function buildFavorites(rule: PushRule, rows: Record<string, unknown>[]): PushPayload {
  const now = Math.floor(Date.now() / 1000);
  const cfg = rule.config;
  const items = rows.map(r => mapProject(r, now)).slice(0, cfg.maxItems ?? 6);
  const totalPledgedDelta = rows.reduce((s, r) => s + num(r.pledged_delta_24h), 0);
  const totalBackersDelta = rows.reduce((s, r) => s + num(r.backers_delta_24h), 0);
  return {
    segment: 'favorites',
    template: 'favorites_digest',
    generatedAt: now,
    headerNote: cfg.headerNote || undefined,
    ctaLabel: cfg.ctaLabel,
    ctaUrl: cfg.ctaUrl,
    favorites: {
      totalPledgedDelta,
      totalBackersDelta,
      liveCount: rows.length,
      items,
      show: {
        pledgedDelta: cfg.showPledgedDelta !== false,
        backersDelta: cfg.showBackersDelta !== false,
        fundedPct: cfg.showFundedPct !== false,
        daysLeft: cfg.showDaysLeft !== false,
      },
    },
  };
}

function buildDigest(rule: PushRule): PushPayload {
  const cfg = rule.config;
  const limit = Math.max(3, Math.min(cfg.maxMovers ?? 5, 10));
  const intel = getLiveIntel(limit);
  const now = intel.generatedAt;
  const sec: { key: string; title: string; metric: 'pledged' | 'backers' | 'days' | 'none'; items: PushProject[] }[] = [];
  const toItems = (rows: unknown) => (Array.isArray(rows) ? rows : []).map(r => mapProject(r as Record<string, unknown>, now));
  if (cfg.showFastestFunding !== false) sec.push({ key: 'fastestFunding', title: '昨日增长最快', metric: 'pledged', items: toItems(intel.fastestFunding) });
  if (cfg.showFastestBackers !== false) sec.push({ key: 'fastestBackers', title: '支持者增长最快', metric: 'backers', items: toItems(intel.fastestBackers) });
  if (cfg.showNewlyLaunched !== false) sec.push({ key: 'newlyLaunched', title: '新上线项目', metric: 'none', items: toItems(intel.newlyLaunched) });
  if (cfg.showEndingSoon !== false) sec.push({ key: 'endingSoon', title: '即将结束', metric: 'days', items: toItems(intel.endingSoon) });
  return {
    segment: 'digest',
    template: 'platform_digest',
    generatedAt: now,
    headerNote: cfg.headerNote || undefined,
    ctaLabel: cfg.ctaLabel,
    ctaUrl: cfg.ctaUrl,
    digest: {
      summary: intel.summary as unknown as PushSummary,
      sections: sec.filter(s => s.items.length > 0),
    },
  };
}

function buildOnboarding(rule: PushRule): PushPayload {
  const cfg = rule.config;
  return {
    segment: 'new_users',
    template: 'onboarding_guide',
    generatedAt: Math.floor(Date.now() / 1000),
    ctaLabel: cfg.ctaLabel,
    ctaUrl: cfg.ctaUrl,
    guide: {
      intro: cfg.intro ?? '',
      steps: cfg.steps ?? [],
    },
  };
}

/**
 * Decide which auto-generated push (if any) to show a given user right now.
 * Priority: new-user onboarding → favorites digest → platform digest.
 * Each is gated by its rule's enabled flag and frequency (per-user seen state).
 */
export function resolvePushForUser(user: SessionUser): PushPayload | null {
  const rules = listPushRules();
  const bySegment = (s: PushSegment) => rules.find(r => r.segment === s);

  // 1) New-user onboarding guide (logged-in users within the new-user window).
  const newRule = bySegment('new_users');
  if (user && newRule?.enabled) {
    const createdAt = getUserCreatedAt(user.id);
    const windowDays = newRule.config.newUserWindowDays ?? 7;
    const isNew = createdAt != null && (Date.now() / 1000 - createdAt) <= windowDays * 86400;
    if (isNew && (newRule.config.steps?.length || newRule.config.intro) && !hasSeenPush('new_users', user.id, newRule.frequency)) {
      return buildOnboarding(newRule);
    }
  }

  // 2) Favorites digest (logged-in users with at least one LIVE favorite).
  const favRule = bySegment('favorites');
  if (user && favRule?.enabled) {
    const ids = getFavoriteIds(user.id);
    if (ids.length) {
      const rows = getLiveDeltasForProjects(ids);
      if (rows.length && !hasSeenPush('favorites', user.id, favRule.frequency)) {
        return buildFavorites(favRule, rows);
      }
    }
  }

  // 3) Platform digest (everyone, including anonymous visitors).
  const digestRule = bySegment('digest');
  if (digestRule?.enabled) {
    const userId = user?.id ?? null;
    if (!hasSeenPush('digest', userId, digestRule.frequency)) {
      const payload = buildDigest(digestRule);
      if (payload.digest && (payload.digest.sections.length > 0 || num(payload.digest.summary?.live_projects) > 0)) {
        return payload;
      }
    }
  }

  return null;
}
