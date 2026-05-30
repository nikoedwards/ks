import BetterSqlite3 from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'kickstarter.db');

declare global {
  // eslint-disable-next-line no-var
  var __ksDb: Database | undefined;
}

const dataWorkbenchCache = new Map<string, { expiresAt: number; value: any }>();

/**
 * Stale-while-revalidate cache for expensive read-only analytics queries.
 *
 * Why: the leaderboard / live-intel / stats queries replay heavy CTEs that
 * aggregate the full project_snapshots table (and scan ~213K projects) on every
 * request, so each page load blocked for several seconds. The underlying data
 * only changes every ~15 min (tracker cycle), so we can safely serve a cached
 * result and refresh it in the background:
 *   - fresh (age <= freshMs)  → return cached value instantly
 *   - stale (age >  freshMs)  → return the stale value instantly AND kick off a
 *                                background recompute (so the NEXT caller is fresh)
 *   - cold (no value yet)     → compute synchronously (only the very first hit)
 *
 * Accuracy is preserved: worst-case staleness is ~freshMs, far below the data's
 * real refresh interval. Call invalidateAnalyticsCaches() after a sync writes
 * new data to drop staleness to zero immediately.
 */
interface SwrEntry { value: unknown; computedAt: number; refreshing: boolean; }
const swrStore = new Map<string, SwrEntry>();
const SWR_MAX_ENTRIES = 300;

function swrCached<T>(key: string, freshMs: number, compute: () => T): T {
  const now = Date.now();
  const entry = swrStore.get(key);
  if (entry) {
    const age = now - entry.computedAt;
    if (age <= freshMs) return entry.value as T;
    if (!entry.refreshing) {
      entry.refreshing = true;
      // Defer so the current response flushes before the (blocking) recompute.
      setTimeout(() => {
        try {
          const v = compute();
          entry.value = v;
          entry.computedAt = Date.now();
        } catch {
          // Keep serving the previous value on transient failures.
        } finally {
          entry.refreshing = false;
        }
      }, 0);
    }
    return entry.value as T;
  }
  const value = compute();
  swrStore.set(key, { value, computedAt: now, refreshing: false });
  if (swrStore.size > SWR_MAX_ENTRIES) {
    const oldestKey = swrStore.keys().next().value;
    if (oldestKey !== undefined) swrStore.delete(oldestKey);
  }
  return value;
}

/**
 * Mark all cached analytics results stale (call after a sync writes new data).
 * We deliberately keep the old values instead of dropping them, so the next
 * reader still gets an instant response while a background refresh recomputes
 * fresh data — no visitor ever blocks just because a sync finished.
 */
export function invalidateAnalyticsCaches() {
  for (const entry of swrStore.values()) entry.computedAt = 0;
}

/**
 * Warm the hottest, stable-key caches so the first visit after a server boot or
 * a sync is fast too. Runs the cached wrappers, which compute-if-cold and
 * refresh-if-stale, all off the request path. Safe to call repeatedly.
 */
export function prewarmAnalyticsCaches() {
  try { void getProjectCount(); } catch { /* ignore */ }
  try { void getStats(); } catch { /* ignore */ }
  try { void getStateDistribution(); } catch { /* ignore */ }
  try { getLandingData(); } catch { /* ignore */ }
  try { getLiveSummary(); } catch { /* ignore */ }
  try { getLiveIntel(12); } catch { /* ignore */ }
  try { getLeaderboardCategoryOptions(); } catch { /* ignore */ }
  try { getLeaderboard({ limit: 100 }); } catch { /* ignore */ }
}

let futureSnapshotsCleaned = false;

/**
 * One-time-per-process cleanup of snapshots stamped in the future. Older
 * Kicktraq history imports could write campaign days up to the deadline, which
 * poison MAX(captured_at)-based "latest snapshot" metrics. Safe: a snapshot can
 * never legitimately be captured in the future.
 */
function cleanupFutureSnapshots(db: Database) {
  if (futureSnapshotsCleaned) return;
  futureSnapshotsCleaned = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const res = db.prepare('DELETE FROM project_snapshots WHERE captured_at > ?').run(now);
    if (res.changes > 0) {
      console.log(`[db] cleaned up ${res.changes} future-dated snapshot(s)`);
    }
    try { db.prepare('DELETE FROM reward_snapshots WHERE captured_at > ?').run(now); } catch { /* table optional */ }
  } catch { /* table may not exist yet */ }
}

let inflatedGoalsReconciled = false;
let projectStatesReconciled = false;
let regressedPledgedReconciled = false;
let unconvertedPledgedReconciled = false;

// Static currency→USD rate as a SQL CASE, for in-place repair of amounts that were
// stored as raw local currency. Mirrors STATIC_USD_RATES in money.ts.
function fxRateCase(currencyCol: string): string {
  return `CASE upper(COALESCE(${currencyCol}, 'USD'))
    WHEN 'USD' THEN 1 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08 WHEN 'CAD' THEN 0.73
    WHEN 'AUD' THEN 0.65 WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'SGD' THEN 0.74
    WHEN 'SEK' THEN 0.093 WHEN 'NOK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'CHF' THEN 1.10
    WHEN 'NZD' THEN 0.60 WHEN 'MXN' THEN 0.059 WHEN 'PLN' THEN 0.25 ELSE 1 END`;
}

/**
 * One-time-per-process repair of project states. The crawl pipeline only ever
 * stores five canonical lowercase states (live / successful / failed / canceled /
 * suspended), but legacy rows accumulated uppercase duplicates (LIVE, SUCCESSFUL…)
 * and stray pre-launch / placeholder labels (started, submitted, unknown, …).
 * This folds casing + synonyms and infers a real state for the leftovers from the
 * project's own deadline / goal / pledged numbers, so the chart and the live CTE
 * stay clean. Snapshot states are folded too (kicktraq 'historical' is left alone
 * since it is a scoped backfill marker, not a project state).
 */
function reconcileProjectStates(db: Database) {
  if (projectStatesReconciled) return;
  projectStatesReconciled = true;
  try {
    const now = Math.floor(Date.now() / 1000);

    // 1) Fold casing + synonyms on the projects table.
    db.exec(`
      UPDATE projects SET state = lower(state)
        WHERE state IS NOT NULL AND state <> lower(state);
      UPDATE projects SET state = 'successful' WHERE state IN ('success', 'funded');
      UPDATE projects SET state = 'canceled'   WHERE state = 'cancelled';
      UPDATE projects SET state = 'failed'     WHERE state = 'unsuccessful';
    `);

    // 2) Infer a canonical state for everything that is still non-canonical
    //    (started, submitted, unknown, historical, draft, purged, '', NULL …)
    //    from the project's own numbers. goal + usd_pledged are both USD here.
    const reclassified = db.prepare(`
      UPDATE projects
      SET state = CASE
        WHEN deadline IS NOT NULL AND deadline > @now THEN 'live'
        WHEN goal > 0 AND COALESCE(usd_pledged, 0) >= goal THEN 'successful'
        WHEN deadline IS NOT NULL THEN 'failed'
        ELSE 'live'
      END
      WHERE COALESCE(state, '') NOT IN ('live', 'successful', 'failed', 'canceled', 'suspended')
    `).run({ now }).changes;

    // 3) Fold casing + synonyms on snapshots so the live CTE matching 'live' works.
    db.exec(`
      UPDATE project_snapshots SET state = lower(state)
        WHERE state IS NOT NULL AND state <> lower(state);
      UPDATE project_snapshots SET state = 'successful' WHERE state IN ('success', 'funded');
      UPDATE project_snapshots SET state = 'canceled'   WHERE state = 'cancelled';
      UPDATE project_snapshots SET state = 'failed'     WHERE state = 'unsuccessful';
    `);

    // 4) A project past its deadline cannot be 'live' — Kickstarter flips it to
    //    successful/failed at the deadline. Legacy rows kept 'live' (stale feeds,
    //    a tracker that never reached them), producing the "已结束 + 进行中"
    //    contradiction. Settle the interim state from our latest numbers; a
    //    post-deadline scrape later overwrites it with KS's authoritative result.
    const endedFixed = db.prepare(`
      UPDATE projects
      SET state = CASE WHEN goal > 0 AND COALESCE(usd_pledged, 0) >= goal THEN 'successful' ELSE 'failed' END
      WHERE state = 'live' AND deadline IS NOT NULL AND deadline < @now
    `).run({ now }).changes;

    if (reclassified > 0 || endedFixed > 0) {
      invalidateAnalyticsCaches();
      console.log(`[db] reconciled ${reclassified} non-canonical + ${endedFixed} ended-but-live project state(s)`);
    }
  } catch (e) {
    console.error('[db] reconcileProjectStates failed:', e);
  }
}

/**
 * One-time-per-process repair of goals inflated ~100x by the old FX-inference bug
 * (see src/lib/money.ts: goalUsd used to be goalLocal * (pledgedUsd / pledgedLocal),
 * and that ratio could balloon to ~100). Two-pronged:
 *  1) In place (conservative): a USD goal is only divided by 100 when doing so lands
 *     on a clearly round goal — large, with junk low digits (goal % 100 != 0), AND
 *     goal/100 rounds to a multiple of 1000. That uniquely matches round_goal*~100
 *     (e.g. 10,000,021 -> 100,000) while never touching a genuinely non-round goal
 *     such as $3,134,455 (a real $3.1M campaign) or the round $100,000,000 jokes.
 *  2) Re-fetch (authoritative): every still-suspicious tracked project is marked due
 *     so the fixed scraper re-reads Kickstarter's real dollar goal (rate=1 for USD).
 *     This is what actually heals the ambiguous and non-USD cases.
 */
function reconcileInflatedGoals(db: Database) {
  if (inflatedGoalsReconciled) return;
  inflatedGoalsReconciled = true;
  try {
    const corrected = db.prepare(`
      UPDATE projects
      SET goal = ROUND(goal / 100.0)
      WHERE COALESCE(currency, 'USD') = 'USD'
        AND goal >= 200000
        AND CAST(goal AS INTEGER) % 100 <> 0
        AND CAST(ROUND(goal / 100.0) AS INTEGER) % 1000 = 0
    `).run().changes;

    const now = Math.floor(Date.now() / 1000);
    const rescheduled = db.prepare(`
      UPDATE tracking_settings
      SET next_fetch = @now
      WHERE is_tracking = 1
        AND project_id IN (
          SELECT id FROM projects
          WHERE goal >= 200000 AND CAST(goal AS INTEGER) % 100 <> 0
        )
    `).run({ now }).changes;

    if (corrected > 0) {
      invalidateAnalyticsCaches();
      console.log(`[db] corrected ${corrected} inflated USD goal(s); queued ${rescheduled} project(s) for authoritative re-fetch`);
    } else if (rescheduled > 0) {
      console.log(`[db] queued ${rescheduled} project(s) for authoritative goal re-fetch`);
    }
  } catch (e) {
    console.error('[db] reconcileInflatedGoals failed:', e);
  }
}

/**
 * One-time-per-process repair of pledged/backers that were regressed below their
 * true value. Pledged & backers are monotonic, but two write paths could lower the
 * stored project row:
 *  - kicktraq merges historically overwrote usd_pledged with a staler kicktraq number;
 *  - kicktraq_summary reports pledged_usd = 0 for ended campaigns, and that 0 became
 *    the latest snapshot, so the headline MAX(latest_snapshot, project) sat at the
 *    regressed row value (e.g. BB-777: real $6.69M, displayed $6.27M).
 * The authoritative peak survives in an earlier snapshot, so we lift each project row
 * up to the *latest snapshot that actually carried a value* (ignoring the 0 readings),
 * using MAX so a row is never lowered. This makes the project row the correct single
 * source of truth that every surface (detail / list / leaderboard / awards) reads.
 */
function reconcileRegressedPledged(db: Database) {
  if (regressedPledgedReconciled) return;
  regressedPledgedReconciled = true;
  try {
    const pledgedFixed = db.prepare(`
      UPDATE projects
      SET usd_pledged = MAX(
        COALESCE(usd_pledged, 0),
        COALESCE((
          SELECT ps.pledged_usd
          FROM project_snapshots ps
          WHERE ps.project_id = projects.id
            AND COALESCE(ps.pledged_usd, 0) > 0
            AND ps.state NOT IN ('unknown', 'historical')
          ORDER BY ps.id DESC
          LIMIT 1
        ), 0)
      )
      WHERE EXISTS (
        SELECT 1 FROM project_snapshots ps
        WHERE ps.project_id = projects.id
          AND COALESCE(ps.pledged_usd, 0) > COALESCE(projects.usd_pledged, 0)
          AND ps.state NOT IN ('unknown', 'historical')
      )
    `).run().changes;

    const backersFixed = db.prepare(`
      UPDATE projects
      SET backers_count = MAX(
        COALESCE(backers_count, 0),
        COALESCE((
          SELECT ps.backers_count
          FROM project_snapshots ps
          WHERE ps.project_id = projects.id
            AND COALESCE(ps.backers_count, 0) > 0
            AND ps.state NOT IN ('unknown', 'historical')
          ORDER BY ps.id DESC
          LIMIT 1
        ), 0)
      )
      WHERE EXISTS (
        SELECT 1 FROM project_snapshots ps
        WHERE ps.project_id = projects.id
          AND COALESCE(ps.backers_count, 0) > COALESCE(projects.backers_count, 0)
          AND ps.state NOT IN ('unknown', 'historical')
      )
    `).run().changes;

    if (pledgedFixed > 0 || backersFixed > 0) {
      invalidateAnalyticsCaches();
      console.log(`[db] reconciled ${pledgedFixed} regressed pledged + ${backersFixed} regressed backer row(s)`);
    }
  } catch (e) {
    console.error('[db] reconcileRegressedPledged failed:', e);
  }
}

/**
 * One-time-per-process repair of pledged amounts that were stored as raw LOCAL
 * currency instead of USD. The old money.ts fell back to the local amount when a
 * feed row carried no converted/explicit USD pledged, so e.g. a ¥15.6M JPY campaign
 * was saved as $15,630,106 instead of ~$105K (≈149x off). We detect any non-USD row
 * whose usd_pledged is wildly above the expected local*rate (>3x — only the egregious
 * low-rate currencies trip this) and recompute it, fixing both the project row and
 * its snapshots so the read-side MAX(snapshot, project) cannot re-inflate from a
 * stale raw-local snapshot. The go-forward money.ts fix prevents new occurrences.
 */
function reconcileUnconvertedPledged(db: Database) {
  if (unconvertedPledgedReconciled) return;
  unconvertedPledgedReconciled = true;
  try {
    const r = fxRateCase('currency');
    const projFixed = db.prepare(`
      UPDATE projects
      SET usd_pledged = ROUND(pledged * (${r}))
      WHERE upper(COALESCE(currency, 'USD')) <> 'USD'
        AND COALESCE(pledged, 0) > 0
        AND COALESCE(usd_pledged, 0) > pledged * (${r}) * 3
    `).run().changes;

    const rp = fxRateCase('p.currency');
    const snapFixed = db.prepare(`
      UPDATE project_snapshots
      SET pledged_usd = ROUND(pledged_usd * (
        SELECT (${rp}) FROM projects p WHERE p.id = project_snapshots.project_id
      ))
      WHERE EXISTS (
        SELECT 1 FROM projects p
        WHERE p.id = project_snapshots.project_id
          AND upper(COALESCE(p.currency, 'USD')) <> 'USD'
          AND COALESCE(p.pledged, 0) > 0
          AND project_snapshots.pledged_usd > p.pledged * (${rp}) * 3
      )
    `).run().changes;

    if (projFixed > 0 || snapFixed > 0) {
      invalidateAnalyticsCaches();
      console.log(`[db] converted ${projFixed} raw-local project pledged + ${snapFixed} snapshot value(s) to USD`);
    }
  } catch (e) {
    console.error('[db] reconcileUnconvertedPledged failed:', e);
  }
}

function ensureRuntimeMigrations(db: Database) {
  cleanupFutureSnapshots(db);
  reconcileInflatedGoals(db);
  reconcileProjectStates(db);
  reconcileUnconvertedPledged(db);
  reconcileRegressedPledged(db);
  try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN creator_slug TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN creator_url TEXT'); } catch { /* already exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
  try { db.exec("ALTER TABLE projects ADD COLUMN data_source TEXT DEFAULT 'webrobots'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN first_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN last_seen_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN webrobots_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN ks_live_synced_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN image_url TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN image_thumb_url TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN has_service_agency INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE projects ADD COLUMN service_agency_name TEXT'); } catch { /* already exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_id TEXT NOT NULL,
      collaborator_key TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      avatar_url TEXT,
      profile_url TEXT,
      is_service_agency INTEGER DEFAULT 0,
      captured_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, collaborator_key)
    );
    CREATE INDEX IF NOT EXISTS idx_collaborators_project ON project_collaborators(project_id);
  `);
  try { db.exec('ALTER TABLE project_collaborators ADD COLUMN is_service_agency INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try {
    db.exec(`
      UPDATE project_collaborators
      SET is_service_agency = 1
      WHERE lower(COALESCE(name, '') || ' ' || COALESCE(role, '')) LIKE '%longham%'
         OR lower(COALESCE(name, '') || ' ' || COALESCE(role, '')) LIKE '%global oneclick%'
         OR lower(COALESCE(name, '') || ' ' || COALESCE(role, '')) LIKE '%global one click%'
         OR lower(COALESCE(name, '') || ' ' || COALESCE(role, '')) LIKE '%vinyl%';
      UPDATE projects
      SET has_service_agency = 1,
          service_agency_name = (
            SELECT GROUP_CONCAT(DISTINCT pc.name)
            FROM project_collaborators pc
            WHERE pc.project_id = projects.id AND pc.is_service_agency = 1
          )
      WHERE id IN (
        SELECT DISTINCT project_id FROM project_collaborators WHERE is_service_agency = 1
      );
    `);
  } catch { /* best-effort backfill */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN subscriber_count INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN priority_score INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN consecutive_failures INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE tracking_settings ADD COLUMN last_failure_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE crawler_errors ADD COLUMN occurrence_count INTEGER DEFAULT 1'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE crawler_errors ADD COLUMN last_occurred_at INTEGER'); } catch { /* already exists */ }
  try { db.exec('UPDATE crawler_errors SET last_occurred_at = occurred_at WHERE last_occurred_at IS NULL'); } catch { /* nothing to backfill */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawler_state (
      source TEXT NOT NULL,
      job_type TEXT NOT NULL,
      last_status TEXT,
      last_started_at INTEGER,
      last_completed_at INTEGER,
      blocked_streak INTEGER DEFAULT 0,
      next_attempt_at INTEGER,
      message TEXT,
      PRIMARY KEY (source, job_type)
    );
  `);
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_crawler_errors_lookup
      ON crawler_errors(source, job_type, last_occurred_at)
    `);
  } catch { /* table may not exist yet */ }
  ensureAnnouncementTables(db);
  ensureKicktraqDebugTables(db);
  ensureAwardTables(db);
  ensurePerformanceIndexes(db);
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) db.prepare("UPDATE users SET role = 'admin' WHERE lower(email) = ?").run(adminEmail);
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)").run();
}

export type PushSegment = 'favorites' | 'digest' | 'new_users';
export type PushTemplate = 'favorites_digest' | 'platform_digest' | 'onboarding_guide';
export type PushFrequency = 'daily' | 'once' | 'always';

export interface PushGuideStep { icon?: string; title: string; desc: string; href?: string }

export interface PushRuleConfig {
  // shared
  headerNote?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  // favorites_digest
  maxItems?: number;
  showPledgedDelta?: boolean;
  showBackersDelta?: boolean;
  showFundedPct?: boolean;
  showDaysLeft?: boolean;
  // platform_digest
  maxMovers?: number;
  showFastestFunding?: boolean;
  showFastestBackers?: boolean;
  showNewlyLaunched?: boolean;
  showEndingSoon?: boolean;
  // onboarding_guide
  newUserWindowDays?: number;
  intro?: string;
  steps?: PushGuideStep[];
}

export const DEFAULT_PUSH_CONFIG: Record<PushSegment, PushRuleConfig> = {
  favorites: {
    headerNote: '',
    ctaLabel: '查看我的收藏',
    ctaUrl: '/favorites',
    maxItems: 6,
    showPledgedDelta: true,
    showBackersDelta: true,
    showFundedPct: true,
    showDaysLeft: true,
  },
  digest: {
    headerNote: '',
    ctaLabel: '进入实时情报',
    ctaUrl: '/live-intel',
    maxMovers: 5,
    showFastestFunding: true,
    showFastestBackers: true,
    showNewlyLaunched: true,
    showEndingSoon: true,
  },
  new_users: {
    newUserWindowDays: 7,
    intro: '欢迎来到 Kicksonar！这里是你追踪 Kickstarter 众筹动态的雷达。花一分钟了解几个核心功能：',
    ctaLabel: '开始探索',
    ctaUrl: '/live-intel',
    steps: [
      { icon: 'radar', title: '实时情报', desc: '查看全站正在升温、即将结束、超额完成的进行中项目。', href: '/live-intel' },
      { icon: 'heart', title: '收藏项目', desc: '收藏你关注的进行中项目，之后每天自动收到它们的最新变化。', href: '/projects' },
      { icon: 'chart', title: '数字曲线', desc: '进入任意项目详情页，查看筹款与支持者的历史走势。', href: '/projects' },
      { icon: 'trophy', title: '排行榜分享', desc: '一键生成榜单分享图，把值得关注的项目发给团队。', href: '/leaderboard' },
    ],
  },
};

function ensureAnnouncementTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      image_url TEXT,
      cta_label TEXT,
      cta_url TEXT,
      audience TEXT DEFAULT 'all',
      frequency TEXT DEFAULT 'daily',
      active INTEGER DEFAULT 0,
      start_at INTEGER,
      end_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS announcement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      announcement_id INTEGER NOT NULL,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_announcement_events_user ON announcement_events(user_id, announcement_id, event_type, created_at);
  `);
  ensurePushTables(db);
}

/**
 * Auto-generated push system. Instead of admins hand-writing announcements, the
 * server generates a personalized digest per user from live data. Admins only
 * toggle/configure one rule per audience segment.
 */
function ensurePushTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_rules (
      segment TEXT PRIMARY KEY,
      template TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      frequency TEXT DEFAULT 'daily',
      config_json TEXT,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS push_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment TEXT NOT NULL,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      duration_ms INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_push_events_lookup ON push_events(segment, user_id, event_type, created_at);
  `);
  // Seed one rule per segment (idempotent — INSERT OR IGNORE keeps admin edits).
  const seed = db.prepare(`INSERT OR IGNORE INTO push_rules (segment, template, enabled, frequency, config_json) VALUES (@segment, @template, @enabled, @frequency, @config)`);
  seed.run({ segment: 'favorites', template: 'favorites_digest', enabled: 1, frequency: 'daily', config: JSON.stringify(DEFAULT_PUSH_CONFIG.favorites) });
  seed.run({ segment: 'digest', template: 'platform_digest', enabled: 1, frequency: 'daily', config: JSON.stringify(DEFAULT_PUSH_CONFIG.digest) });
  seed.run({ segment: 'new_users', template: 'onboarding_guide', enabled: 1, frequency: 'once', config: JSON.stringify(DEFAULT_PUSH_CONFIG.new_users) });
}

// ─── Kicksonar Awards (editorial, admin-curated annual awards) ───────────────

export interface AwardDef {
  award_key: string;
  name_cn: string;
  name_en: string;
  tagline_cn: string;
  tagline_en: string;
  philosophy_cn: string;
  philosophy_en: string;
  badge_image: string;
  accent: string;
  sort_order: number;
  enabled: number;
}

export const DEFAULT_AWARDS: AwardDef[] = [
  {
    award_key: 'sonar_gold',
    name_cn: '年度声纳金奖',
    name_en: 'Sonar Gold',
    tagline_cn: '年度全场最佳',
    tagline_en: 'Best of the Best',
    philosophy_cn: '在万千众筹信号中最清晰、最响亮的那一个——综合实力的年度标杆。',
    philosophy_en: 'The clearest, loudest signal of the year — our benchmark for all-around excellence.',
    badge_image: '/awards/sonar-gold.png',
    accent: '#d4a017',
    sort_order: 0,
    enabled: 1,
  },
  {
    award_key: 'wavemaker',
    name_cn: '年度浪潮奖',
    name_en: 'Wavemaker',
    tagline_cn: '年度破圈黑马',
    tagline_en: 'Breakout of the Year',
    philosophy_cn: '不只是数字，而是掀起浪潮、破圈引发讨论的现象级项目。',
    philosophy_en: 'Not just numbers — the project that made waves and broke into the mainstream.',
    badge_image: '/awards/wavemaker.png',
    accent: '#0d9488',
    sort_order: 1,
    enabled: 1,
  },
  {
    award_key: 'hidden_gem',
    name_cn: '年度遗珠奖',
    name_en: 'Hidden Gem',
    tagline_cn: '编辑私心推荐',
    tagline_en: "Editor's Pick",
    philosophy_cn: '雷达边缘也有璀璨信号——编辑私心推荐、被低估的宝藏项目。',
    philosophy_en: 'Even at the radar’s edge, brilliance shines — an underrated treasure our editors love.',
    badge_image: '/awards/hidden-gem.png',
    accent: '#7c3aed',
    sort_order: 2,
    enabled: 1,
  },
];

function ensureAwardTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS awards (
      award_key TEXT PRIMARY KEY,
      name_cn TEXT NOT NULL,
      name_en TEXT NOT NULL,
      tagline_cn TEXT,
      tagline_en TEXT,
      philosophy_cn TEXT,
      philosophy_en TEXT,
      badge_image TEXT,
      accent TEXT,
      sort_order INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS award_winners (
      award_key TEXT NOT NULL,
      year INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      citation_cn TEXT,
      citation_en TEXT,
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (award_key, year)
    );
  `);
  const seed = db.prepare(`
    INSERT OR IGNORE INTO awards
      (award_key, name_cn, name_en, tagline_cn, tagline_en, philosophy_cn, philosophy_en, badge_image, accent, sort_order, enabled)
    VALUES
      (@award_key, @name_cn, @name_en, @tagline_cn, @tagline_en, @philosophy_cn, @philosophy_en, @badge_image, @accent, @sort_order, @enabled)
  `);
  for (const a of DEFAULT_AWARDS) seed.run(a as unknown as Record<string, unknown>);
}

export function listAwards(): AwardDef[] {
  return getDB().prepare('SELECT * FROM awards ORDER BY sort_order ASC').all() as AwardDef[];
}

export function getAwardYears(): number[] {
  const rows = getDB().prepare('SELECT DISTINCT year FROM award_winners ORDER BY year DESC').all() as { year: number }[];
  return rows.map(r => Number(r.year));
}

export interface AwardWithWinner extends AwardDef {
  year: number;
  project_id: string | null;
  citation_cn: string | null;
  citation_en: string | null;
  project_name: string | null;
  project_blurb: string | null;
  project_image_url: string | null;
  project_thumb_url: string | null;
  project_category_parent: string | null;
  project_state: string | null;
  project_pledged_usd: number | null;
  project_backers: number | null;
}

// Effective pledged/backers must match the projects list and leaderboard: prefer
// the freshest live snapshot, fall back to the static projects columns. Reading
// p.usd_pledged alone (the old behaviour) showed a stale monthly value while the
// list/leaderboard showed the live number — the exact mismatch users reported.
const LATEST_SNAPSHOT_CTE = `
  latest_snap_effective AS (
    SELECT ps.project_id, ps.pledged_usd, ps.backers_count
    FROM project_snapshots ps
    JOIN (
      SELECT project_id, MAX(id) as id
      FROM project_snapshots
      WHERE state NOT IN ('unknown', 'historical')
        AND NOT (COALESCE(pledged_usd, 0) = 0 AND COALESCE(backers_count, 0) = 0)
      GROUP BY project_id
    ) x ON x.id = ps.id
  )
`;
// Pledged/backers are monotonic, so the highest of (latest snapshot, stored project
// row) is the freshest, most-complete value — and using the SAME MAX() everywhere
// (detail, list, leaderboard, awards, live-intel) guarantees every surface shows an
// identical number. A staler kicktraq snapshot can sit below the authoritative KS
// scrape (and vice-versa); MAX() picks the right one without per-surface drift.
const EFFECTIVE_PLEDGED = `MAX(COALESCE(l.pledged_usd, 0), COALESCE(p.usd_pledged, 0))`;
const EFFECTIVE_BACKERS = `MAX(COALESCE(l.backers_count, 0), COALESCE(p.backers_count, 0))`;

export function getAwardsWithWinners(year: number): AwardWithWinner[] {
  return getDB().prepare(`
    WITH ${LATEST_SNAPSHOT_CTE}
    SELECT
      a.*, @year AS year,
      w.project_id, w.citation_cn, w.citation_en,
      p.name AS project_name, p.blurb AS project_blurb,
      p.image_url AS project_image_url, p.image_thumb_url AS project_thumb_url,
      p.category_parent AS project_category_parent, p.state AS project_state,
      ${EFFECTIVE_PLEDGED} AS project_pledged_usd,
      ${EFFECTIVE_BACKERS} AS project_backers
    FROM awards a
    LEFT JOIN award_winners w ON w.award_key = a.award_key AND w.year = @year
    LEFT JOIN projects p ON p.id = w.project_id
    LEFT JOIN latest_snap_effective l ON l.project_id = w.project_id
    WHERE a.enabled = 1
    ORDER BY a.sort_order ASC
  `).all({ year }) as AwardWithWinner[];
}

export function setAwardWinner(input: { awardKey: string; year: number; projectId: string; citationCn?: string; citationEn?: string }): void {
  getDB().prepare(`
    INSERT INTO award_winners (award_key, year, project_id, citation_cn, citation_en, updated_at)
    VALUES (@awardKey, @year, @projectId, @citationCn, @citationEn, unixepoch())
    ON CONFLICT(award_key, year) DO UPDATE SET
      project_id = excluded.project_id,
      citation_cn = excluded.citation_cn,
      citation_en = excluded.citation_en,
      updated_at = unixepoch()
  `).run({
    awardKey: input.awardKey,
    year: input.year,
    projectId: input.projectId,
    citationCn: input.citationCn ?? null,
    citationEn: input.citationEn ?? null,
  });
}

export function clearAwardWinner(awardKey: string, year: number): void {
  getDB().prepare('DELETE FROM award_winners WHERE award_key = ? AND year = ?').run(awardKey, year);
}

export function searchProjectsForAward(query: string, limit = 12) {
  const q = query.trim();
  if (!q) return [] as Array<Record<string, unknown>>;
  return getDB().prepare(`
    WITH ${LATEST_SNAPSHOT_CTE}
    SELECT p.id, p.name, p.image_thumb_url, p.image_url, p.state, p.category_parent, p.country,
           ${EFFECTIVE_PLEDGED} AS pledged_usd,
           ${EFFECTIVE_BACKERS} AS backers_count
    FROM projects p
    LEFT JOIN latest_snap_effective l ON l.project_id = p.id
    WHERE p.name LIKE @q OR p.id = @exact
    ORDER BY pledged_usd DESC
    LIMIT @limit
  `).all({ q: `%${q}%`, exact: q, limit: Math.min(limit, 25) }) as Array<Record<string, unknown>>;
}

export function updateAward(input: { awardKey: string; enabled?: number; nameCn?: string; nameEn?: string; taglineCn?: string; taglineEn?: string; philosophyCn?: string; philosophyEn?: string }): void {
  const existing = getDB().prepare('SELECT * FROM awards WHERE award_key = ?').get(input.awardKey) as AwardDef | undefined;
  if (!existing) return;
  getDB().prepare(`
    UPDATE awards SET
      enabled = @enabled, name_cn = @nameCn, name_en = @nameEn,
      tagline_cn = @taglineCn, tagline_en = @taglineEn,
      philosophy_cn = @philosophyCn, philosophy_en = @philosophyEn,
      updated_at = unixepoch()
    WHERE award_key = @awardKey
  `).run({
    awardKey: input.awardKey,
    enabled: input.enabled == null ? existing.enabled : (input.enabled ? 1 : 0),
    nameCn: input.nameCn ?? existing.name_cn,
    nameEn: input.nameEn ?? existing.name_en,
    taglineCn: input.taglineCn ?? existing.tagline_cn,
    taglineEn: input.taglineEn ?? existing.tagline_en,
    philosophyCn: input.philosophyCn ?? existing.philosophy_cn,
    philosophyEn: input.philosophyEn ?? existing.philosophy_en,
  });
}

function ensureKicktraqDebugTables(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kicktraq_import_debug (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      diagnostics_json TEXT,
      debug_json TEXT,
      structured_json TEXT,
      written_json TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_kicktraq_debug_project ON kicktraq_import_debug(project_id, created_at);
  `);
}

function getDB(): Database {
  if (globalThis.__ksDb) {
    ensureRuntimeMigrations(globalThis.__ksDb);
    return globalThis.__ksDb;
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const db = new BetterSqlite3(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      blurb TEXT,
      goal REAL DEFAULT 0,
      pledged REAL DEFAULT 0,
      usd_pledged REAL DEFAULT 0,
      state TEXT NOT NULL,
      country TEXT,
      country_name TEXT,
      currency TEXT,
      category_id INTEGER,
      category_name TEXT,
      category_parent TEXT,
      backers_count INTEGER DEFAULT 0,
      staff_pick INTEGER DEFAULT 0,
      created_at INTEGER,
      launched_at INTEGER,
      deadline INTEGER,
      creator_name TEXT,
      creator_slug TEXT,
      creator_url TEXT,
      source_url TEXT,
      slug TEXT,
      image_url TEXT,
      image_thumb_url TEXT,
      has_service_agency INTEGER DEFAULT 0,
      service_agency_name TEXT,
      data_source TEXT DEFAULT 'webrobots',
      first_seen_at INTEGER,
      last_seen_at INTEGER,
      webrobots_synced_at INTEGER,
      ks_live_synced_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_state ON projects(state);
    CREATE INDEX IF NOT EXISTS idx_category ON projects(category_parent);
    CREATE INDEX IF NOT EXISTS idx_country ON projects(country);
    CREATE INDEX IF NOT EXISTS idx_launched ON projects(launched_at);
    CREATE INDEX IF NOT EXISTS idx_pledged ON projects(usd_pledged);
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password_hash TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

    CREATE TABLE IF NOT EXISTS email_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_otps_email ON email_otps(email);

    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS tracking_settings (
      project_id TEXT PRIMARY KEY,
      is_tracking INTEGER DEFAULT 1,
      track_rewards INTEGER DEFAULT 1,
      track_comments INTEGER DEFAULT 0,
      analyze_comments INTEGER DEFAULT 0,
      track_text_diff INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 1,
      subscriber_count INTEGER DEFAULT 0,
      priority_score INTEGER DEFAULT 0,
      last_fetched INTEGER,
      next_fetch INTEGER,
      consecutive_failures INTEGER DEFAULT 0,
      last_failure_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_project_subscriptions (
      user_id INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      is_tracking INTEGER DEFAULT 1,
      track_rewards INTEGER DEFAULT 1,
      track_comments INTEGER DEFAULT 0,
      analyze_comments INTEGER DEFAULT 0,
      track_text_diff INTEGER DEFAULT 1,
      priority INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, project_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS project_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      pledged_usd REAL,
      backers_count INTEGER,
      days_to_go INTEGER,
      comments_count INTEGER,
      updates_count INTEGER,
      state TEXT,
      source TEXT DEFAULT 'ks',
      UNIQUE(project_id, captured_at, source)
    );

    CREATE TABLE IF NOT EXISTS reward_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      reward_id TEXT NOT NULL,
      title TEXT,
      description TEXT,
      amount_usd REAL,
      backers_count INTEGER,
      limit_count INTEGER,
      is_limited INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS project_text_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      captured_at INTEGER NOT NULL,
      field TEXT NOT NULL,
      content TEXT NOT NULL,
      UNIQUE(project_id, captured_at, field)
    );

    CREATE TABLE IF NOT EXISTS project_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      comment_id TEXT NOT NULL UNIQUE,
      author TEXT,
      content TEXT NOT NULL,
      posted_at INTEGER,
      fetched_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS project_collaborators (
      project_id TEXT NOT NULL,
      collaborator_key TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT,
      avatar_url TEXT,
      profile_url TEXT,
      is_service_agency INTEGER DEFAULT 0,
      captured_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (project_id, collaborator_key)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON project_snapshots(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_rewards_project ON reward_snapshots(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_text_project ON project_text_history(project_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_comments_project ON project_comments(project_id, posted_at);
    CREATE INDEX IF NOT EXISTS idx_collaborators_project ON project_collaborators(project_id);
    CREATE INDEX IF NOT EXISTS idx_tracking_next ON tracking_settings(next_fetch);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_project ON user_project_subscriptions(project_id, is_tracking);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON user_project_subscriptions(user_id, is_tracking);

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT,
      started_at TEXT,
      completed_at TEXT,
      records_imported INTEGER DEFAULT 0,
      status TEXT,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS crawl_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT NOT NULL,
      payload_json TEXT,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'queued',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      scheduled_at INTEGER DEFAULT (unixepoch()),
      started_at INTEGER,
      completed_at INTEGER,
      last_error TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS crawl_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      discovered_count INTEGER DEFAULT 0,
      imported_count INTEGER DEFAULT 0,
      snapshot_count INTEGER DEFAULT 0,
      page_count INTEGER DEFAULT 0,
      blocked_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS source_raw_payloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL,
      fetched_at INTEGER DEFAULT (unixepoch()),
      status_code INTEGER,
      content_type TEXT,
      payload_bytes INTEGER DEFAULT 0,
      checksum TEXT,
      payload_preview TEXT
    );

    CREATE TABLE IF NOT EXISTS crawler_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      job_type TEXT,
      project_id TEXT,
      url TEXT,
      status_code INTEGER,
      message TEXT NOT NULL,
      occurred_at INTEGER DEFAULT (unixepoch()),
      context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_crawl_jobs_due ON crawl_jobs(status, scheduled_at, priority);
    CREATE INDEX IF NOT EXISTS idx_crawl_runs_source ON crawl_runs(source, started_at);
    CREATE INDEX IF NOT EXISTS idx_payloads_source_key ON source_raw_payloads(source, source_key, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_crawler_errors_source ON crawler_errors(source, occurred_at);

    CREATE TABLE IF NOT EXISTS nav_settings (
      nav_key TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      admin_visible INTEGER DEFAULT 1,
      user_visible INTEGER DEFAULT 1,
      updated_at INTEGER DEFAULT (unixepoch())
    );
  `);
  ensureAnnouncementTables(db);
  ensureKicktraqDebugTables(db);

  ensureRuntimeMigrations(db);

  globalThis.__ksDb = db;
  return db;
}

// No-op: better-sqlite3 writes directly to disk, no explicit save needed
export async function saveDB(): Promise<void> {
  getDB().pragma('wal_checkpoint(TRUNCATE)');
}

// ─── Public query functions ──────────────────────────────────────────────────

export interface DashboardStats {
  total: number;
  successful: number;
  failed: number;
  live: number;
  canceled: number;
  success_rate: number;
  total_pledged_usd: number;
  avg_backers: number;
  avg_goal: number;
  category_count?: number;
}

function dateWhere(alias = '') {
  const p = alias ? `${alias}.` : '';
  return {
    clauses: [] as string[],
    params: {} as Record<string, unknown>,
    launched: `${p}launched_at`,
  };
}

export async function getStats(filter: { dateFrom?: number; dateTo?: number } = {}): Promise<DashboardStats> {
  return swrCached(`stats:${filter.dateFrom ?? ''}:${filter.dateTo ?? ''}`, 60_000, () => computeStats(filter));
}

function computeStats(filter: { dateFrom?: number; dateTo?: number } = {}): DashboardStats {
  const w = dateWhere();
  if (filter.dateFrom) { w.clauses.push(`${w.launched} >= @dateFrom`); w.params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { w.clauses.push(`${w.launched} <= @dateTo`); w.params.dateTo = filter.dateTo; }
  const where = w.clauses.length ? `WHERE ${w.clauses.join(' AND ')}` : '';
  return getDB().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN state='failed'     THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN state='live'       THEN 1 ELSE 0 END) as live,
      SUM(CASE WHEN state='canceled'   THEN 1 ELSE 0 END) as canceled,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_usd,
      ROUND(AVG(backers_count), 1) as avg_backers,
      ROUND(AVG(goal), 0) as avg_goal,
      COUNT(DISTINCT category_parent) as category_count
    FROM projects
    ${where}
  `).get(w.params) as DashboardStats;
}

export async function getStateDistribution(filter: { dateFrom?: number; dateTo?: number } = {}): Promise<{ state: string; count: number }[]> {
  return swrCached(`stateDist:${filter.dateFrom ?? ''}:${filter.dateTo ?? ''}`, 60_000, () => {
    const w = dateWhere();
    if (filter.dateFrom) { w.clauses.push(`${w.launched} >= @dateFrom`); w.params.dateFrom = filter.dateFrom; }
    if (filter.dateTo) { w.clauses.push(`${w.launched} <= @dateTo`); w.params.dateTo = filter.dateTo; }
    const where = w.clauses.length ? `WHERE ${w.clauses.join(' AND ')}` : '';
    return getDB().prepare(
      `SELECT
         CASE lower(COALESCE(state, ''))
           WHEN 'success' THEN 'successful'
           WHEN 'funded' THEN 'successful'
           WHEN 'cancelled' THEN 'canceled'
           WHEN 'unsuccessful' THEN 'failed'
           ELSE lower(COALESCE(state, ''))
         END as state,
         COUNT(*) as count
       FROM projects ${where}
       GROUP BY 1 ORDER BY count DESC`
    ).all(w.params) as { state: string; count: number }[];
  });
}

export interface ProjectFilter {
  state?: string;
  category?: string;
  categoryName?: string;
  country?: string;
  search?: string;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  dateFrom?: number;
  dateTo?: number;
  serviceAgency?: string;
}

export async function getProjects(filter: ProjectFilter = {}) {
  const db = getDB();
  const { state, category, categoryName, country, search, sort = 'usd_pledged', sortDir = 'desc', page = 1, limit = 20, dateFrom, dateTo, serviceAgency } = filter;

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (state && state !== 'all') { conditions.push('p.state = @state'); params.state = state; }
  if (category) { conditions.push('p.category_parent = @category'); params.category = category; }
  if (categoryName) { conditions.push('p.category_name = @categoryName'); params.categoryName = categoryName; }
  if (country) { conditions.push('p.country = @country'); params.country = country; }
  if (search) { conditions.push('(p.name LIKE @search OR p.blurb LIKE @search)'); params.search = `%${search}%`; }
  if (dateFrom) { conditions.push('p.launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo) { conditions.push('p.launched_at <= @dateTo'); params.dateTo = dateTo; }
  if (serviceAgency) {
    if (serviceAgency === '__has_agency__') {
      conditions.push('p.has_service_agency = 1');
    } else {
      conditions.push('p.service_agency_name LIKE @serviceAgency');
      params.serviceAgency = `%${serviceAgency}%`;
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  const projectNormalizedUsd = `
    CASE
      WHEN COALESCE(p.usd_pledged, 0) > 0 THEN
        CASE
          WHEN COALESCE(p.currency, 'USD') <> 'USD'
               AND p.usd_pledged >= MAX(1, COALESCE(p.pledged, 0)) * 0.8
            THEN p.usd_pledged * CASE COALESCE(p.currency, 'USD')
              WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'AUD' THEN 0.65
              WHEN 'CAD' THEN 0.73 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08
              WHEN 'SEK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'NOK' THEN 0.093
              WHEN 'CHF' THEN 1.10 WHEN 'MXN' THEN 0.059 WHEN 'SGD' THEN 0.74
              WHEN 'NZD' THEN 0.60 ELSE 1
            END
          ELSE p.usd_pledged
        END
      WHEN COALESCE(p.currency, 'USD') <> 'USD' AND COALESCE(p.pledged, 0) > 0
        THEN p.pledged * CASE COALESCE(p.currency, 'USD')
          WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'AUD' THEN 0.65
          WHEN 'CAD' THEN 0.73 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08
          WHEN 'SEK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'NOK' THEN 0.093
          WHEN 'CHF' THEN 1.10 WHEN 'MXN' THEN 0.059 WHEN 'SGD' THEN 0.74
          WHEN 'NZD' THEN 0.60 ELSE 1
        END
      ELSE 0
    END
  `;
  const sortMap: Record<string, string> = {
    usd_pledged: `${projectNormalizedUsd} ${dir}`,
    backers: `p.backers_count ${dir}`,
    goal: `p.goal ${dir}`,
    launched: `p.launched_at ${dir}`,
    funding_rate: `(CASE WHEN p.goal>0 THEN ${projectNormalizedUsd}/(CASE WHEN COALESCE(p.currency, 'USD') <> 'USD' THEN p.goal * CASE COALESCE(p.currency, 'USD') WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'AUD' THEN 0.65 WHEN 'CAD' THEN 0.73 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08 WHEN 'SEK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'NOK' THEN 0.093 WHEN 'CHF' THEN 1.10 WHEN 'MXN' THEN 0.059 WHEN 'SGD' THEN 0.74 WHEN 'NZD' THEN 0.60 ELSE 1 END ELSE p.goal END) ELSE 0 END) ${dir}`,
  };
  const orderBy = sortMap[sort] || `${projectNormalizedUsd} ${dir}`;
  const offset = (page - 1) * limit;

  const countRow = db.prepare(`SELECT COUNT(*) as c FROM projects p ${where}`).get(params) as { c: number };
  const total = countRow?.c ?? 0;

  const rows = db.prepare(
    `SELECT p.id, p.name, p.blurb,
            CASE
              WHEN p.deadline IS NOT NULL AND p.deadline < unixepoch()
                   AND COALESCE(NULLIF(s.state, ''), p.state) = 'live'
                THEN CASE WHEN p.goal > 0 AND COALESCE(p.usd_pledged, 0) >= p.goal THEN 'successful' ELSE 'failed' END
              WHEN s.state IN ('live','successful','failed','canceled','suspended') THEN s.state
              ELSE p.state
            END as state,
            p.country, p.country_name, p.currency,
            p.category_parent, p.category_name, p.goal,
            p.pledged, p.usd_pledged,
            MAX(COALESCE(s.snap_backers, 0), COALESCE(p.backers_count, 0)) as backers_count,
            p.staff_pick, p.launched_at, p.deadline,
            p.creator_name, p.creator_slug, p.creator_url,
            p.source_url, p.slug,
            p.image_url, p.image_thumb_url, p.data_source,
            p.has_service_agency, p.service_agency_name,
            CASE
              WHEN s.source = 'kicktraq_active' AND COALESCE(p.currency, 'USD') <> 'USD' THEN NULL
              WHEN s.pledged_usd IS NOT NULL AND (s.pledged_usd > 0 OR p.usd_pledged = 0)
                THEN MAX(s.pledged_usd, COALESCE(p.usd_pledged, 0))
              ELSE NULL
            END as live_pledged_usd,
            s.snap_backers as live_backers_count,
            s.captured_at as live_captured_at,
            s.days_to_go as live_days_to_go
     FROM projects p
     LEFT JOIN (
       SELECT ps.project_id, ps.captured_at, ps.pledged_usd,
              ps.backers_count as snap_backers, ps.days_to_go, ps.state, ps.source
       FROM project_snapshots ps
       JOIN (
         SELECT project_id, MAX(id) as id
         FROM project_snapshots
         WHERE state NOT IN ('unknown', 'historical')
         GROUP BY project_id
       ) latest ON latest.id = ps.id
     ) s ON s.project_id = p.id
     ${where} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });

  return { total, rows, page, limit };
}

export async function getCategories(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const where = `WHERE category_parent IS NOT NULL AND state IN ('successful','failed')${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      category_parent as category,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN state='failed'     THEN 1 ELSE 0 END) as failed,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m,
      ROUND(AVG(usd_pledged), 0) as avg_pledged,
      SUM(backers_count) as total_backers
    FROM projects
    ${where}
    GROUP BY category_parent ORDER BY total DESC LIMIT 25
  `).all(params);
}

export async function getTrends(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const defaultWindow = !dateFrom && !dateTo ? "AND launched_at > strftime('%s', date('now', '-36 months'))" : '';
  const where = `WHERE launched_at IS NOT NULL AND state IN ('successful','failed') ${defaultWindow}${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      strftime('%Y-%m', datetime(launched_at, 'unixepoch')) as month,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m
    FROM projects
    ${where}
    GROUP BY month ORDER BY month ASC
  `).all(params);
}

export async function getCountries(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const { dateFrom, dateTo } = filter;
  const extra: string[] = [];
  const params: Record<string, unknown> = {};
  if (dateFrom) { extra.push('launched_at >= @dateFrom'); params.dateFrom = dateFrom; }
  if (dateTo)   { extra.push('launched_at <= @dateTo');   params.dateTo   = dateTo;   }
  const where = `WHERE country IS NOT NULL AND state IN ('successful','failed')${extra.length ? ' AND ' + extra.join(' AND ') : ''}`;
  return getDB().prepare(`
    SELECT
      country,
      country_name,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN (CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END) END)*100, 1) as success_rate,
      ROUND(SUM(usd_pledged)/1000000.0, 2) as total_pledged_m,
      SUM(backers_count) as total_backers
    FROM projects
    ${where}
    GROUP BY country ORDER BY total DESC LIMIT 20
  `).all(params);
}

export function getTimeAnalysis(filter: { categoryParent?: string; categoryName?: string; country?: string } = {}) {
  const clauses = ['launched_at IS NOT NULL'];
  const params: Record<string, unknown> = {};
  if (filter.categoryParent) { clauses.push('category_parent = @categoryParent'); params.categoryParent = filter.categoryParent; }
  if (filter.categoryName) { clauses.push('category_name = @categoryName'); params.categoryName = filter.categoryName; }
  if (filter.country) { clauses.push('country = @country'); params.country = filter.country; }
  const where = `WHERE ${clauses.join(' AND ')}`;
  return getDB().prepare(`
    SELECT
      strftime('%Y', datetime(launched_at, 'unixepoch')) as year,
      COUNT(*) as total,
      SUM(CASE WHEN state='successful' THEN 1 ELSE 0 END) as successful,
      SUM(CASE WHEN state='failed' THEN 1 ELSE 0 END) as failed,
      ROUND(AVG(CASE WHEN state IN ('successful','failed')
        THEN CASE WHEN state='successful' THEN 1.0 ELSE 0.0 END END) * 100, 1) as success_rate,
      ROUND(SUM(COALESCE(usd_pledged, 0)) / 1000000.0, 2) as total_pledged_m,
      SUM(COALESCE(backers_count, 0)) as total_backers
    FROM projects
    ${where}
    GROUP BY year
    ORDER BY year ASC
  `).all(params) as {
    year: string;
    total: number;
    successful: number;
    failed: number;
    success_rate: number;
    total_pledged_m: number;
    total_backers: number;
  }[];
}

export interface LeaderboardFilter {
  dateFrom?: number;
  dateTo?: number;
  categoryParent?: string;
  categoryName?: string;
  limit?: number;
}

export interface LeaderboardProject {
  id: string;
  name: string;
  blurb: string | null;
  state: string;
  slug: string | null;
  creator_name: string | null;
  creator_slug: string | null;
  category_parent: string | null;
  category_name: string | null;
  country: string | null;
  country_name: string | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string | null;
  image_url: string | null;
  image_thumb_url: string | null;
  pledged_usd: number;
  backers_count: number;
  goal: number;
  funded_pct: number;
}

export interface LeaderboardCreator {
  creator_key: string;
  creator_name: string;
  creator_slug: string | null;
  project_count: number;
  total_pledged_usd: number;
  avg_pledged_usd: number;
  total_backers: number;
  best_project_id: string | null;
  best_project_name: string | null;
  best_project_image_url: string | null;
  best_project_thumb_url: string | null;
  category_parent: string | null;
  country: string | null;
}

export type LeaderboardAgency = LeaderboardCreator;

function leaderboardWhere(filter: LeaderboardFilter) {
  const clauses = ['p.launched_at IS NOT NULL'];
  const params: Record<string, unknown> = {};
  if (filter.dateFrom) { clauses.push('p.launched_at >= @dateFrom'); params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { clauses.push('p.launched_at <= @dateTo'); params.dateTo = filter.dateTo; }
  if (filter.categoryParent) { clauses.push('p.category_parent = @categoryParent'); params.categoryParent = filter.categoryParent; }
  if (filter.categoryName) { clauses.push('p.category_name = @categoryName'); params.categoryName = filter.categoryName; }
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

function leaderboardBaseSql(where: string) {
  return `
    WITH latest AS (
      SELECT ps.project_id, ps.pledged_usd, ps.backers_count
      FROM project_snapshots ps
      JOIN (
        SELECT project_id, MAX(id) as id
        FROM project_snapshots
        WHERE state NOT IN ('unknown', 'historical')
          AND NOT (COALESCE(pledged_usd, 0) = 0 AND COALESCE(backers_count, 0) = 0)
        GROUP BY project_id
      ) x ON x.id = ps.id
    ),
    raw_rows AS (
      SELECT
        p.id, p.name, p.blurb, p.state, p.slug, p.creator_name, p.creator_slug,
        p.category_parent, p.category_name, p.country, p.country_name,
        p.launched_at, p.deadline, p.source_url, p.image_url, p.image_thumb_url,
        MAX(
          COALESCE(l.pledged_usd, 0),
          CASE
            WHEN COALESCE(p.currency, 'USD') = 'USD'
              THEN COALESCE(p.usd_pledged, COALESCE(p.pledged, 0))
            WHEN COALESCE(p.usd_pledged, 0) > 0 THEN p.usd_pledged
            WHEN COALESCE(p.pledged, 0) > 0
              THEN p.pledged * CASE COALESCE(p.currency, 'USD')
                WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'AUD' THEN 0.65
                WHEN 'CAD' THEN 0.73 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08
                WHEN 'SEK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'NOK' THEN 0.093
                WHEN 'CHF' THEN 1.10 WHEN 'MXN' THEN 0.059 WHEN 'SGD' THEN 0.74
                WHEN 'NZD' THEN 0.60 ELSE 1
              END
            ELSE 0
          END
        ) as pledged_usd,
        MAX(COALESCE(l.backers_count, 0), COALESCE(p.backers_count, 0)) as backers_count,
        CASE
          WHEN COALESCE(p.currency, 'USD') <> 'USD' AND COALESCE(p.goal, 0) > 0
            THEN p.goal * CASE COALESCE(p.currency, 'USD')
              WHEN 'JPY' THEN 0.0067 WHEN 'HKD' THEN 0.128 WHEN 'AUD' THEN 0.65
              WHEN 'CAD' THEN 0.73 WHEN 'GBP' THEN 1.25 WHEN 'EUR' THEN 1.08
              WHEN 'SEK' THEN 0.093 WHEN 'DKK' THEN 0.145 WHEN 'NOK' THEN 0.093
              WHEN 'CHF' THEN 1.10 WHEN 'MXN' THEN 0.059 WHEN 'SGD' THEN 0.74
              WHEN 'NZD' THEN 0.60 ELSE 1
            END
          ELSE COALESCE(p.goal, 0)
        END as goal,
        CASE WHEN COALESCE(p.goal, 0) > 0
          THEN ROUND((
            MAX(
              COALESCE(l.pledged_usd, 0),
              COALESCE(p.usd_pledged, 0),
              COALESCE(p.pledged, 0)
            )
          ) / p.goal * 100, 1)
          ELSE 0
        END as funded_pct,
        CASE
          WHEN p.slug IS NOT NULL AND p.slug <> '' THEN lower(p.slug)
          ELSE p.id
        END as dedupe_key
      FROM projects p
      LEFT JOIN latest l ON l.project_id = p.id
      ${where}
    ),
    deduped AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY dedupe_key
          ORDER BY pledged_usd DESC, backers_count DESC, CASE WHEN image_url IS NOT NULL OR image_thumb_url IS NOT NULL THEN 1 ELSE 0 END DESC
        ) as rn
      FROM raw_rows
    )
    SELECT
      p.id, p.name, p.blurb, p.state,
      p.slug, p.creator_name, p.creator_slug,
      p.category_parent, p.category_name, p.country, p.country_name,
      p.launched_at, p.deadline, p.source_url, p.image_url, p.image_thumb_url,
      p.pledged_usd, p.backers_count, p.goal, p.funded_pct
    FROM deduped p
    WHERE p.rn = 1
  `;
}

export function getLeaderboard(filter: LeaderboardFilter = {}) {
  const key = `leaderboard:${filter.dateFrom ?? ''}:${filter.dateTo ?? ''}:${filter.categoryParent ?? ''}:${filter.categoryName ?? ''}:${filter.limit ?? 25}`;
  return swrCached(key, 120_000, () => computeLeaderboard(filter));
}

function computeLeaderboard(filter: LeaderboardFilter = {}) {
  const limit = Math.max(1, Math.min(filter.limit ?? 25, 100));
  const { where, params } = leaderboardWhere(filter);
  const base = leaderboardBaseSql(where);
  const byPledged = getDB().prepare(`
    ${base}
    ORDER BY pledged_usd DESC, backers_count DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardProject[];
  const byBackers = getDB().prepare(`
    ${base}
    ORDER BY backers_count DESC, pledged_usd DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardProject[];
  const summary = getDB().prepare(`
    WITH ranked AS (${base})
    SELECT
      COUNT(*) as total_projects,
      SUM(pledged_usd) as total_pledged_usd,
      SUM(backers_count) as total_backers,
      AVG(funded_pct) as avg_funded_pct
    FROM ranked
  `).get(params) as {
    total_projects: number;
    total_pledged_usd: number;
    total_backers: number;
    avg_funded_pct: number;
  };
  const creatorBase = `
    WITH ranked AS (${base}),
    creator_rows AS (
      SELECT *,
        COALESCE(NULLIF(creator_slug, ''), lower(trim(COALESCE(creator_name, 'unknown')))) as creator_key
      FROM ranked
      WHERE COALESCE(creator_name, creator_slug) IS NOT NULL
    ),
    grouped AS (
      SELECT
        creator_key,
        COALESCE(MAX(NULLIF(creator_name, '')), MAX(NULLIF(creator_slug, '')), 'Unknown creator') as creator_name,
        MAX(NULLIF(creator_slug, '')) as creator_slug,
        COUNT(*) as project_count,
        SUM(pledged_usd) as total_pledged_usd,
        AVG(pledged_usd) as avg_pledged_usd,
        SUM(backers_count) as total_backers,
        MAX(category_parent) as category_parent,
        MAX(country) as country
      FROM creator_rows
      GROUP BY creator_key
    ),
    best_projects AS (
      SELECT creator_key, id, name, image_url, image_thumb_url,
        ROW_NUMBER() OVER (PARTITION BY creator_key ORDER BY pledged_usd DESC, backers_count DESC) as rn
      FROM creator_rows
    )
    SELECT
      g.creator_key, g.creator_name, g.creator_slug, g.project_count,
      g.total_pledged_usd, g.avg_pledged_usd, g.total_backers,
      b.id as best_project_id, b.name as best_project_name,
      b.image_url as best_project_image_url, b.image_thumb_url as best_project_thumb_url,
      g.category_parent, g.country
    FROM grouped g
    LEFT JOIN best_projects b ON b.creator_key = g.creator_key AND b.rn = 1
  `;
  const creatorsByPledged = getDB().prepare(`
    ${creatorBase}
    ORDER BY total_pledged_usd DESC, project_count DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardCreator[];
  const creatorsByCount = getDB().prepare(`
    ${creatorBase}
    ORDER BY project_count DESC, total_pledged_usd DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardCreator[];
  const creatorsByAverage = getDB().prepare(`
    ${creatorBase}
    WHERE project_count > 0
    ORDER BY avg_pledged_usd DESC, total_pledged_usd DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardCreator[];
  const agencyBase = `
    WITH ranked AS (${base}),
    agency_rows AS (
      SELECT r.*,
        lower(trim(pc.name)) as creator_key,
        pc.name as creator_name
      FROM ranked r
      JOIN project_collaborators pc ON pc.project_id = r.id
      WHERE pc.is_service_agency = 1 AND COALESCE(pc.name, '') <> ''
    ),
    grouped AS (
      SELECT
        creator_key,
        MAX(creator_name) as creator_name,
        NULL as creator_slug,
        COUNT(*) as project_count,
        SUM(pledged_usd) as total_pledged_usd,
        AVG(pledged_usd) as avg_pledged_usd,
        SUM(backers_count) as total_backers,
        MAX(category_parent) as category_parent,
        MAX(country) as country
      FROM agency_rows
      GROUP BY creator_key
    ),
    best_projects AS (
      SELECT creator_key, id, name, image_url, image_thumb_url,
        ROW_NUMBER() OVER (PARTITION BY creator_key ORDER BY pledged_usd DESC, backers_count DESC) as rn
      FROM agency_rows
    )
    SELECT
      g.creator_key, g.creator_name, g.creator_slug, g.project_count,
      g.total_pledged_usd, g.avg_pledged_usd, g.total_backers,
      b.id as best_project_id, b.name as best_project_name,
      b.image_url as best_project_image_url, b.image_thumb_url as best_project_thumb_url,
      g.category_parent, g.country
    FROM grouped g
    LEFT JOIN best_projects b ON b.creator_key = g.creator_key AND b.rn = 1
  `;
  const agenciesByPledged = getDB().prepare(`
    ${agencyBase}
    ORDER BY total_pledged_usd DESC, project_count DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardAgency[];
  const agenciesByCount = getDB().prepare(`
    ${agencyBase}
    ORDER BY project_count DESC, total_pledged_usd DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardAgency[];
  const agenciesByAverage = getDB().prepare(`
    ${agencyBase}
    WHERE project_count > 0
    ORDER BY avg_pledged_usd DESC, total_pledged_usd DESC
    LIMIT @limit
  `).all({ ...params, limit }) as LeaderboardAgency[];
  return { byPledged, byBackers, creatorsByPledged, creatorsByCount, creatorsByAverage, agenciesByPledged, agenciesByCount, agenciesByAverage, summary };
}

export function getLeaderboardCategoryOptions(filter: { dateFrom?: number; dateTo?: number } = {}) {
  return swrCached(`leaderboardCategories:${filter.dateFrom ?? ''}:${filter.dateTo ?? ''}`, 300_000, () => computeLeaderboardCategoryOptions(filter));
}

function computeLeaderboardCategoryOptions(filter: { dateFrom?: number; dateTo?: number } = {}) {
  const clauses = ['category_parent IS NOT NULL'];
  const params: Record<string, unknown> = {};
  if (filter.dateFrom) { clauses.push('launched_at >= @dateFrom'); params.dateFrom = filter.dateFrom; }
  if (filter.dateTo) { clauses.push('launched_at <= @dateTo'); params.dateTo = filter.dateTo; }
  return getDB().prepare(`
    SELECT category_parent, category_name, COUNT(*) as total
    FROM projects
    WHERE ${clauses.join(' AND ')}
    GROUP BY category_parent, category_name
    ORDER BY category_parent ASC, total DESC, category_name ASC
  `).all(params) as { category_parent: string; category_name: string | null; total: number }[];
}

export async function getCategoryList(): Promise<string[]> {
  const rows = getDB().prepare(
    `SELECT DISTINCT category_parent FROM projects WHERE category_parent IS NOT NULL ORDER BY category_parent`
  ).all() as { category_parent: string }[];
  return rows.map(r => r.category_parent);
}

export async function getCountryList(): Promise<{ country: string; country_name: string }[]> {
  return getDB().prepare(
    `SELECT DISTINCT country, country_name FROM projects WHERE country IS NOT NULL ORDER BY country`
  ).all() as { country: string; country_name: string }[];
}

// Returns the DB instance for use in sync
export async function getDBInstance(): Promise<Database> {
  return getDB();
}

// Synchronous batch upsert using better-sqlite3 transactions
export function upsertBatch(db: Database, rows: Record<string, unknown>[]): void {
  const insert = db.prepare(`
    INSERT INTO projects
      (id, name, blurb, goal, pledged, usd_pledged, state, country, country_name,
       currency, category_id, category_name, category_parent, backers_count,
       staff_pick, created_at, launched_at, deadline, creator_name, creator_slug, creator_url, source_url, slug,
       image_url, image_thumb_url, data_source, first_seen_at, last_seen_at, webrobots_synced_at, ks_live_synced_at)
    VALUES
      (@id, @name, @blurb, @goal, @pledged, @usd_pledged, @state, @country, @country_name,
       @currency, @category_id, @category_name, @category_parent, @backers_count,
       @staff_pick, @created_at, @launched_at, @deadline, @creator_name, @creator_slug, @creator_url, @source_url, @slug,
       @image_url, @image_thumb_url, @data_source, @first_seen_at, @last_seen_at, @webrobots_synced_at, @ks_live_synced_at)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      blurb = excluded.blurb,
      -- goal rarely changes; never let a discovery row that lacks a goal (e.g.
      -- Kicktraq active scan writes goal=0 for non-USD) wipe a known goal.
      goal = CASE WHEN COALESCE(excluded.goal, 0) > 0 THEN excluded.goal ELSE projects.goal END,
      -- Pledged is cumulative/monotonic, so keep the highest known figure. This
      -- stops a stale or lower-currency-only discovery row (Kicktraq's $6.25M for
      -- BB-777) from clobbering the authoritative Kickstarter total ($7.0M).
      pledged = CASE WHEN COALESCE(excluded.pledged, 0) > 0
                  THEN MAX(COALESCE(projects.pledged, 0), excluded.pledged)
                  ELSE projects.pledged END,
      usd_pledged = MAX(COALESCE(projects.usd_pledged, 0), COALESCE(excluded.usd_pledged, 0)),
      state = excluded.state,
      country = COALESCE(excluded.country, projects.country),
      country_name = COALESCE(excluded.country_name, projects.country_name),
      currency = COALESCE(excluded.currency, projects.currency),
      category_id = COALESCE(excluded.category_id, projects.category_id),
      category_name = COALESCE(excluded.category_name, projects.category_name),
      category_parent = COALESCE(excluded.category_parent, projects.category_parent),
      backers_count = MAX(COALESCE(projects.backers_count, 0), COALESCE(excluded.backers_count, 0)),
      staff_pick = excluded.staff_pick,
      created_at = COALESCE(excluded.created_at, projects.created_at),
      launched_at = COALESCE(excluded.launched_at, projects.launched_at),
      deadline = COALESCE(excluded.deadline, projects.deadline),
      creator_name = COALESCE(excluded.creator_name, projects.creator_name),
      creator_slug = COALESCE(excluded.creator_slug, projects.creator_slug),
      creator_url = COALESCE(excluded.creator_url, projects.creator_url),
      source_url = COALESCE(excluded.source_url, projects.source_url),
      slug = COALESCE(excluded.slug, projects.slug),
      image_url = COALESCE(excluded.image_url, projects.image_url),
      image_thumb_url = COALESCE(excluded.image_thumb_url, projects.image_thumb_url),
      data_source = CASE
        WHEN projects.data_source = excluded.data_source THEN projects.data_source
        WHEN projects.data_source IS NULL THEN excluded.data_source
        WHEN excluded.data_source IS NULL THEN projects.data_source
        WHEN instr(projects.data_source, excluded.data_source) > 0 THEN projects.data_source
        ELSE projects.data_source || ',' || excluded.data_source
      END,
      first_seen_at = COALESCE(MIN(projects.first_seen_at, excluded.first_seen_at), projects.first_seen_at, excluded.first_seen_at),
      last_seen_at = COALESCE(MAX(projects.last_seen_at, excluded.last_seen_at), projects.last_seen_at, excluded.last_seen_at),
      webrobots_synced_at = COALESCE(excluded.webrobots_synced_at, projects.webrobots_synced_at),
      ks_live_synced_at = COALESCE(excluded.ks_live_synced_at, projects.ks_live_synced_at)
  `);
  const insertMany = db.transaction((items: Record<string, unknown>[]) => {
    const now = Math.floor(Date.now() / 1000);
    for (const row of items) {
      const dataSource = row.data_source ?? 'webrobots';
      insert.run({
        ...row,
        data_source: dataSource,
        first_seen_at: row.first_seen_at ?? now,
        last_seen_at: row.last_seen_at ?? now,
        webrobots_synced_at: row.webrobots_synced_at ?? (dataSource === 'webrobots' ? now : null),
        ks_live_synced_at: row.ks_live_synced_at ?? (dataSource === 'ks_live' ? now : null),
        creator_url: row.creator_url ?? null,
        image_url: row.image_url ?? null,
        image_thumb_url: row.image_thumb_url ?? null,
      });
    }
  });
  insertMany(rows);
}

export async function upsertProjects(rows: Record<string, unknown>[]): Promise<number> {
  upsertBatch(getDB(), rows);
  return rows.length;
}

export async function insertSyncLog(log: {
  url: string;
  started_at: string;
  completed_at?: string;
  records_imported?: number;
  status: string;
  error_message?: string;
}): Promise<number> {
  const db = getDB();
  const result = db.prepare(
    `INSERT INTO sync_logs (url, started_at, completed_at, records_imported, status, error_message)
     VALUES (@url, @started_at, @completed_at, @records_imported, @status, @error_message)`
  ).run({
    url: log.url,
    started_at: log.started_at,
    completed_at: log.completed_at ?? null,
    records_imported: log.records_imported ?? null,
    status: log.status,
    error_message: log.error_message ?? null,
  });
  return Number(result.lastInsertRowid);
}

export async function updateSyncLog(
  id: number,
  data: Partial<{ completed_at: string; records_imported: number; status: string; error_message: string }>,
): Promise<void> {
  const sets = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
  getDB().prepare(`UPDATE sync_logs SET ${sets} WHERE id = @id`).run({ ...data, id });
  // A finished sync may have written new projects/snapshots — mark cached
  // analytics stale and re-warm in the background so the next page load
  // reflects fresh data without blocking.
  if (data.status === 'completed') {
    invalidateAnalyticsCaches();
    setTimeout(() => { try { prewarmAnalyticsCaches(); } catch { /* ignore */ } }, 100);
  }
}

export interface CrawlRunUpdate {
  status?: string;
  completed_at?: number;
  discovered_count?: number;
  imported_count?: number;
  snapshot_count?: number;
  page_count?: number;
  blocked_count?: number;
  error_count?: number;
  message?: string;
}

export function startCrawlRun(source: string, jobType: string): number {
  const result = getDB().prepare(`
    INSERT INTO crawl_runs (source, job_type, status, started_at)
    VALUES (?, ?, 'running', unixepoch())
  `).run(source, jobType);
  return Number(result.lastInsertRowid);
}

export function completeCrawlRun(id: number | undefined, data: CrawlRunUpdate) {
  if (!id) return;
  const next = {
    completed_at: Math.floor(Date.now() / 1000),
    ...data,
  };
  const sets = Object.keys(next).map(k => `${k} = @${k}`).join(', ');
  getDB().prepare(`UPDATE crawl_runs SET ${sets} WHERE id = @id`).run({ ...next, id });
}

const CRAWLER_ERROR_DEDUPE_WINDOW_SEC = 30 * 60;

function isDiskFullError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /database or disk is full|SQLITE_FULL|disk full|out of memory/i.test(msg);
}

export function recordCrawlerError(error: {
  source: string;
  job_type?: string;
  project_id?: string | null;
  url?: string | null;
  status_code?: number | null;
  message: string;
  context?: Record<string, unknown>;
}) {
  try {
    const db = getDB();
    const now = Math.floor(Date.now() / 1000);
    const since = now - CRAWLER_ERROR_DEDUPE_WINDOW_SEC;
    const messagePrefix = error.message.slice(0, 200);
    const existing = db.prepare(`
      SELECT id, occurrence_count
      FROM crawler_errors
      WHERE source = @source
        AND COALESCE(job_type, '') = COALESCE(@job_type, '')
        AND COALESCE(project_id, '') = COALESCE(@project_id, '')
        AND substr(message, 1, 200) = @messagePrefix
        AND COALESCE(last_occurred_at, occurred_at) >= @since
      ORDER BY id DESC
      LIMIT 1
    `).get({
      source: error.source,
      job_type: error.job_type ?? null,
      project_id: error.project_id ?? null,
      messagePrefix,
      since,
    }) as { id: number; occurrence_count: number | null } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE crawler_errors
        SET occurrence_count = COALESCE(occurrence_count, 1) + 1,
            last_occurred_at = @now,
            status_code = COALESCE(@status_code, status_code),
            url = COALESCE(@url, url),
            message = @message
        WHERE id = @id
      `).run({
        id: existing.id,
        now,
        status_code: error.status_code ?? null,
        url: error.url ?? null,
        message: error.message,
      });
      return;
    }

    db.prepare(`
      INSERT INTO crawler_errors (source, job_type, project_id, url, status_code, message, context_json, occurred_at, last_occurred_at, occurrence_count)
      VALUES (@source, @job_type, @project_id, @url, @status_code, @message, @context_json, @now, @now, 1)
    `).run({
      source: error.source,
      job_type: error.job_type ?? null,
      project_id: error.project_id ?? null,
      url: error.url ?? null,
      status_code: error.status_code ?? null,
      message: error.message,
      context_json: error.context ? JSON.stringify(error.context).slice(0, 4000) : null,
      now,
    });
  } catch (writeErr) {
    if (isDiskFullError(writeErr)) {
      console.warn('[db] recordCrawlerError skipped: disk is full', error.message.slice(0, 100));
      return;
    }
    throw writeErr;
  }
}

export interface CrawlerStateRow {
  source: string;
  job_type: string;
  last_status: string | null;
  last_started_at: number | null;
  last_completed_at: number | null;
  blocked_streak: number;
  next_attempt_at: number | null;
  message: string | null;
}

export function getCrawlerState(source: string, jobType: string): CrawlerStateRow | null {
  try {
    return getDB().prepare(`
      SELECT source, job_type, last_status, last_started_at, last_completed_at, blocked_streak, next_attempt_at, message
      FROM crawler_state
      WHERE source = ? AND job_type = ?
    `).get(source, jobType) as CrawlerStateRow | undefined ?? null;
  } catch {
    return null;
  }
}

export function updateCrawlerState(source: string, jobType: string, patch: {
  last_status?: string | null;
  last_started_at?: number | null;
  last_completed_at?: number | null;
  blocked_streak?: number;
  next_attempt_at?: number | null;
  message?: string | null;
}) {
  try {
    const existing = getCrawlerState(source, jobType);
    const merged: CrawlerStateRow = {
      source,
      job_type: jobType,
      last_status: patch.last_status ?? existing?.last_status ?? null,
      last_started_at: patch.last_started_at ?? existing?.last_started_at ?? null,
      last_completed_at: patch.last_completed_at ?? existing?.last_completed_at ?? null,
      blocked_streak: patch.blocked_streak ?? existing?.blocked_streak ?? 0,
      next_attempt_at: patch.next_attempt_at ?? existing?.next_attempt_at ?? null,
      message: patch.message ?? existing?.message ?? null,
    };
    getDB().prepare(`
      INSERT INTO crawler_state (source, job_type, last_status, last_started_at, last_completed_at, blocked_streak, next_attempt_at, message)
      VALUES (@source, @job_type, @last_status, @last_started_at, @last_completed_at, @blocked_streak, @next_attempt_at, @message)
      ON CONFLICT(source, job_type) DO UPDATE SET
        last_status = excluded.last_status,
        last_started_at = excluded.last_started_at,
        last_completed_at = excluded.last_completed_at,
        blocked_streak = excluded.blocked_streak,
        next_attempt_at = excluded.next_attempt_at,
        message = excluded.message
    `).run(merged);
  } catch (err) {
    if (!isDiskFullError(err)) throw err;
  }
}

export interface DiagnosticsReport {
  generatedAt: number;
  database: {
    path: string;
    fileBytes: number | null;
    walBytes: number | null;
    shmBytes: number | null;
    pageCount: number | null;
    pageSize: number | null;
    freelistCount: number | null;
  };
  storage: {
    dataDir: string;
    diskTotalBytes: number | null;
    diskFreeBytes: number | null;
    diskFreePct: number | null;
    isCritical: boolean;
  };
  tableSizes: { name: string; rowCount: number }[];
  browserWorker: {
    configured: boolean;
    fetchUrl: string | null;
    timeoutMs: number;
    tokenConfigured: boolean;
  };
  crawlerStates: CrawlerStateRow[];
  recentBrowserFallbackErrors: RecentCrawlerError[];
}

const DIAGNOSTICS_TABLES = [
  'projects',
  'project_snapshots',
  'reward_snapshots',
  'project_text_history',
  'project_comments',
  'project_collaborators',
  'crawler_errors',
  'crawl_runs',
  'sync_logs',
  'source_raw_payloads',
  'kicktraq_import_debug',
  'tracking_settings',
];

function safeStatBytes(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function safeDiskFreeBytes(dir: string): { total: number | null; free: number | null } {
  try {
    const stats = (fs as unknown as { statfsSync?: (p: string) => { bsize: number; blocks: number; bavail: number } }).statfsSync;
    if (typeof stats === 'function') {
      const s = stats(dir);
      return {
        total: Number(s.bsize) * Number(s.blocks),
        free: Number(s.bsize) * Number(s.bavail),
      };
    }
  } catch {
    /* fall through */
  }
  return { total: null, free: null };
}

export function getDiagnosticsReport(): DiagnosticsReport {
  const db = getDB();
  const generatedAt = Math.floor(Date.now() / 1000);

  const dbFileBytes = safeStatBytes(DB_PATH);
  const walBytes = safeStatBytes(`${DB_PATH}-wal`);
  const shmBytes = safeStatBytes(`${DB_PATH}-shm`);

  let pageCount: number | null = null;
  let pageSize: number | null = null;
  let freelistCount: number | null = null;
  try { pageCount = (db.pragma('page_count', { simple: true }) as number) ?? null; } catch { /* ignore */ }
  try { pageSize = (db.pragma('page_size', { simple: true }) as number) ?? null; } catch { /* ignore */ }
  try { freelistCount = (db.pragma('freelist_count', { simple: true }) as number) ?? null; } catch { /* ignore */ }

  const { total, free } = safeDiskFreeBytes(DATA_DIR);
  const freePct = total && free ? (free / total) * 100 : null;
  const isCritical = (free !== null && free < 50 * 1024 * 1024) || (freePct !== null && freePct < 5);

  const tableSizes: { name: string; rowCount: number }[] = [];
  for (const tableName of DIAGNOSTICS_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number } | undefined;
      tableSizes.push({ name: tableName, rowCount: Number(row?.c ?? 0) });
    } catch {
      /* table may not exist yet */
    }
  }

  let crawlerStates: CrawlerStateRow[] = [];
  try {
    crawlerStates = db.prepare(`
      SELECT source, job_type, last_status, last_started_at, last_completed_at, blocked_streak, next_attempt_at, message
      FROM crawler_state
      ORDER BY COALESCE(last_started_at, 0) DESC
    `).all() as CrawlerStateRow[];
  } catch { /* table may not exist yet */ }

  let recentBrowserFallbackErrors: RecentCrawlerError[] = [];
  try {
    recentBrowserFallbackErrors = db.prepare(`
      SELECT id, source, job_type, project_id, url, status_code, message, occurred_at
      FROM crawler_errors
      WHERE job_type = 'browser_fallback'
      ORDER BY COALESCE(last_occurred_at, occurred_at) DESC, id DESC
      LIMIT 5
    `).all() as RecentCrawlerError[];
  } catch { /* ignore */ }

  const fetchUrl = process.env.KICKSTARTER_BROWSER_FETCH_URL?.trim() || null;
  const tokenConfigured = !!process.env.BROWSER_WORKER_TOKEN?.trim();

  return {
    generatedAt,
    database: {
      path: DB_PATH,
      fileBytes: dbFileBytes,
      walBytes,
      shmBytes,
      pageCount,
      pageSize,
      freelistCount,
    },
    storage: {
      dataDir: DATA_DIR,
      diskTotalBytes: total,
      diskFreeBytes: free,
      diskFreePct: freePct !== null ? Math.round(freePct * 10) / 10 : null,
      isCritical,
    },
    tableSizes,
    browserWorker: {
      configured: !!fetchUrl,
      fetchUrl: fetchUrl ? maskUrl(fetchUrl) : null,
      timeoutMs: Number(process.env.KICKSTARTER_BROWSER_TIMEOUT_MS ?? 60_000),
      tokenConfigured,
    },
    crawlerStates,
    recentBrowserFallbackErrors,
  };
}

function maskUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.protocol}//${url.host}${url.pathname || ''}`;
  } catch {
    return rawUrl.length > 40 ? `${rawUrl.slice(0, 24)}...${rawUrl.slice(-12)}` : rawUrl;
  }
}

export interface PruneOptions {
  errorAgeDays?: number;
  payloadAgeDays?: number;
  debugAgeDays?: number;
  runAgeDays?: number;
  syncLogAgeDays?: number;
  vacuum?: boolean;
}

export interface PruneSummary {
  startedAt: number;
  finishedAt: number;
  errorsDeleted: number;
  payloadsDeleted: number;
  debugDeleted: number;
  runsDeleted: number;
  syncLogsDeleted: number;
  walCheckpointed: boolean;
  vacuumed: boolean;
  diskFullEncountered: boolean;
}

export function pruneOldDiagnostics(options: PruneOptions = {}): PruneSummary {
  const startedAt = Math.floor(Date.now() / 1000);
  const summary: PruneSummary = {
    startedAt,
    finishedAt: startedAt,
    errorsDeleted: 0,
    payloadsDeleted: 0,
    debugDeleted: 0,
    runsDeleted: 0,
    syncLogsDeleted: 0,
    walCheckpointed: false,
    vacuumed: false,
    diskFullEncountered: false,
  };

  const db = getDB();
  const now = startedAt;
  const errorCutoff = now - (options.errorAgeDays ?? 7) * 86400;
  const payloadCutoff = now - (options.payloadAgeDays ?? 7) * 86400;
  const debugCutoff = now - (options.debugAgeDays ?? 7) * 86400;
  const runCutoff = now - (options.runAgeDays ?? 30) * 86400;
  const syncCutoffIso = new Date((now - (options.syncLogAgeDays ?? 30) * 86400) * 1000).toISOString();

  type PruneCountKey = 'errorsDeleted' | 'payloadsDeleted' | 'debugDeleted' | 'runsDeleted' | 'syncLogsDeleted';
  const safeRun = (label: PruneCountKey, sql: string, params: Record<string, unknown>) => {
    try {
      const info = db.prepare(sql).run(params);
      summary[label] = summary[label] + Number(info.changes ?? 0);
    } catch (err) {
      if (isDiskFullError(err)) {
        summary.diskFullEncountered = true;
      } else {
        console.error(`[db] prune ${label} failed:`, err);
      }
    }
  };

  safeRun('errorsDeleted', `DELETE FROM crawler_errors WHERE COALESCE(last_occurred_at, occurred_at) < @cutoff`, { cutoff: errorCutoff });
  safeRun('payloadsDeleted', `DELETE FROM source_raw_payloads WHERE fetched_at < @cutoff`, { cutoff: payloadCutoff });
  try {
    db.prepare(`SELECT 1 FROM kicktraq_import_debug LIMIT 1`).get();
    safeRun('debugDeleted', `DELETE FROM kicktraq_import_debug WHERE created_at < @cutoff`, { cutoff: debugCutoff });
  } catch { /* table may not exist yet */ }
  safeRun('runsDeleted', `DELETE FROM crawl_runs WHERE started_at < @cutoff`, { cutoff: runCutoff });
  safeRun('syncLogsDeleted', `DELETE FROM sync_logs WHERE COALESCE(completed_at, started_at) < @cutoff`, { cutoff: syncCutoffIso });

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    summary.walCheckpointed = true;
  } catch (err) {
    if (isDiskFullError(err)) summary.diskFullEncountered = true;
  }

  if (options.vacuum) {
    try {
      db.exec('VACUUM');
      summary.vacuumed = true;
    } catch (err) {
      if (isDiskFullError(err)) summary.diskFullEncountered = true;
    }
  }

  summary.finishedAt = Math.floor(Date.now() / 1000);
  return summary;
}

export interface PurgeSummary {
  ksLiveBlockedDeleted: number;
  browserFallbackDeleted: number;
  ksLiveDirectDeleted: number;
  totalDeleted: number;
  recentKept: number;
  diskFullEncountered: boolean;
}

export function purgeKsLiveErrors(options: { keepRecent?: number } = {}): PurgeSummary {
  const keepRecent = Math.max(0, Math.min(options.keepRecent ?? 20, 200));
  const db = getDB();
  const summary: PurgeSummary = {
    ksLiveBlockedDeleted: 0,
    browserFallbackDeleted: 0,
    ksLiveDirectDeleted: 0,
    totalDeleted: 0,
    recentKept: 0,
    diskFullEncountered: false,
  };

  const safeDelete = (label: keyof Pick<PurgeSummary, 'ksLiveBlockedDeleted' | 'browserFallbackDeleted' | 'ksLiveDirectDeleted'>, sql: string) => {
    try {
      const info = db.prepare(sql).run();
      summary[label] = Number(info.changes ?? 0);
      summary.totalDeleted += summary[label];
    } catch (err) {
      if (isDiskFullError(err)) {
        summary.diskFullEncountered = true;
      } else {
        console.error(`[db] purgeKsLiveErrors ${label} failed:`, err);
      }
    }
  };

  let keptIds: number[] = [];
  if (keepRecent > 0) {
    try {
      keptIds = (db.prepare(`
        SELECT id FROM crawler_errors
        WHERE source = 'ks_live'
        ORDER BY id DESC
        LIMIT ?
      `).all(keepRecent) as { id: number }[]).map(r => r.id);
      summary.recentKept = keptIds.length;
    } catch { /* ignore */ }
  }

  const keepClause = keptIds.length
    ? ` AND id NOT IN (${keptIds.join(',')})`
    : '';

  safeDelete(
    'ksLiveBlockedDeleted',
    `DELETE FROM crawler_errors WHERE source = 'ks_live' AND (job_type LIKE 'discover:%' OR job_type IS NULL)${keepClause}`,
  );
  safeDelete(
    'browserFallbackDeleted',
    `DELETE FROM crawler_errors WHERE source = 'ks_live' AND job_type = 'browser_fallback'${keepClause}`,
  );
  safeDelete(
    'ksLiveDirectDeleted',
    `DELETE FROM crawler_errors WHERE source = 'ks_live' AND job_type LIKE 'discover:%:direct'${keepClause}`,
  );

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    if (isDiskFullError(err)) summary.diskFullEncountered = true;
  }

  return summary;
}

export interface RecentCrawlerError {
  id: number;
  source: string;
  job_type: string | null;
  project_id: string | null;
  url: string | null;
  status_code: number | null;
  message: string;
  occurred_at: number;
}

export function getRecentCrawlerErrors(filter: {
  projectId?: string | null;
  urls?: Array<string | null | undefined>;
  limit?: number;
} = {}): RecentCrawlerError[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {
    limit: Math.max(1, Math.min(filter.limit ?? 5, 20)),
  };

  if (filter.projectId) {
    clauses.push('project_id = @project_id');
    params.project_id = filter.projectId;
  }

  const urls = (filter.urls ?? []).filter((url): url is string => Boolean(url));
  urls.forEach((url, index) => {
    const key = `url_${index}`;
    clauses.push(`url = @${key}`);
    params[key] = url;
  });

  const where = clauses.length ? `WHERE ${clauses.join(' OR ')}` : '';
  return getDB().prepare(`
    SELECT id, source, job_type, project_id, url, status_code, message, occurred_at
    FROM crawler_errors
    ${where}
    ORDER BY occurred_at DESC, id DESC
    LIMIT @limit
  `).all(params) as RecentCrawlerError[];
}

export function recordSourcePayload(payload: {
  source: string;
  source_key: string;
  status_code?: number | null;
  content_type?: string | null;
  payload_bytes?: number;
  checksum?: string | null;
  payload_preview?: string | null;
}) {
  getDB().prepare(`
    INSERT INTO source_raw_payloads
      (source, source_key, status_code, content_type, payload_bytes, checksum, payload_preview)
    VALUES
      (@source, @source_key, @status_code, @content_type, @payload_bytes, @checksum, @payload_preview)
  `).run({
    source: payload.source,
    source_key: payload.source_key,
    status_code: payload.status_code ?? null,
    content_type: payload.content_type ?? null,
    payload_bytes: payload.payload_bytes ?? 0,
    checksum: payload.checksum ?? null,
    payload_preview: payload.payload_preview?.slice(0, 1000) ?? null,
  });
}

export function updateProjectLiveMetadata(projectId: string, data: {
  name?: string | null;
  blurb?: string | null;
  state?: string | null;
  created_at?: number | null;
  launched_at?: number | null;
  deadline?: number | null;
  goal_usd?: number | null;
  pledged_usd?: number | null;
  backers_count?: number | null;
  creator_name?: string | null;
  creator_slug?: string | null;
  creator_url?: string | null;
  image_url?: string | null;
  image_thumb_url?: string | null;
}) {
  getDB().prepare(`
    UPDATE projects SET
      name = COALESCE(@name, name),
      blurb = COALESCE(@blurb, blurb),
      state = COALESCE(@state, state),
      created_at = COALESCE(@created_at, created_at),
      launched_at = COALESCE(@launched_at, launched_at),
      deadline = COALESCE(@deadline, deadline),
      goal = CASE WHEN @goal_usd IS NOT NULL THEN @goal_usd ELSE goal END,
      usd_pledged = CASE WHEN @pledged_usd IS NOT NULL THEN MAX(COALESCE(usd_pledged, 0), @pledged_usd) ELSE usd_pledged END,
      backers_count = CASE WHEN @backers_count IS NOT NULL THEN MAX(COALESCE(backers_count, 0), @backers_count) ELSE backers_count END,
      creator_name = COALESCE(@creator_name, creator_name),
      creator_slug = COALESCE(@creator_slug, creator_slug),
      creator_url = COALESCE(@creator_url, creator_url),
      image_url = COALESCE(@image_url, image_url),
      image_thumb_url = COALESCE(@image_thumb_url, image_thumb_url),
      last_seen_at = unixepoch()
    WHERE id = @project_id
  `).run({
    project_id: projectId,
    name: data.name ?? null,
    blurb: data.blurb ?? null,
    state: data.state ?? null,
    created_at: data.created_at ?? null,
    launched_at: data.launched_at ?? null,
    deadline: data.deadline ?? null,
    goal_usd: data.goal_usd ?? null,
    pledged_usd: data.pledged_usd ?? null,
    backers_count: data.backers_count ?? null,
    creator_name: data.creator_name ?? null,
    creator_slug: data.creator_slug ?? null,
    creator_url: data.creator_url ?? null,
    image_url: data.image_url ?? null,
    image_thumb_url: data.image_thumb_url ?? null,
  });
}

export const DEFAULT_NAV_ITEMS = [
  'dashboard',
  'projects',
  'leaderboard',
  'awards',
  'live-intel',
  'analysis',
  'predict',
  'favorites',
  'data-quality',
  'admin-users',
  'admin-updates',
  'admin-nav',
] as const;

export type NavKey = typeof DEFAULT_NAV_ITEMS[number];

const ADMIN_ONLY_NAV_ITEMS = new Set<NavKey>([
  'data-quality',
  'admin-users',
  'admin-updates',
  'admin-nav',
]);

export function ensureDefaultNavSettings() {
  const db = getDB();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO nav_settings (nav_key, sort_order, admin_visible, user_visible)
    VALUES (@nav_key, @sort_order, @admin_visible, @user_visible)
  `);
  const tx = db.transaction(() => {
    DEFAULT_NAV_ITEMS.forEach((key, index) => {
      const adminOnly = ADMIN_ONLY_NAV_ITEMS.has(key);
      const hiddenByDefault = key === 'dashboard';
      stmt.run({
        nav_key: key,
        sort_order: index,
        admin_visible: hiddenByDefault ? 0 : 1,
        user_visible: adminOnly || hiddenByDefault ? 0 : 1,
      });
    });
    db.prepare(`
      UPDATE nav_settings
      SET user_visible = 0
      WHERE nav_key IN ('data-quality', 'admin-users', 'admin-updates', 'admin-nav')
    `).run();
    // Obsolete: the standalone "数据同步" page was merged into data-quality.
    db.prepare(`DELETE FROM nav_settings WHERE nav_key = 'settings'`).run();
  });
  tx();
}

export function getNavSettings(role: 'admin' | 'user' = 'user') {
  ensureDefaultNavSettings();
  const visibleCol = role === 'admin' ? 'admin_visible' : 'user_visible';
  return getDB().prepare(`
    SELECT nav_key, sort_order, admin_visible, user_visible
    FROM nav_settings
    WHERE ${visibleCol} = 1
    ORDER BY sort_order ASC
  `).all();
}

export function getAllNavSettings() {
  ensureDefaultNavSettings();
  return getDB().prepare(`
    SELECT nav_key, sort_order, admin_visible, user_visible
    FROM nav_settings
    ORDER BY sort_order ASC
  `).all();
}

export function updateNavSettings(items: { nav_key: string; sort_order: number; admin_visible: number; user_visible: number }[]) {
  ensureDefaultNavSettings();
  const allowed = new Set(DEFAULT_NAV_ITEMS);
  const stmt = getDB().prepare(`
    UPDATE nav_settings
    SET sort_order = @sort_order,
        admin_visible = @admin_visible,
        user_visible = @user_visible,
        updated_at = unixepoch()
    WHERE nav_key = @nav_key
  `);
  const tx = getDB().transaction(() => {
    for (const item of items) {
      if (!allowed.has(item.nav_key as NavKey)) continue;
      const adminOnly = ADMIN_ONLY_NAV_ITEMS.has(item.nav_key as NavKey);
      stmt.run({
        nav_key: item.nav_key,
        sort_order: item.sort_order,
        admin_visible: item.admin_visible ? 1 : 0,
        user_visible: adminOnly ? 0 : (item.user_visible ? 1 : 0),
      });
    }
  });
  tx();
}

export function getUserAdminDashboard() {
  const db = getDB();
  ensureRuntimeMigrations(db);
  const summary = db.prepare(`
    SELECT
      COUNT(*) as total_users,
      SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
      SUM(CASE WHEN role != 'admin' OR role IS NULL THEN 1 ELSE 0 END) as normal_users,
      SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified_users
    FROM users
  `).get();
  const users = db.prepare(`
    SELECT
      u.id, u.username, u.email, COALESCE(u.role, 'user') as role, u.email_verified, u.created_at,
      COUNT(DISTINCT f.project_id) as favorites_count,
      COUNT(DISTINCT s.project_id) as subscriptions_count,
      MAX(sess.expires_at) as session_expires_at
    FROM users u
    LEFT JOIN favorites f ON f.user_id = u.id
    LEFT JOIN user_project_subscriptions s ON s.user_id = u.id AND s.is_tracking = 1
    LEFT JOIN sessions sess ON sess.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC, u.id DESC
  `).all();
  return { summary, users };
}

export function updateUserRole(userId: number, role: 'admin' | 'user') {
  getDB().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

function adminHashPassword(password: string) {
  return createHash('sha256').update('ks:' + password).digest('hex');
}

export function adminCreateUser(input: {
  username: string;
  email?: string | null;
  password: string;
  role?: 'admin' | 'user';
  email_verified?: number;
}) {
  const db = getDB();
  const result = db.prepare(`
    INSERT INTO users (username, email, password_hash, email_verified, role)
    VALUES (@username, @email, @password_hash, @email_verified, @role)
  `).run({
    username: input.username.trim(),
    email: input.email?.trim().toLowerCase() || null,
    password_hash: adminHashPassword(input.password),
    email_verified: input.email_verified ? 1 : 0,
    role: input.role ?? 'user',
  });
  return Number(result.lastInsertRowid);
}

export function adminUpdateUser(input: {
  id: number;
  username?: string;
  email?: string | null;
  password?: string;
  role?: 'admin' | 'user';
  email_verified?: number;
}) {
  const fields: string[] = [];
  const params: Record<string, unknown> = { id: input.id };
  if (input.username !== undefined) { fields.push('username = @username'); params.username = input.username.trim(); }
  if (input.email !== undefined) { fields.push('email = @email'); params.email = input.email?.trim().toLowerCase() || null; }
  if (input.password) { fields.push('password_hash = @password_hash'); params.password_hash = adminHashPassword(input.password); }
  if (input.role) { fields.push('role = @role'); params.role = input.role; }
  if (input.email_verified !== undefined) { fields.push('email_verified = @email_verified'); params.email_verified = input.email_verified ? 1 : 0; }
  if (!fields.length) return;
  getDB().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`).run(params);
}

export function adminDeleteUser(userId: number) {
  const db = getDB();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_project_subscriptions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM announcement_events WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();
}

export interface AnnouncementInput {
  id?: number;
  title: string;
  body: string;
  image_url?: string | null;
  cta_label?: string | null;
  cta_url?: string | null;
  audience?: 'all' | 'new_users';
  frequency?: 'daily' | 'once' | 'always';
  active?: number;
  start_at?: number | null;
  end_at?: number | null;
}

export function listAnnouncements() {
  return getDB().prepare(`
    SELECT
      a.*,
      COUNT(CASE WHEN e.event_type = 'view' THEN 1 END) as views,
      COUNT(CASE WHEN e.event_type = 'click' THEN 1 END) as clicks,
      COUNT(CASE WHEN e.event_type = 'dismiss' THEN 1 END) as dismissals,
      ROUND(AVG(CASE WHEN e.duration_ms > 0 THEN e.duration_ms END), 0) as avg_duration_ms
    FROM announcements a
    LEFT JOIN announcement_events e ON e.announcement_id = a.id
    GROUP BY a.id
    ORDER BY a.updated_at DESC, a.id DESC
  `).all();
}

export function saveAnnouncement(input: AnnouncementInput) {
  const db = getDB();
  const payload = {
    title: input.title.trim(),
    body: input.body.trim(),
    image_url: input.image_url?.trim() || null,
    cta_label: input.cta_label?.trim() || null,
    cta_url: input.cta_url?.trim() || null,
    audience: input.audience ?? 'all',
    frequency: input.frequency ?? 'daily',
    active: input.active ? 1 : 0,
    start_at: input.start_at ?? null,
    end_at: input.end_at ?? null,
  };
  if (input.id) {
    db.prepare(`
      UPDATE announcements
      SET title=@title, body=@body, image_url=@image_url, cta_label=@cta_label, cta_url=@cta_url,
          audience=@audience, frequency=@frequency, active=@active, start_at=@start_at, end_at=@end_at,
          updated_at=unixepoch()
      WHERE id=@id
    `).run({ ...payload, id: input.id });
    return input.id;
  }
  const result = db.prepare(`
    INSERT INTO announcements
      (title, body, image_url, cta_label, cta_url, audience, frequency, active, start_at, end_at)
    VALUES
      (@title, @body, @image_url, @cta_label, @cta_url, @audience, @frequency, @active, @start_at, @end_at)
  `).run(payload);
  return Number(result.lastInsertRowid);
}

export function deleteAnnouncement(id: number) {
  getDB().prepare('DELETE FROM announcements WHERE id = ?').run(id);
}

export function getActiveAnnouncementForUser(userId?: number | null) {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const user = userId
    ? db.prepare('SELECT id, created_at FROM users WHERE id = ?').get(userId) as { id: number; created_at: number } | undefined
    : undefined;
  const rows = db.prepare(`
    SELECT *
    FROM announcements
    WHERE active = 1
      AND (start_at IS NULL OR start_at <= @now)
      AND (end_at IS NULL OR end_at >= @now)
    ORDER BY audience = 'new_users' DESC, updated_at DESC, id DESC
    LIMIT 10
  `).all({ now }) as Array<Record<string, unknown> & { id: number; audience: string; frequency: string; created_at: number }>;
  for (const row of rows) {
    if (row.audience === 'new_users') {
      if (!user) continue;
      if (Number(user.created_at ?? 0) < Number(row.created_at ?? 0)) continue;
    }
    const seen = db.prepare(`
      SELECT 1 FROM announcement_events
      WHERE announcement_id = @id
        AND user_id ${userId ? '= @userId' : 'IS NULL'}
        AND event_type IN ('view', 'dismiss')
        ${row.frequency === 'daily' ? 'AND created_at >= @todayStart' : row.frequency === 'once' ? '' : 'AND 0'}
      LIMIT 1
    `).get({ id: row.id, userId, todayStart });
    if (row.frequency !== 'always' && seen) continue;
    return row;
  }
  return null;
}

export function recordAnnouncementEvent(input: { announcementId: number; userId?: number | null; eventType: 'view' | 'dismiss' | 'click'; durationMs?: number }) {
  getDB().prepare(`
    INSERT INTO announcement_events (announcement_id, user_id, event_type, duration_ms)
    VALUES (@announcementId, @userId, @eventType, @durationMs)
  `).run({
    announcementId: input.announcementId,
    userId: input.userId ?? null,
    eventType: input.eventType,
    durationMs: Math.max(0, Math.floor(input.durationMs ?? 0)),
  });
}

// ─── Auto-generated push rules ──────────────────────────────────────────────

export interface PushRule {
  segment: PushSegment;
  template: PushTemplate;
  enabled: number;
  frequency: PushFrequency;
  config: PushRuleConfig;
  updated_at?: number;
  views?: number;
  clicks?: number;
  dismissals?: number;
  avg_duration_ms?: number | null;
}

function parsePushConfig(segment: PushSegment, raw: unknown): PushRuleConfig {
  let parsed: Partial<PushRuleConfig> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { parsed = JSON.parse(raw) as Partial<PushRuleConfig>; } catch { /* fall back to defaults */ }
  }
  return { ...DEFAULT_PUSH_CONFIG[segment], ...parsed };
}

export function listPushRules(): PushRule[] {
  const rows = getDB().prepare(`
    SELECT r.segment, r.template, r.enabled, r.frequency, r.config_json, r.updated_at,
      (SELECT COUNT(*) FROM push_events e WHERE e.segment = r.segment AND e.event_type = 'view') as views,
      (SELECT COUNT(*) FROM push_events e WHERE e.segment = r.segment AND e.event_type = 'click') as clicks,
      (SELECT COUNT(*) FROM push_events e WHERE e.segment = r.segment AND e.event_type = 'dismiss') as dismissals,
      (SELECT AVG(duration_ms) FROM push_events e WHERE e.segment = r.segment AND e.event_type IN ('dismiss','click')) as avg_duration_ms
    FROM push_rules r
    ORDER BY CASE r.segment WHEN 'favorites' THEN 0 WHEN 'digest' THEN 1 ELSE 2 END
  `).all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    segment: r.segment as PushSegment,
    template: r.template as PushTemplate,
    enabled: Number(r.enabled ?? 0),
    frequency: (r.frequency as PushFrequency) ?? 'daily',
    config: parsePushConfig(r.segment as PushSegment, r.config_json),
    updated_at: Number(r.updated_at ?? 0),
    views: Number(r.views ?? 0),
    clicks: Number(r.clicks ?? 0),
    dismissals: Number(r.dismissals ?? 0),
    avg_duration_ms: r.avg_duration_ms == null ? null : Number(r.avg_duration_ms),
  }));
}

export function getPushRule(segment: PushSegment): PushRule | null {
  return listPushRules().find(r => r.segment === segment) ?? null;
}

export function savePushRule(input: { segment: PushSegment; enabled?: number; frequency?: PushFrequency; config?: PushRuleConfig }): void {
  const existing = getPushRule(input.segment);
  if (!existing) return;
  const mergedConfig = { ...existing.config, ...(input.config ?? {}) };
  getDB().prepare(`
    UPDATE push_rules
    SET enabled = @enabled, frequency = @frequency, config_json = @config, updated_at = unixepoch()
    WHERE segment = @segment
  `).run({
    segment: input.segment,
    enabled: input.enabled == null ? existing.enabled : (input.enabled ? 1 : 0),
    frequency: input.frequency ?? existing.frequency,
    config: JSON.stringify(mergedConfig),
  });
}

export function recordPushEvent(input: { segment: PushSegment; userId?: number | null; eventType: 'view' | 'dismiss' | 'click'; durationMs?: number }): void {
  getDB().prepare(`
    INSERT INTO push_events (segment, user_id, event_type, duration_ms)
    VALUES (@segment, @userId, @eventType, @durationMs)
  `).run({
    segment: input.segment,
    userId: input.userId ?? null,
    eventType: input.eventType,
    durationMs: Math.max(0, Math.floor(input.durationMs ?? 0)),
  });
}

/**
 * Frequency gate: has this user already seen this segment's push within the
 * window implied by `frequency`? Mirrors the announcement logic.
 */
export function hasSeenPush(segment: PushSegment, userId: number | null | undefined, frequency: PushFrequency): boolean {
  if (frequency === 'always') return false;
  const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const row = getDB().prepare(`
    SELECT 1 FROM push_events
    WHERE segment = @segment
      AND user_id ${userId ? '= @userId' : 'IS NULL'}
      AND event_type IN ('view', 'dismiss')
      ${frequency === 'daily' ? 'AND created_at >= @todayStart' : ''}
    LIMIT 1
  `).get({ segment, userId: userId ?? null, todayStart });
  return Boolean(row);
}

export function getUserCreatedAt(userId: number): number | null {
  const row = getDB().prepare('SELECT created_at FROM users WHERE id = ?').get(userId) as { created_at: number } | undefined;
  return row ? Number(row.created_at ?? 0) : null;
}

/**
 * Live 24h/6h deltas for a specific set of projects (used to build a user's
 * favorites digest). Reuses the same snapshot CTE as live-intel.
 */
export function getLiveDeltasForProjects(projectIds: string[]) {
  const ids = projectIds.slice(0, 50);
  if (!ids.length) return [] as Array<Record<string, unknown>>;
  const { db, baseCte, selectProject, params } = liveIntelBase(ids.length, {});
  const placeholders = ids.map((_, i) => `@pid${i}`).join(', ');
  const idParams = Object.fromEntries(ids.map((id, i) => [`pid${i}`, id]));
  return db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE id IN (${placeholders})
    ORDER BY pledged_delta_24h DESC, backers_delta_24h DESC, pledged_usd DESC
  `).all({ ...params, ...idParams }) as Array<Record<string, unknown>>;
}

export async function getLastSync() {
  return getDB().prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 1`).get() ?? null;
}

export async function getSyncHistory() {
  return getDB().prepare(`SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10`).all();
}

export async function getProjectCount(): Promise<number> {
  return swrCached('projectCount', 60_000, () => {
    const row = getDB().prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number };
    return row?.c ?? 0;
  });
}

export function getLandingData() {
  return swrCached('landingData', 120_000, computeLandingData);
}

function computeLandingData() {
  const db = getDB();
  const yearStart = Math.floor(new Date('2026-01-01T00:00:00').getTime() / 1000);
  const yearEnd = Math.floor(new Date('2026-12-31T23:59:59').getTime() / 1000);
  const monthAgo = Math.floor(Date.now() / 1000) - 30 * 86400;
  const select = `
    WITH ${LATEST_SNAPSHOT_CTE}
    SELECT p.id, p.name, p.blurb, p.state, p.category_parent, p.category_name, p.country,
           ${EFFECTIVE_PLEDGED} AS usd_pledged, ${EFFECTIVE_BACKERS} AS backers_count,
           p.goal, p.launched_at, p.source_url, p.image_url, p.image_thumb_url
    FROM projects p
    LEFT JOIN latest_snap_effective l ON l.project_id = p.id
  `;
  const top2026 = db.prepare(`
    ${select}
    WHERE p.launched_at BETWEEN @yearStart AND @yearEnd
    ORDER BY usd_pledged DESC, backers_count DESC
    LIMIT 3
  `).all({ yearStart, yearEnd });
  const latestMonth = db.prepare(`
    ${select}
    WHERE p.launched_at >= @monthAgo
      AND COALESCE(p.usd_pledged, 0) > 0
    ORDER BY usd_pledged DESC, backers_count DESC
    LIMIT 5
  `).all({ monthAgo });
  const topPledged = db.prepare(`
    ${select}
    ORDER BY usd_pledged DESC, backers_count DESC
    LIMIT 5
  `).all();
  return { top2026, latestMonth, topPledged };
}

export function getDataQualityReport() {
  return swrCached('dataQualityReport', 20_000, computeDataQualityReport);
}

function computeDataQualityReport() {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const sixHoursAgo = now - 6 * 3600;
  const dayAgo = now - 24 * 3600;

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_projects,
      SUM(CASE WHEN state = 'live' THEN 1 ELSE 0 END) as live_projects,
      SUM(CASE WHEN first_seen_at >= @dayAgo THEN 1 ELSE 0 END) as new_projects_24h,
      SUM(CASE WHEN data_source LIKE '%webrobots%' THEN 1 ELSE 0 END) as webrobots_projects,
      SUM(CASE WHEN data_source LIKE '%ks_live%' THEN 1 ELSE 0 END) as ks_live_projects,
      SUM(CASE WHEN data_source LIKE '%kicktraq%' THEN 1 ELSE 0 END) as kicktraq_projects,
      SUM(CASE WHEN source_url IS NULL OR source_url = '' THEN 1 ELSE 0 END) as missing_source_url,
      SUM(CASE WHEN creator_slug IS NULL OR creator_slug = '' OR slug IS NULL OR slug = '' THEN 1 ELSE 0 END) as missing_slug,
      SUM(CASE WHEN launched_at IS NULL THEN 1 ELSE 0 END) as missing_launch_date
    FROM projects
  `).get({ dayAgo }) as Record<string, number | null>;

  // Bound by @now everywhere: Kicktraq history imports can carry future-dated
  // points (campaign days up to the deadline), which must not be treated as the
  // "latest" real snapshot or count toward freshness.
  const snapshots = db.prepare(`
    SELECT
      COUNT(*) as total_snapshots,
      SUM(CASE WHEN captured_at >= @dayAgo AND captured_at <= @now THEN 1 ELSE 0 END) as snapshots_24h,
      COUNT(DISTINCT project_id) as projects_with_snapshots,
      MAX(CASE WHEN captured_at <= @now THEN captured_at END) as latest_snapshot_at
    FROM project_snapshots
  `).get({ dayAgo, now }) as Record<string, number | null>;

  const staleLive = db.prepare(`
    SELECT COUNT(*) as c
    FROM projects p
    LEFT JOIN (
      SELECT project_id, MAX(captured_at) as last_snapshot_at
      FROM project_snapshots
      WHERE captured_at <= @now
      GROUP BY project_id
    ) s ON s.project_id = p.id
    WHERE p.state = 'live'
      AND (s.last_snapshot_at IS NULL OR s.last_snapshot_at < @sixHoursAgo)
  `).get({ sixHoursAgo, now }) as { c: number };

  const liveTracking = db.prepare(`
    SELECT
      COUNT(*) as live_trackable,
      SUM(CASE WHEN t.project_id IS NOT NULL AND t.is_tracking = 1 THEN 1 ELSE 0 END) as auto_tracked_live,
      SUM(CASE WHEN (t.project_id IS NULL OR t.is_tracking = 0) THEN 1 ELSE 0 END) as untracked_live
    FROM projects p
    LEFT JOIN tracking_settings t ON t.project_id = p.id
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as Record<string, number | null>;

  // due_projects mirrors getDueProjects(): only live, tracking-enabled projects
  // whose next_fetch has passed — so it's always a subset of auto_tracked_live.
  const tracking = db.prepare(`
    SELECT
      COUNT(*) as tracked_projects,
      SUM(CASE WHEN p.state = 'live' AND (t.next_fetch IS NULL OR t.next_fetch <= @now) THEN 1 ELSE 0 END) as due_projects
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1
  `).get({ now }) as Record<string, number | null>;

  // Distribution of when the live tracked projects are next scheduled to be
  // fetched — so the UI can show "what's queued and when".
  const scheduleBuckets = db.prepare(`
    SELECT
      SUM(CASE WHEN t.next_fetch IS NULL OR t.next_fetch <= @now THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN t.next_fetch > @now AND t.next_fetch <= @now + 3600 THEN 1 ELSE 0 END) as within1h,
      SUM(CASE WHEN t.next_fetch > @now + 3600 AND t.next_fetch <= @now + 6 * 3600 THEN 1 ELSE 0 END) as within6h,
      SUM(CASE WHEN t.next_fetch > @now + 6 * 3600 AND t.next_fetch <= @now + 24 * 3600 THEN 1 ELSE 0 END) as within24h,
      SUM(CASE WHEN t.next_fetch > @now + 24 * 3600 THEN 1 ELSE 0 END) as beyond24h
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1 AND p.state = 'live'
  `).get({ now }) as Record<string, number | null>;

  const upcomingFetches = db.prepare(`
    SELECT p.id, p.name, p.state, t.last_fetched, t.next_fetch,
           COALESCE(t.consecutive_failures, 0) as consecutive_failures
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1 AND p.state = 'live'
    ORDER BY COALESCE(t.next_fetch, 0) ASC, t.priority DESC
    LIMIT 12
  `).all() as Record<string, unknown>[];

  const recentRuns = db.prepare(`
    SELECT id, source, job_type, status, started_at, completed_at,
           discovered_count, imported_count, snapshot_count, page_count,
           blocked_count, error_count, message
    FROM crawl_runs
    ORDER BY started_at DESC, id DESC
    LIMIT 12
  `).all();

  const sourceHealth = db.prepare(`
    SELECT
      source,
      COUNT(*) as runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      MAX(started_at) as last_started_at,
      MAX(completed_at) as last_completed_at,
      SUM(discovered_count) as discovered_count,
      SUM(imported_count) as imported_count,
      SUM(snapshot_count) as snapshot_count
    FROM crawl_runs
    GROUP BY source
    ORDER BY last_started_at DESC
  `).all();

  const recentErrors = db.prepare(`
    SELECT id, source, job_type, project_id, url, status_code, message,
           COALESCE(last_occurred_at, occurred_at) as occurred_at,
           COALESCE(occurrence_count, 1) as occurrence_count
    FROM crawler_errors
    ORDER BY COALESCE(last_occurred_at, occurred_at) DESC, id DESC
    LIMIT 10
  `).all();

  const recentKsLiveProjects = db.prepare(`
    SELECT
      id,
      name,
      state,
      category_parent,
      category_name,
      country,
      usd_pledged,
      backers_count,
      image_thumb_url,
      image_url,
      source_url,
      ks_live_synced_at,
      first_seen_at
    FROM projects
    WHERE data_source LIKE '%ks_live%'
       OR ks_live_synced_at IS NOT NULL
    ORDER BY COALESCE(ks_live_synced_at, first_seen_at, last_seen_at, 0) DESC
    LIMIT 20
  `).all();

  const syncSources = db.prepare(`
    SELECT
      CASE
        WHEN url LIKE 'ks_live:%' THEN 'ks_live'
        WHEN url LIKE 'kicktraq_active:%' THEN 'kicktraq_active'
        WHEN url LIKE 'kicktraq_full_scan:%' THEN 'kicktraq_full_scan'
        ELSE 'webrobots'
      END as source,
      COUNT(*) as runs,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      MAX(completed_at) as last_completed_at,
      SUM(COALESCE(records_imported, 0)) as records_imported
    FROM sync_logs
    GROUP BY source
    ORDER BY last_completed_at DESC
  `).all();

  let diagnostics: DiagnosticsReport | null = null;
  try {
    diagnostics = getDiagnosticsReport();
  } catch (err) {
    console.error('[db] getDiagnosticsReport failed:', err);
  }

  const report = {
    generatedAt: now,
    totals: {
      totalProjects: Number(totals.total_projects ?? 0),
      liveProjects: Number(totals.live_projects ?? 0),
      newProjects24h: Number(totals.new_projects_24h ?? 0),
      webrobotsProjects: Number(totals.webrobots_projects ?? 0),
      ksLiveProjects: Number(totals.ks_live_projects ?? 0),
      kicktraqProjects: Number(totals.kicktraq_projects ?? 0),
      missingSourceUrl: Number(totals.missing_source_url ?? 0),
      missingSlug: Number(totals.missing_slug ?? 0),
      missingLaunchDate: Number(totals.missing_launch_date ?? 0),
    },
    snapshots: {
      totalSnapshots: Number(snapshots.total_snapshots ?? 0),
      snapshots24h: Number(snapshots.snapshots_24h ?? 0),
      projectsWithSnapshots: Number(snapshots.projects_with_snapshots ?? 0),
      latestSnapshotAt: snapshots.latest_snapshot_at ?? null,
      staleLiveProjects: staleLive.c ?? 0,
    },
    tracking: {
      trackedProjects: Number(tracking.tracked_projects ?? 0),
      dueProjects: Number(tracking.due_projects ?? 0),
      liveTrackable: Number(liveTracking.live_trackable ?? 0),
      autoTrackedLive: Number(liveTracking.auto_tracked_live ?? 0),
      untrackedLive: Number(liveTracking.untracked_live ?? 0),
      // live projects we can't build a Kickstarter fetch URL for (no usable
      // project URL and no creator/slug), so they can't be put on the schedule.
      untrackableLive: Math.max(0, Number(totals.live_projects ?? 0) - Number(liveTracking.live_trackable ?? 0)),
    },
    schedule: {
      overdue: Number(scheduleBuckets.overdue ?? 0),
      within1h: Number(scheduleBuckets.within1h ?? 0),
      within6h: Number(scheduleBuckets.within6h ?? 0),
      within24h: Number(scheduleBuckets.within24h ?? 0),
      beyond24h: Number(scheduleBuckets.beyond24h ?? 0),
      batchSize: Number(process.env.TRACKER_BATCH_SIZE ?? 60),
      concurrency: Math.max(1, Number(process.env.TRACKER_CONCURRENCY ?? 6)),
      cycleSeconds: 5 * 60,
      upcoming: upcomingFetches.map(r => ({
        id: String(r.id),
        name: (r.name as string) ?? '',
        state: (r.state as string) ?? '',
        lastFetched: r.last_fetched != null ? Number(r.last_fetched) : null,
        nextFetch: r.next_fetch != null ? Number(r.next_fetch) : null,
        consecutiveFailures: Number(r.consecutive_failures ?? 0),
      })),
    },
    sourceHealth,
    syncSources,
    recentRuns,
    recentErrors,
    recentKsLiveProjects,
    diagnostics,
  };
  return report;
}

function ensurePerformanceIndexes(db: Database) {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_projects_state_seen ON projects(state, ks_live_synced_at, first_seen_at, launched_at)',
    'CREATE INDEX IF NOT EXISTS idx_projects_data_source ON projects(data_source)',
    'CREATE INDEX IF NOT EXISTS idx_projects_creator_slug ON projects(creator_slug, slug)',
    'CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name)',
    'CREATE INDEX IF NOT EXISTS idx_snapshots_project_id ON project_snapshots(project_id, id)',
    'CREATE INDEX IF NOT EXISTS idx_snapshots_project_captured_id ON project_snapshots(project_id, captured_at, id)',
    'CREATE INDEX IF NOT EXISTS idx_rewards_project_captured_reward ON reward_snapshots(project_id, captured_at, reward_id)',
    'CREATE INDEX IF NOT EXISTS idx_crawler_errors_project_time ON crawler_errors(project_id, occurred_at, id)',
    'CREATE INDEX IF NOT EXISTS idx_collaborators_project_key ON project_collaborators(project_id, collaborator_key)',
  ];
  for (const sql of indexes) {
    try { db.exec(sql); } catch { /* table may not exist yet during first boot */ }
  }
}

export type DataWorkbenchFilter =
  | 'all'
  | 'missing_rewards'
  | 'missing_collaborators'
  | 'missing_snapshots'
  | 'webrobots_only'
  | 'kicktraq_available'
  | 'recent_errors';

export interface DataWorkbenchProject {
  id: string;
  name: string;
  state: string;
  data_source: string | null;
  source_url: string | null;
  creator_slug: string | null;
  slug: string | null;
  image_thumb_url: string | null;
  image_url: string | null;
  usd_pledged: number | null;
  backers_count: number | null;
  goal: number | null;
  currency: string | null;
  launched_at: number | null;
  deadline: number | null;
  latest_snapshot_at: number | null;
  snapshot_count: number;
  reward_count: number;
  collaborator_count: number;
  last_error_at: number | null;
  last_error: string | null;
}

export function getDataWorkbenchProjects(options: {
  filter?: DataWorkbenchFilter;
  query?: string;
  state?: string;
  minPledged?: number;
  maxPledged?: number;
  limit?: number;
  offset?: number;
} = {}) {
  const filter = options.filter ?? 'all';
  const limit = Math.max(1, Math.min(options.limit ?? 25, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const normalizedQuery = options.query?.trim() ?? '';
  const normalizedState = options.state?.trim() ?? '';
  const minPledged = Number.isFinite(options.minPledged) ? Number(options.minPledged) : null;
  const maxPledged = Number.isFinite(options.maxPledged) ? Number(options.maxPledged) : null;
  const cacheKey = JSON.stringify({ filter, query: normalizedQuery, state: normalizedState, minPledged, maxPledged, limit, offset });
  const cacheNow = Date.now();
  const cached = dataWorkbenchCache.get(cacheKey);
  if (cached && cached.expiresAt > cacheNow) return cached.value;

  const db = getDB();
  const params: Record<string, string | number> = { limit, offset };
  const where: string[] = [];

  if (normalizedQuery) {
    params.query = `%${normalizedQuery}%`;
    where.push('(p.name LIKE @query OR p.id LIKE @query OR p.creator_slug LIKE @query OR p.slug LIKE @query)');
  }
  if (normalizedState && normalizedState !== 'all') {
    params.state = normalizedState;
    where.push('p.state = @state');
  }
  if (minPledged !== null) {
    params.minPledged = minPledged;
    where.push('COALESCE(p.usd_pledged, 0) >= @minPledged');
  }
  if (maxPledged !== null) {
    params.maxPledged = maxPledged;
    where.push('COALESCE(p.usd_pledged, 0) <= @maxPledged');
  }

  if (filter === 'missing_rewards') where.push('NOT EXISTS (SELECT 1 FROM reward_snapshots rr WHERE rr.project_id = p.id)');
  if (filter === 'missing_collaborators') where.push('NOT EXISTS (SELECT 1 FROM project_collaborators pc WHERE pc.project_id = p.id)');
  if (filter === 'missing_snapshots') where.push('NOT EXISTS (SELECT 1 FROM project_snapshots ps WHERE ps.project_id = p.id)');
  if (filter === 'webrobots_only') where.push("COALESCE(p.data_source, '') = 'webrobots'");
  if (filter === 'kicktraq_available') where.push('(p.creator_slug IS NOT NULL AND p.creator_slug != "" AND p.slug IS NOT NULL AND p.slug != "")');
  if (filter === 'recent_errors') where.push('EXISTS (SELECT 1 FROM crawler_errors ce WHERE ce.project_id = p.id)');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(`
    WITH ${LATEST_SNAPSHOT_CTE},
    selected AS (
      SELECT
        p.id,
        p.name,
        -- Display state mirrors the project list: a past-deadline 'live' row is
        -- resolved to successful/failed so the workbench never shows the
        -- "已结束 + 进行中" contradiction.
        CASE
          WHEN p.deadline IS NOT NULL AND p.deadline < unixepoch() AND p.state = 'live'
            THEN CASE WHEN p.goal > 0 AND COALESCE(p.usd_pledged, 0) >= p.goal THEN 'successful' ELSE 'failed' END
          ELSE p.state
        END as state,
        p.data_source,
        p.source_url,
        p.creator_slug,
        p.slug,
        p.image_thumb_url,
        p.image_url,
        -- Same effective pledged/backers as the list & leaderboard.
        ${EFFECTIVE_PLEDGED} as usd_pledged,
        ${EFFECTIVE_BACKERS} as backers_count,
        p.goal,
        p.currency,
        p.launched_at,
        p.deadline,
        p.ks_live_synced_at,
        p.first_seen_at,
        (
          SELECT MAX(ps.captured_at)
          FROM project_snapshots ps
          WHERE ps.project_id = p.id
        ) as latest_snapshot_at,
        (
          SELECT ce.occurred_at
          FROM crawler_errors ce
          WHERE ce.project_id = p.id
          ORDER BY ce.occurred_at DESC, ce.id DESC
          LIMIT 1
        ) as last_error_at
      FROM projects p
      LEFT JOIN latest_snap_effective l ON l.project_id = p.id
      ${whereSql}
    )
    SELECT
      s.id,
      s.name,
      s.state,
      s.data_source,
      s.source_url,
      s.creator_slug,
      s.slug,
      s.image_thumb_url,
      s.image_url,
      s.usd_pledged,
      s.backers_count,
      s.goal,
      s.currency,
      s.launched_at,
      s.deadline,
      s.latest_snapshot_at,
      (
        SELECT COUNT(*)
        FROM project_snapshots ps
        WHERE ps.project_id = s.id
      ) as snapshot_count,
      (
        SELECT COUNT(DISTINCT rs.reward_id)
        FROM reward_snapshots rs
        WHERE rs.project_id = s.id
          AND rs.captured_at = (
            SELECT MAX(rs2.captured_at)
            FROM reward_snapshots rs2
            WHERE rs2.project_id = s.id
          )
      ) as reward_count,
      (
        SELECT COUNT(*)
        FROM project_collaborators pc
        WHERE pc.project_id = s.id
      ) as collaborator_count,
      s.last_error_at,
      (
        SELECT ce.message
        FROM crawler_errors ce
        WHERE ce.project_id = s.id
        ORDER BY ce.occurred_at DESC, ce.id DESC
        LIMIT 1
      ) as last_error
    FROM selected s
    ORDER BY
      CASE WHEN s.state = 'live' THEN 0 ELSE 1 END,
      COALESCE(s.last_error_at, s.latest_snapshot_at, s.ks_live_synced_at, s.first_seen_at, s.launched_at, 0) DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as DataWorkbenchProject[];

  const total = db.prepare(`
    SELECT COUNT(*) as c
    FROM projects p
    ${whereSql}
  `).get(params) as { c: number };
  const value = { rows, total: Number(total.c ?? 0), limit, offset, filter };
  dataWorkbenchCache.set(cacheKey, { expiresAt: cacheNow + 30_000, value });
  if (dataWorkbenchCache.size > 50) {
    const firstKey = dataWorkbenchCache.keys().next().value;
    if (firstKey) dataWorkbenchCache.delete(firstKey);
  }
  return value;
}

export function deleteProjectsDeep(projectIds: string[]): number {
  const ids = Array.from(new Set(projectIds.map(id => id.trim()).filter(Boolean))).slice(0, 200);
  if (!ids.length) return 0;
  const db = getDB();
  const placeholders = ids.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM project_snapshots WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM reward_snapshots WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM project_text_history WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM project_comments WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM project_collaborators WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM favorites WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM tracking_settings WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM user_project_subscriptions WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM crawler_errors WHERE project_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM kicktraq_import_debug WHERE project_id IN (${placeholders})`).run(...ids);
    const result = db.prepare(`DELETE FROM projects WHERE id IN (${placeholders})`).run(...ids);
    invalidateAnalyticsCaches();
    dataWorkbenchCache.clear();
    return Number(result.changes ?? 0);
  });
  return tx();
}

export async function getMeta(): Promise<{
  earliestDate: string | null;
  latestDate: string | null;
  totalProjects: number;
  lastSyncDate: string | null;
}> {
  const db = getDB();
  const dateRow = db.prepare(`
    SELECT
      date(MIN(launched_at), 'unixepoch') as earliest,
      date(MAX(launched_at), 'unixepoch') as latest,
      COUNT(*) as total
    FROM projects WHERE launched_at IS NOT NULL
  `).get() as { earliest: string | null; latest: string | null; total: number };

  const syncRow = db.prepare(
    `SELECT completed_at FROM sync_logs WHERE status='completed' ORDER BY id DESC LIMIT 1`
  ).get() as { completed_at: string } | undefined;

  return {
    earliestDate: dateRow?.earliest ?? null,
    latestDate: dateRow?.latest ?? null,
    totalProjects: dateRow?.total ?? 0,
    lastSyncDate: syncRow?.completed_at ? syncRow.completed_at.slice(0, 10) : null,
  };
}

function liveIntelBase(limit: number, filter: { categoryParent?: string }) {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - 24 * 3600;
  const cutoff6h = now - 6 * 3600;
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const categoryClause = filter.categoryParent ? 'AND p.category_parent = @categoryParent' : '';

  const baseCte = `
    WITH latest AS (
      SELECT project_id, MAX(captured_at) as latest_at
      FROM project_snapshots
      GROUP BY project_id
    ),
    latest_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN latest l ON l.project_id = s.project_id AND l.latest_at = s.captured_at
    ),
    prior24 AS (
      SELECT l.project_id, MAX(s.captured_at) as prior_at
      FROM latest l
      JOIN project_snapshots s ON s.project_id = l.project_id AND s.captured_at <= @cutoff24h
      GROUP BY l.project_id
    ),
    prior24_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN prior24 p ON p.project_id = s.project_id AND p.prior_at = s.captured_at
    ),
    prior6 AS (
      SELECT l.project_id, MAX(s.captured_at) as prior_at
      FROM latest l
      JOIN project_snapshots s ON s.project_id = l.project_id AND s.captured_at <= @cutoff6h
      GROUP BY l.project_id
    ),
    prior6_snap AS (
      SELECT s.*
      FROM project_snapshots s
      JOIN prior6 p ON p.project_id = s.project_id AND p.prior_at = s.captured_at
    ),
    live_rows AS (
      SELECT
        p.id, p.name, p.blurb, p.goal, p.state, p.country, p.currency,
        p.category_parent, p.category_name, p.backers_count, p.usd_pledged,
        p.launched_at, p.deadline, p.source_url, p.image_url, p.image_thumb_url,
        MAX(COALESCE(ls.pledged_usd, 0), COALESCE(p.usd_pledged, 0)) as pledged_usd,
        MAX(COALESCE(ls.backers_count, 0), COALESCE(p.backers_count, 0)) as live_backers_count,
        ls.captured_at as latest_snapshot_at,
        COALESCE(ls.state, p.state) as live_state,
        MAX(0, COALESCE(ls.pledged_usd, p.usd_pledged) - COALESCE(p24.pledged_usd, COALESCE(ls.pledged_usd, p.usd_pledged))) as pledged_delta_24h,
        MAX(0, COALESCE(ls.backers_count, p.backers_count) - COALESCE(p24.backers_count, COALESCE(ls.backers_count, p.backers_count))) as backers_delta_24h,
        MAX(0, COALESCE(ls.pledged_usd, p.usd_pledged) - COALESCE(p6.pledged_usd, COALESCE(ls.pledged_usd, p.usd_pledged))) as pledged_delta_6h,
        MAX(0, COALESCE(ls.backers_count, p.backers_count) - COALESCE(p6.backers_count, COALESCE(ls.backers_count, p.backers_count))) as backers_delta_6h,
        CASE WHEN p.goal > 0 THEN ROUND((COALESCE(ls.pledged_usd, p.usd_pledged) / p.goal) * 100, 1) ELSE 0 END as funded_pct,
        CASE
          WHEN p.deadline > @now AND p.launched_at IS NOT NULL AND p.launched_at < @now
          THEN ROUND((COALESCE(ls.pledged_usd, p.usd_pledged) / MAX(1, @now - p.launched_at)) * (p.deadline - p.launched_at), 0)
          ELSE COALESCE(ls.pledged_usd, p.usd_pledged)
        END as projected_usd
      FROM projects p
      LEFT JOIN latest_snap ls ON ls.project_id = p.id
      LEFT JOIN prior24_snap p24 ON p24.project_id = p.id
      LEFT JOIN prior6_snap p6 ON p6.project_id = p.id
      WHERE COALESCE(ls.state, p.state) = 'live'
        AND (p.deadline IS NULL OR p.deadline > @now)
        ${categoryClause}
    )
  `;

  const params = { now, cutoff24h, cutoff6h, limit: safeLimit, categoryParent: filter.categoryParent };
  const selectProject = `
    SELECT id, name, blurb, goal, state, country, currency, category_parent, category_name,
           launched_at, deadline, source_url, image_url, image_thumb_url,
           pledged_usd, live_backers_count, latest_snapshot_at,
           pledged_delta_24h, backers_delta_24h, pledged_delta_6h, backers_delta_6h,
           funded_pct, projected_usd
    FROM live_rows
  `;
  return { db, now, baseCte, selectProject, params };
}

const liveSummarySql = `
  SELECT
    COUNT(*) as live_projects,
    SUM(pledged_delta_24h) as pledged_delta_24h,
    SUM(backers_delta_24h) as backers_delta_24h,
    SUM(CASE WHEN launched_at >= @cutoff24h THEN 1 ELSE 0 END) as launched_24h,
    SUM(CASE WHEN deadline BETWEEN @now AND @now + 86400 THEN 1 ELSE 0 END) as ending_24h,
    SUM(CASE WHEN funded_pct >= 100 THEN 1 ELSE 0 END) as overfunded_projects
  FROM live_rows
`;

/**
 * Lightweight live summary for the homepage stats ticker. Runs the live CTE
 * once (instead of the 9 passes in getLiveIntel), cached for 30s.
 */
export function getLiveSummary() {
  return swrCached('liveSummary', 30_000, () => {
    const { db, now, baseCte, params } = liveIntelBase(1, {});
    const summary = db.prepare(`${baseCte} ${liveSummarySql}`).get(params);
    return { generatedAt: now, summary };
  });
}

export function getLiveIntel(limit = 12, filter: { categoryParent?: string } = {}) {
  return swrCached(`liveIntel:${limit}:${filter.categoryParent ?? ''}`, 30_000, () => computeLiveIntel(limit, filter));
}

function computeLiveIntel(limit = 12, filter: { categoryParent?: string } = {}) {
  const { db, now, baseCte, selectProject, params } = liveIntelBase(limit, filter);

  const fastestFunding = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE pledged_delta_24h > 0
    ORDER BY pledged_delta_24h DESC, pledged_usd DESC
    LIMIT @limit
  `).all(params);

  const fastestBackers = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE backers_delta_24h > 0
    ORDER BY backers_delta_24h DESC, live_backers_count DESC
    LIMIT @limit
  `).all(params);

  const newlyLaunched = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE launched_at IS NOT NULL
    ORDER BY launched_at DESC
    LIMIT @limit
  `).all(params);

  const endingSoon = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE deadline > @now
    ORDER BY deadline ASC
    LIMIT @limit
  `).all(params);

  const overfunded = db.prepare(`
    ${baseCte}
    ${selectProject}
    WHERE goal > 0 AND funded_pct >= 100
    ORDER BY funded_pct DESC, pledged_usd DESC
    LIMIT @limit
  `).all(params);

  const categories = db.prepare(`
    ${baseCte}
    SELECT
      COALESCE(category_parent, 'Uncategorized') as category,
      COUNT(*) as live_projects,
      SUM(pledged_delta_24h) as pledged_delta_24h,
      SUM(backers_delta_24h) as backers_delta_24h,
      ROUND(AVG(funded_pct), 1) as avg_funded_pct,
      SUM(CASE WHEN funded_pct >= 100 THEN 1 ELSE 0 END) as overfunded_projects
    FROM live_rows
    GROUP BY COALESCE(category_parent, 'Uncategorized')
    ORDER BY pledged_delta_24h DESC, live_projects DESC
    LIMIT 10
  `).all(params);

  const allCategories = db.prepare(`
    ${baseCte}
    SELECT DISTINCT COALESCE(category_parent, 'Uncategorized') as category
    FROM live_rows
    ORDER BY category ASC
  `).all(params);

  const summary = db.prepare(`${baseCte} ${liveSummarySql}`).get(params);

  return {
    generatedAt: now,
    summary,
    fastestFunding,
    fastestBackers,
    newlyLaunched,
    endingSoon,
    overfunded,
    categories,
    allCategories,
  };
}

export async function getProjectById(id: string) {
  // Headline pledged/backers must match the list, leaderboard and awards: take the
  // MAX of the stored project row and its latest valid snapshot so a staler kicktraq
  // value can never drag the detail page below (or above) the other surfaces.
  return getDB().prepare(
    `WITH ${LATEST_SNAPSHOT_CTE}
     SELECT p.id, p.name, p.blurb, p.state, p.country, p.country_name, p.currency,
            p.category_id, p.category_parent, p.category_name, p.goal, p.pledged,
            ${EFFECTIVE_PLEDGED} AS usd_pledged,
            ${EFFECTIVE_BACKERS} AS backers_count,
            p.staff_pick, p.created_at, p.launched_at, p.deadline,
            p.creator_name, p.creator_slug, p.creator_url, p.source_url, p.slug,
            p.image_url, p.image_thumb_url
     FROM projects p
     LEFT JOIN latest_snap_effective l ON l.project_id = p.id
     WHERE p.id = ?`
  ).get(id) ?? null;
}

/**
 * Look up a project by creator_slug + project_slug.
 * Used to deduplicate Kicktraq-sourced projects against webrobots/KS-live records.
 * Returns the canonical numeric KS id if found, null otherwise.
 */
export function getProjectIdBySlug(creatorSlug: string, projectSlug: string): string | null {
  const db = getDB();
  const exact = db.prepare(
    `SELECT id FROM projects
     WHERE creator_slug = ? AND slug = ?
       AND id NOT LIKE 'kt:%'
     LIMIT 1`
  ).get(creatorSlug, projectSlug) as { id: string } | null;
  if (exact?.id) return exact.id;

  const fallbackRows = db.prepare(
    `SELECT id FROM projects
     WHERE slug = ?
       AND id NOT LIKE 'kt:%'
     ORDER BY usd_pledged DESC, backers_count DESC
     LIMIT 2`
  ).all(projectSlug) as { id: string }[];
  return fallbackRows.length === 1 ? fallbackRows[0].id : null;
}

/**
 * Merge a Kicktraq-sourced project into an existing canonical project.
 * Updates fields that webrobots/KS-live may have left null, and marks data_source.
 */
export function mergeKicktraqIntoProject(canonicalId: string, ktData: {
  backers_count?: number;
  pledged_usd?: number | null;
  launched_at?: number | null;
  deadline?: number | null;
  category_parent?: string | null;
  category_name?: string | null;
}) {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    UPDATE projects SET
      backers_count = MAX(backers_count, @backers_count),
      usd_pledged   = MAX(
                        COALESCE(usd_pledged, 0),
                        CASE WHEN @pledged_usd IS NOT NULL AND @pledged_usd > 0 THEN @pledged_usd ELSE 0 END
                      ),
      launched_at   = COALESCE(launched_at, @launched_at),
      deadline      = COALESCE(deadline, @deadline),
      category_parent = COALESCE(category_parent, @category_parent),
      category_name   = COALESCE(category_name, @category_name),
      last_seen_at  = @now,
      data_source   = CASE
        WHEN instr(data_source, 'kicktraq') > 0 THEN data_source
        ELSE data_source || ',kicktraq'
      END
    WHERE id = @id
  `).run({
    id: canonicalId,
    backers_count: ktData.backers_count ?? 0,
    pledged_usd: ktData.pledged_usd ?? null,
    launched_at: ktData.launched_at ?? null,
    deadline: ktData.deadline ?? null,
    category_parent: ktData.category_parent ?? null,
    category_name: ktData.category_name ?? null,
    now,
  });
}

export interface TrackingSettings {
  project_id: string;
  is_tracking: number;
  track_rewards: number;
  track_comments: number;
  analyze_comments: number;
  track_text_diff: number;
  priority: number;
  subscriber_count: number;
  priority_score: number;
  last_fetched: number | null;
  next_fetch: number | null;
  consecutive_failures: number;
  last_failure_at: number | null;
  created_at: number;
}

export interface UserProjectSubscription {
  user_id: number;
  project_id: string;
  is_tracking: number;
  track_rewards: number;
  track_comments: number;
  analyze_comments: number;
  track_text_diff: number;
  priority: number;
  created_at: number;
  updated_at: number;
}

export function getTrackingSettings(projectId: string): TrackingSettings | null {
  return getDB().prepare('SELECT * FROM tracking_settings WHERE project_id = ?').get(projectId) as TrackingSettings | null;
}

export function getUserProjectSubscription(userId: number, projectId: string): UserProjectSubscription | null {
  return getDB().prepare(
    'SELECT * FROM user_project_subscriptions WHERE user_id = ? AND project_id = ?'
  ).get(userId, projectId) as UserProjectSubscription | null;
}

export function upsertTrackingSettings(settings: Partial<TrackingSettings> & { project_id: string }) {
  const db = getDB();
  const existing = db.prepare('SELECT project_id, priority FROM tracking_settings WHERE project_id = ?').get(settings.project_id) as { project_id: string; priority: number } | null;
  if (!existing) {
    const priority = settings.priority ?? 1;
    const nextFetch = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO tracking_settings
        (project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority, subscriber_count, priority_score, next_fetch)
      VALUES (@project_id, @is_tracking, @track_rewards, @track_comments, @analyze_comments, @track_text_diff, @priority, @subscriber_count, @priority_score, @next_fetch)
    `).run({
      project_id: settings.project_id,
      is_tracking: settings.is_tracking ?? 1,
      track_rewards: settings.track_rewards ?? 0,
      track_comments: settings.track_comments ?? 0,
      analyze_comments: settings.analyze_comments ?? 0,
      track_text_diff: settings.track_text_diff ?? 1,
      priority: priority,
      subscriber_count: settings.subscriber_count ?? 0,
      priority_score: settings.priority_score ?? 0,
      next_fetch: nextFetch,
    });
  } else {
    const updates: string[] = [];
    const params: Record<string, unknown> = { project_id: settings.project_id };
    for (const [k, v] of Object.entries(settings)) {
      if (k !== 'project_id' && v !== undefined) {
        updates.push(`${k} = @${k}`);
        params[k] = v;
      }
    }
    if (updates.length) {
      db.prepare(`UPDATE tracking_settings SET ${updates.join(', ')} WHERE project_id = @project_id`).run(params);
    }
  }
}

export function upsertUserProjectSubscription(
  userId: number,
  projectId: string,
  settings: Partial<Omit<UserProjectSubscription, 'user_id' | 'project_id' | 'created_at' | 'updated_at'>> = {}
) {
  const db = getDB();
  const existing = getUserProjectSubscription(userId, projectId);
  const now = Math.floor(Date.now() / 1000);

  const next = {
    user_id: userId,
    project_id: projectId,
    is_tracking: settings.is_tracking ?? existing?.is_tracking ?? 1,
    track_rewards: settings.track_rewards ?? existing?.track_rewards ?? 0,
    track_comments: settings.track_comments ?? existing?.track_comments ?? 0,
    analyze_comments: settings.analyze_comments ?? existing?.analyze_comments ?? 0,
    track_text_diff: settings.track_text_diff ?? existing?.track_text_diff ?? 1,
    priority: settings.priority ?? existing?.priority ?? 1,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO user_project_subscriptions
      (user_id, project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority, updated_at)
    VALUES
      (@user_id, @project_id, @is_tracking, @track_rewards, @track_comments, @analyze_comments, @track_text_diff, @priority, @updated_at)
    ON CONFLICT(user_id, project_id) DO UPDATE SET
      is_tracking = excluded.is_tracking,
      track_rewards = excluded.track_rewards,
      track_comments = excluded.track_comments,
      analyze_comments = excluded.analyze_comments,
      track_text_diff = excluded.track_text_diff,
      priority = excluded.priority,
      updated_at = excluded.updated_at
  `).run(next);

  syncTrackingSettingsFromSubscriptions(projectId);
}

export function removeUserProjectSubscription(userId: number, projectId: string) {
  getDB().prepare(`
    UPDATE user_project_subscriptions
    SET is_tracking = 0, updated_at = unixepoch()
    WHERE user_id = ? AND project_id = ?
  `).run(userId, projectId);
  syncTrackingSettingsFromSubscriptions(projectId);
}

export function syncTrackingSettingsFromSubscriptions(projectId: string) {
  const db = getDB();
  const aggregate = db.prepare(`
    SELECT
      COUNT(*) as subscriber_count,
      MAX(track_rewards) as track_rewards,
      MAX(track_comments) as track_comments,
      MAX(analyze_comments) as analyze_comments,
      MAX(track_text_diff) as track_text_diff,
      MAX(priority) as priority,
      SUM(CASE WHEN priority = 2 THEN 10 ELSE 4 END) as priority_score
    FROM user_project_subscriptions
    WHERE project_id = ? AND is_tracking = 1
  `).get(projectId) as {
    subscriber_count: number;
    track_rewards: number | null;
    track_comments: number | null;
    analyze_comments: number | null;
    track_text_diff: number | null;
    priority: number | null;
    priority_score: number | null;
  };

  if (!aggregate.subscriber_count) {
    const existing = getTrackingSettings(projectId);
    if (existing) upsertTrackingSettings({ project_id: projectId, is_tracking: 0, subscriber_count: 0, priority_score: 0 });
    return;
  }

  upsertTrackingSettings({
    project_id: projectId,
    is_tracking: 1,
    track_rewards: aggregate.track_rewards ?? 0,
    track_comments: aggregate.track_comments ?? 0,
    analyze_comments: aggregate.analyze_comments ?? 0,
    track_text_diff: aggregate.track_text_diff ?? 1,
    priority: aggregate.priority ?? 1,
    subscriber_count: aggregate.subscriber_count,
    priority_score: aggregate.priority_score ?? 0,
    next_fetch: Math.floor(Date.now() / 1000),
  });
}

export function markFetched(projectId: string) {
  const now = Math.floor(Date.now() / 1000);
  const s = getDB().prepare(`
    SELECT
      t.priority,
      t.subscriber_count,
      t.priority_score,
      p.state,
      p.launched_at,
      p.deadline,
      p.usd_pledged,
      p.backers_count
    FROM tracking_settings t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.project_id = ?
  `).get(projectId) as {
    priority: number;
    subscriber_count: number;
    priority_score: number;
    state: string | null;
    launched_at: number | null;
    deadline: number | null;
    usd_pledged: number | null;
    backers_count: number | null;
  } | null;
  const score = s?.priority_score ?? 0;
  let interval = 24 * 3600;
  if ((s?.state ?? '') === 'live') {
    const launchedAt = Number(s?.launched_at ?? 0);
    const deadline = Number(s?.deadline ?? 0);
    const firstDay = launchedAt > 0 && now - launchedAt <= 24 * 3600;
    const lastTwoDays = deadline > 0 && deadline - now <= 48 * 3600;
    const hotProject = Number(s?.usd_pledged ?? 0) >= 500_000 || Number(s?.backers_count ?? 0) >= 5_000;
    interval = firstDay || lastTwoDays || s?.priority === 2 || score >= 20
      ? 3600
      : hotProject || score >= 8 || (s?.subscriber_count ?? 0) >= 2
        ? 2 * 3600
        : 24 * 3600;
  }
  getDB().prepare(
    'UPDATE tracking_settings SET last_fetched = ?, next_fetch = ?, consecutive_failures = 0, last_failure_at = NULL WHERE project_id = ?'
  ).run(now, now + interval, projectId);
}

export function recordScrapeSuccess(projectId: string, nextFetchIntervalSec: number) {
  const now = Math.floor(Date.now() / 1000);
  getDB().prepare(`
    UPDATE tracking_settings
    SET last_fetched = ?, next_fetch = ?, consecutive_failures = 0, last_failure_at = NULL
    WHERE project_id = ?
  `).run(now, now + nextFetchIntervalSec, projectId);
}

export function recordScrapeFailure(projectId: string): { consecutive_failures: number; next_fetch: number } {
  const now = Math.floor(Date.now() / 1000);
  const tx = getDB().transaction(() => {
    const row = getDB().prepare(
      'SELECT COALESCE(consecutive_failures, 0) AS consecutive_failures FROM tracking_settings WHERE project_id = ?'
    ).get(projectId) as { consecutive_failures: number } | undefined;
    const failures = (row?.consecutive_failures ?? 0) + 1;
    // Exponential backoff: 30m, 2h, 6h, 24h, then capped at 24h.
    const backoffStepsSec = [30 * 60, 2 * 3600, 6 * 3600, 24 * 3600];
    const stepIndex = Math.min(failures - 1, backoffStepsSec.length - 1);
    const nextFetch = now + backoffStepsSec[stepIndex];
    getDB().prepare(`
      UPDATE tracking_settings
      SET next_fetch = ?, consecutive_failures = ?, last_failure_at = ?, last_fetched = COALESCE(last_fetched, ?)
      WHERE project_id = ?
    `).run(nextFetch, failures, now, now, projectId);
    return { consecutive_failures: failures, next_fetch: nextFetch };
  });
  return tx();
}

export function getDueProjects(limit = 25): { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number; consecutive_failures: number }[] {
  const now = Math.floor(Date.now() / 1000);
  return getDB().prepare(`
    SELECT t.project_id, t.priority, t.track_rewards, t.track_comments, t.track_text_diff,
           COALESCE(t.consecutive_failures, 0) as consecutive_failures
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1
      AND p.state = 'live'
      AND (t.next_fetch IS NULL OR t.next_fetch <= ?)
    ORDER BY t.priority DESC, t.priority_score DESC, COALESCE(t.next_fetch, 0) ASC, t.last_fetched ASC
    LIMIT ?
  `).all(now, limit) as { project_id: string; priority: number; track_rewards: number; track_comments: number; track_text_diff: number; consecutive_failures: number }[];
}

/**
 * Step 1 of ended-project handling: make sure every tracked project whose
 * deadline has passed gets ONE more fetch *after* the deadline, so we capture
 * the authoritative final pledged/backers/state from Kickstarter (campaigns
 * often surge in the final hours — settling on a pre-deadline snapshot would
 * lose that). We do this by bumping next_fetch to now for any such project that
 * hasn't been fetched since its deadline. A normal scrape then settles the
 * state to KS's real `successful`/`failed`.
 *
 * Keyed on the deadline (not on state='live'): we now flip a project out of
 * `live` the moment its deadline passes, so keying on state would skip the very
 * projects that still need their final post-deadline data.
 *
 * Returns the number of projects queued for a final fetch.
 */
export function scheduleFinalFetchForEndedProjects(): number {
  const now = Math.floor(Date.now() / 1000);
  const res = getDB().prepare(`
    UPDATE tracking_settings
    SET next_fetch = @now
    WHERE is_tracking = 1
      AND (next_fetch IS NULL OR next_fetch > @now)
      AND project_id IN (
        SELECT t.project_id
        FROM tracking_settings t
        JOIN projects p ON p.id = t.project_id
        WHERE p.deadline IS NOT NULL
          AND p.deadline < @now
          AND (t.last_fetched IS NULL OR t.last_fetched <= p.deadline)
      )
  `).run({ now });
  return res.changes;
}

/**
 * Step 2 (safety net): correct the state of projects that are STILL `live` long
 * after their deadline — i.e. ones we couldn't fetch a final time (no usable
 * Kickstarter URL, or persistent Cloudflare/worker failures). KS marks a
 * campaign `successful` (pledged >= goal) or `failed` once it ends; we mirror
 * that so the UI badge is correct and the project leaves the live pool.
 *
 * Runs with no grace by default: a project past its deadline is never `live`,
 * matching the ingest guard and the boot migration. The Step-1 final fetch is
 * queued first each cycle and is keyed on the deadline (not on state), so a
 * project flipped here still gets its authoritative post-deadline scrape later —
 * we are not robbing fetchable projects of their final data. Set
 * ENDED_RECONCILE_GRACE_HOURS to delay the heuristic if ever needed.
 */
export function markEndedLiveProjects(graceSeconds = Number(process.env.ENDED_RECONCILE_GRACE_HOURS ?? 0) * 3600): number {
  const cutoff = Math.floor(Date.now() / 1000) - Math.max(0, graceSeconds);
  const res = getDB().prepare(`
    UPDATE projects
    SET state = CASE WHEN goal > 0 AND usd_pledged >= goal THEN 'successful' ELSE 'failed' END
    WHERE state = 'live'
      AND deadline IS NOT NULL
      AND deadline < @cutoff
  `).run({ cutoff });
  if (res.changes > 0) invalidateAnalyticsCaches();
  return res.changes;
}

export function autoTrackLiveProjects(limit = 250): { inserted: number; reactivated: number; totalTrackable: number; remaining: number } {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const jitterWindow = 2 * 3600;

  const totalRow = db.prepare(`
    SELECT COUNT(*) as c
    FROM projects p
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as { c: number };

  const candidates = db.prepare(`
    SELECT p.id, t.project_id as tracked, t.is_tracking
    FROM projects p
    LEFT JOIN tracking_settings t ON t.project_id = p.id
    WHERE p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
      AND (t.project_id IS NULL OR t.is_tracking = 0)
    ORDER BY COALESCE(p.deadline, 0) ASC, COALESCE(p.last_seen_at, 0) DESC
    LIMIT ?
  `).all(limit) as { id: string; tracked: string | null; is_tracking: number | null }[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tracking_settings
      (project_id, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff,
       priority, subscriber_count, priority_score, next_fetch)
    VALUES
      (@project_id, 1, 0, 1, 0, 1, 1, 0, 1, @next_fetch)
  `);
  const reactivate = db.prepare(`
    UPDATE tracking_settings
    SET is_tracking = 1,
        track_rewards = 0,
        track_comments = 1,
        track_text_diff = 1,
        priority = MAX(priority, 1),
        priority_score = MAX(priority_score, 1),
        next_fetch = @next_fetch
    WHERE project_id = @project_id
  `);

  let inserted = 0;
  let reactivated = 0;
  const tx = db.transaction(() => {
    candidates.forEach((project, index) => {
      const next_fetch = now + Math.floor((index / Math.max(1, candidates.length)) * jitterWindow);
      if (project.tracked) {
        reactivate.run({ project_id: project.id, next_fetch });
        reactivated++;
      } else {
        const result = insert.run({ project_id: project.id, next_fetch });
        if (result.changes) inserted++;
      }
    });
  });
  tx();

  const trackedRow = db.prepare(`
    SELECT COUNT(*) as c
    FROM tracking_settings t
    JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1
      AND p.state = 'live'
      AND (
        p.source_url LIKE 'https://www.kickstarter.com/projects/%'
        OR (p.creator_slug IS NOT NULL AND p.slug IS NOT NULL)
      )
  `).get() as { c: number };

  return {
    inserted,
    reactivated,
    totalTrackable: totalRow.c,
    remaining: Math.max(0, totalRow.c - trackedRow.c),
  };
}

export function getTrackingList(): (TrackingSettings & { name: string | null })[] {
  return getDB().prepare(`
    SELECT t.*, p.name FROM tracking_settings t
    LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.is_tracking = 1 ORDER BY t.created_at DESC
  `).all() as (TrackingSettings & { name: string | null })[];
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface Snapshot {
  captured_at: number;
  pledged_usd: number;
  backers_count: number;
  days_to_go: number;
  comments_count: number;
  updates_count: number;
  state: string;
  source: string;
}

export function insertSnapshot(snap: Omit<Snapshot, 'source'> & { project_id: string; source?: string }) {
  getDB().prepare(`
    INSERT OR IGNORE INTO project_snapshots
      (project_id, captured_at, pledged_usd, backers_count, days_to_go, comments_count, updates_count, state, source)
    VALUES (@project_id, @captured_at, @pledged_usd, @backers_count, @days_to_go, @comments_count, @updates_count, @state, @source)
  `).run({ source: 'ks', ...snap });
}

export function deleteKicktraqSnapshots(projectId: string) {
  getDB().prepare(`
    DELETE FROM project_snapshots
    WHERE project_id = ?
      AND source = 'kicktraq'
  `).run(projectId);
}

export interface KicktraqImportDebugPayload {
  ok?: boolean;
  status: 'running' | 'complete' | 'failed';
  phase?: string;
  progress?: number;
  message?: string;
  diagnostics?: unknown;
  debug?: unknown;
  structuredDays?: unknown;
  writtenSnapshots?: unknown;
  startedAt?: number;
  finishedAt?: number;
}

function parseDebugJson(value: unknown) {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function saveKicktraqImportDebug(projectId: string, entry: KicktraqImportDebugPayload) {
  getDB().prepare(`
    INSERT INTO kicktraq_import_debug
      (project_id, status, phase, progress, message, diagnostics_json, debug_json, structured_json, written_json, started_at, finished_at)
    VALUES
      (@project_id, @status, @phase, @progress, @message, @diagnostics_json, @debug_json, @structured_json, @written_json, @started_at, @finished_at)
  `).run({
    project_id: projectId,
    status: entry.status,
    phase: entry.phase ?? null,
    progress: entry.progress ?? 0,
    message: entry.message ?? null,
    diagnostics_json: entry.diagnostics ? JSON.stringify(entry.diagnostics) : null,
    debug_json: entry.debug ? JSON.stringify(entry.debug) : null,
    structured_json: entry.structuredDays ? JSON.stringify(entry.structuredDays) : null,
    written_json: entry.writtenSnapshots ? JSON.stringify(entry.writtenSnapshots) : null,
    started_at: entry.startedAt ?? null,
    finished_at: entry.finishedAt ?? null,
  });
}

export function getLatestKicktraqImportDebug(projectId: string) {
  const row = getDB().prepare(`
    SELECT *
    FROM kicktraq_import_debug
    WHERE project_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(projectId) as {
    status: 'running' | 'complete' | 'failed';
    phase: string | null;
    progress: number | null;
    message: string | null;
    diagnostics_json: string | null;
    debug_json: string | null;
    structured_json: string | null;
    written_json: string | null;
    started_at: number | null;
    finished_at: number | null;
    created_at: number;
  } | undefined;

  if (!row) return null;
  const debug = parseDebugJson(row.debug_json);
  const structuredDays = parseDebugJson(row.structured_json);
  const writtenSnapshots = parseDebugJson(row.written_json);
  return {
    ok: row.status === 'complete',
    status: row.status,
    phase: row.phase ?? undefined,
    progress: row.progress ?? undefined,
    message: row.message ?? undefined,
    diagnostics: parseDebugJson(row.diagnostics_json),
    debug,
    structuredDays,
    writtenSnapshots,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    cachedAt: row.created_at * 1000,
    persisted: true,
  };
}

export function getSnapshots(projectId: string, limitRows = 500): Snapshot[] {
  return getDB().prepare(`
    SELECT s.captured_at, s.pledged_usd, s.backers_count, s.days_to_go,
           s.comments_count, s.updates_count, s.state, s.source
    FROM project_snapshots s
    JOIN projects p ON p.id = s.project_id
    WHERE s.project_id = ?
      AND NOT (s.source = 'kicktraq_active' AND COALESCE(p.currency, 'USD') <> 'USD')
      AND NOT (
        s.source = 'ks'
        AND COALESCE(s.pledged_usd, 0) = 0
        AND COALESCE(s.backers_count, 0) = 0
        AND (
          COALESCE(p.usd_pledged, 0) > 0
          OR COALESCE(p.backers_count, 0) > 0
          OR EXISTS (
            SELECT 1 FROM project_snapshots prior
            WHERE prior.project_id = s.project_id
              AND prior.id < s.id
              AND (COALESCE(prior.pledged_usd, 0) > 0 OR COALESCE(prior.backers_count, 0) > 0)
          )
        )
      )
    ORDER BY s.captured_at ASC LIMIT ?
  `).all(projectId, limitRows) as Snapshot[];
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

export interface RewardSnapshot {
  reward_id: string;
  title: string;
  description: string;
  amount_usd: number;
  backers_count: number;
  limit_count: number | null;
  is_limited: number;
}

export function insertRewardSnapshots(projectId: string, capturedAt: number, rewards: RewardSnapshot[]) {
  const stmt = getDB().prepare(`
    INSERT INTO reward_snapshots
      (project_id, captured_at, reward_id, title, description, amount_usd, backers_count, limit_count, is_limited)
    VALUES (@project_id, @captured_at, @reward_id, @title, @description, @amount_usd, @backers_count, @limit_count, @is_limited)
  `);
  const tx = getDB().transaction(() => {
    for (const r of rewards) stmt.run({ project_id: projectId, captured_at: capturedAt, ...r });
  });
  tx();
}

export function getLatestRewards(projectId: string): RewardSnapshot[] {
  const db = getDB();
  const latest = db.prepare('SELECT MAX(captured_at) as ts FROM reward_snapshots WHERE project_id = ?').get(projectId) as { ts: number | null };
  if (!latest?.ts) return [];
  return db.prepare(`
    SELECT reward_id, title, description, amount_usd, backers_count, limit_count, is_limited
    FROM reward_snapshots WHERE project_id = ? AND captured_at = ? ORDER BY amount_usd ASC
  `).all(projectId, latest.ts) as RewardSnapshot[];
}

export interface ProjectCollaborator {
  collaborator_key: string;
  name: string;
  role: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  is_service_agency?: number;
  captured_at: number;
}

export function upsertProjectCollaborators(projectId: string, collaborators: ProjectCollaborator[]) {
  if (!collaborators.length) return;
  const stmt = getDB().prepare(`
    INSERT INTO project_collaborators
      (project_id, collaborator_key, name, role, avatar_url, profile_url, is_service_agency, captured_at)
    VALUES (@project_id, @collaborator_key, @name, @role, @avatar_url, @profile_url, @is_service_agency, @captured_at)
    ON CONFLICT(project_id, collaborator_key) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      avatar_url = excluded.avatar_url,
      profile_url = excluded.profile_url,
      is_service_agency = excluded.is_service_agency,
      captured_at = excluded.captured_at
  `);
  const tx = getDB().transaction(() => {
    for (const c of collaborators) stmt.run({ project_id: projectId, ...c, is_service_agency: c.is_service_agency ?? 0 });
    const agencies = collaborators.filter(c => c.is_service_agency).map(c => c.name).filter(Boolean);
    getDB().prepare(`
      UPDATE projects
      SET has_service_agency = @has_service_agency,
          service_agency_name = @service_agency_name
      WHERE id = @project_id
    `).run({
      project_id: projectId,
      has_service_agency: agencies.length ? 1 : 0,
      service_agency_name: agencies.length ? [...new Set(agencies)].join(', ') : null,
    });
  });
  tx();
}

export function getProjectCollaborators(projectId: string): ProjectCollaborator[] {
  return getDB().prepare(`
    SELECT collaborator_key, name, role, avatar_url, profile_url, is_service_agency, captured_at
    FROM project_collaborators
    WHERE project_id = ?
    ORDER BY is_service_agency DESC, name ASC
  `).all(projectId) as ProjectCollaborator[];
}

// ─── Text history ─────────────────────────────────────────────────────────────

export function insertTextIfChanged(projectId: string, capturedAt: number, field: string, content: string) {
  const db = getDB();
  const last = db.prepare(
    'SELECT content FROM project_text_history WHERE project_id = ? AND field = ? ORDER BY captured_at DESC LIMIT 1'
  ).get(projectId, field) as { content: string } | null;
  if (!last || last.content !== content) {
    db.prepare('INSERT OR IGNORE INTO project_text_history (project_id, captured_at, field, content) VALUES (?, ?, ?, ?)').run(projectId, capturedAt, field, content);
  }
}

export function getTextHistory(projectId: string): { field: string; captured_at: number; content: string }[] {
  return getDB().prepare(
    'SELECT field, captured_at, content FROM project_text_history WHERE project_id = ? ORDER BY field, captured_at ASC'
  ).all(projectId) as { field: string; captured_at: number; content: string }[];
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export function insertComment(c: { project_id: string; comment_id: string; author: string; content: string; posted_at: number }) {
  getDB().prepare(`
    INSERT OR IGNORE INTO project_comments (project_id, comment_id, author, content, posted_at)
    VALUES (@project_id, @comment_id, @author, @content, @posted_at)
  `).run(c);
}

export function getComments(projectId: string, limitRows = 100): { comment_id: string; author: string; content: string; posted_at: number }[] {
  return getDB().prepare(
    'SELECT comment_id, author, content, posted_at FROM project_comments WHERE project_id = ? ORDER BY posted_at DESC LIMIT ?'
  ).all(projectId, limitRows) as { comment_id: string; author: string; content: string; posted_at: number }[];
}

// ─── Similar projects ─────────────────────────────────────────────────────────

export function getSimilarProjects(projectId: string, category: string, goalUsd: number, backers: number, limit = 6): Record<string, unknown>[] {
  const low = goalUsd * 0.2;
  const high = goalUsd * 5;
  return getDB().prepare(`
    WITH ${LATEST_SNAPSHOT_CTE}
    SELECT p.id, p.name, p.blurb, p.state, p.category_parent, p.category_name,
           ${EFFECTIVE_PLEDGED} AS usd_pledged, p.goal, ${EFFECTIVE_BACKERS} AS backers_count,
           p.launched_at, p.source_url, p.slug, p.image_url, p.image_thumb_url,
           (
             CASE WHEN p.category_parent = @category THEN 40 ELSE 0 END +
             CASE WHEN p.usd_pledged BETWEEN @low AND @high THEN 30 ELSE 0 END +
             CASE WHEN ABS(p.backers_count - @backers) < @backers * 0.5 THEN 20 ELSE 0 END +
             CASE WHEN p.state = 'successful' THEN 10 ELSE 0 END
           ) as score
    FROM projects p
    LEFT JOIN latest_snap_effective l ON l.project_id = p.id
    WHERE p.id != @id AND p.goal > 0 AND p.usd_pledged > 0
    ORDER BY score DESC, usd_pledged DESC
    LIMIT @limit
  `).all({ id: projectId, category, low, high, backers, limit }) as Record<string, unknown>[];
}
