// Server-side API guards: current-user resolution + an in-memory rate limiter.
//
// The client-side AuthGate only shapes the UI; these helpers add the actual
// server enforcement — (1) so logged-out visitors cannot pull deeper/bulk data
// by hitting the JSON APIs directly, and (2) a simple anti-scrape rate limit so
// even authenticated users can't hammer the data endpoints.
//
// Rate-limit state is per-instance in memory (no per-request DB writes — keeps
// the hot path fast and avoids extra load on the shared SQLite volume). With
// multiple replicas a single scraper is still effectively throttled; thresholds
// are env-tunable.

import { NextRequest, NextResponse } from 'next/server';
import {
  getSessionUser,
  getUserByApiKey,
  getApiKeyId,
  getApiKeyUsageToday,
  bumpApiKeyUsage,
  SESSION_COOKIE,
  type AuthUser,
} from './auth';
import { recordAnalyticsEvent } from './db';

/** Extract a raw `ks_…` token from an `Authorization: Bearer` header, if present. */
function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (header && header.startsWith('Bearer ')) {
    const raw = header.slice(7).trim();
    return raw || null;
  }
  return null;
}

export function getRequestUser(req: NextRequest): AuthUser | null {
  // Programmatic clients (MCP server, scripts) authenticate with a personal API
  // key; browsers fall back to the session cookie.
  const raw = bearerToken(req);
  if (raw) return getUserByApiKey(raw);
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? '';
  return getSessionUser(token);
}

export function requireAdmin(req: NextRequest): AuthUser | null {
  const user = getRequestUser(req);
  return user?.role === 'admin' ? user : null;
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

const LIMITS = {
  userPerMin: Number(process.env.RATE_USER_PER_MIN ?? 180),
  userPerHour: Number(process.env.RATE_USER_PER_HOUR ?? 4000),
  guestPerMin: Number(process.env.RATE_GUEST_PER_MIN ?? 60),
  guestPerHour: Number(process.env.RATE_GUEST_PER_HOUR ?? 700),
};

// Per-API-key daily request cap. Each request returns at most ~100 rows, so this
// bounds how much of the dataset a single key can pull per day via the MCP
// server / scripts, on top of the per-minute/hour rate limits above.
const API_KEY_DAILY_CAP = Number(process.env.API_KEY_DAILY_CAP ?? 2000);

// key -> ascending list of request timestamps (ms), trimmed to the last hour.
const hits = new Map<string, number[]>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < MINUTE_MS) return;
  lastSweep = now;
  for (const [k, arr] of hits) {
    const recent = arr.filter((t) => now - t < HOUR_MS);
    if (recent.length) hits.set(k, recent);
    else hits.delete(k);
  }
}

interface RateDecision { ok: boolean; retryAfter: number }

function consume(key: string, perMin: number, perHour: number): RateDecision {
  const now = Date.now();
  sweep(now);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < HOUR_MS);
  const inLastMin = recent.reduce((n, t) => (now - t < MINUTE_MS ? n + 1 : n), 0);
  if (inLastMin >= perMin) { hits.set(key, recent); return { ok: false, retryAfter: 60 }; }
  if (recent.length >= perHour) { hits.set(key, recent); return { ok: false, retryAfter: 900 }; }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfter: 0 };
}

export interface ApiGuard {
  user: AuthUser | null;
  isGuest: boolean;
  /** Non-null when the request should be rejected (429). Return it immediately. */
  limited: NextResponse | null;
}

/**
 * Resolve the user and apply the rate limit in one pass (single session
 * lookup). `bucket` lets you scope a tighter budget to expensive endpoints
 * (e.g. 'predict'). Routes do:
 *   const { user, isGuest, limited } = guardApi(req);
 *   if (limited) return limited;
 *   // ...clamp data when isGuest
 */
export function guardApi(
  req: NextRequest,
  opts: { bucket?: string; perMin?: number; perHour?: number } = {},
): ApiGuard {
  const user = getRequestUser(req);
  const ip = getClientIp(req);
  const identity = user ? `u:${user.id}` : `ip:${ip}`;
  const key = opts.bucket ? `${opts.bucket}:${identity}` : identity;
  const perMin = opts.perMin ?? (user ? LIMITS.userPerMin : LIMITS.guestPerMin);
  const perHour = opts.perHour ?? (user ? LIMITS.userPerHour : LIMITS.guestPerHour);

  const decision = consume(key, perMin, perHour);
  if (!decision.ok) {
    recordAnalyticsEvent({
      event_type: 'rate_limited',
      path: req.nextUrl.pathname,
      user_id: user?.id ?? null,
      ip,
      metadata: { bucket: opts.bucket ?? null },
    });
    const res = NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      { status: 429 },
    );
    res.headers.set('Retry-After', String(decision.retryAfter));
    return { user, isGuest: !user, limited: res };
  }

  // Per-key daily quota: only applies to requests authenticated with an API key.
  const raw = bearerToken(req);
  if (user && raw) {
    const keyId = getApiKeyId(raw);
    if (keyId) {
      if (getApiKeyUsageToday(keyId) >= API_KEY_DAILY_CAP) {
        recordAnalyticsEvent({
          event_type: 'api_key_quota_exceeded',
          path: req.nextUrl.pathname,
          user_id: user.id,
          ip,
          metadata: { keyId },
        });
        const res = NextResponse.json(
          { error: 'Daily API key quota exceeded. Try again tomorrow (UTC).' },
          { status: 429 },
        );
        res.headers.set('Retry-After', '3600');
        return { user, isGuest: false, limited: res };
      }
      bumpApiKeyUsage(keyId);
    }
  }

  return { user, isGuest: !user, limited: null };
}
