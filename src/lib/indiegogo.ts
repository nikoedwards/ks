import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import type { Database } from 'better-sqlite3';
import { openPlatformSourceDb } from './platformDb';
import { resolveUsdAmounts } from './money';

const PLATFORM_ID = 'indiegogo';
const WEBROBOTS_INDEX_URL = 'https://webrobots.io/indiegogo-dataset/';
const ACTIVE_API_URL = 'https://www.indiegogo.com/api/public/projects/getActiveCrowdfundingProjects';
const DETAIL_API_URL = 'https://www.indiegogo.com/api/public/projects/getCrowdfundingProject';

const USER_AGENT = 'Mozilla/5.0 (compatible; KicksonarIndiegogo/0.1)';
const DEFAULT_DETAIL_LIMIT = 25;
const DETAIL_DELAY_MS = Math.max(250, Number(process.env.INDIEGOGO_DETAIL_DELAY_MS ?? 1000));
const DETAIL_TIMEOUT_MS = Math.max(5000, Number(process.env.INDIEGOGO_DETAIL_TIMEOUT_MS ?? 20_000));
const WEBROBOTS_TIMEOUT_MS = Math.max(15_000, Number(process.env.INDIEGOGO_WEBROBOTS_TIMEOUT_MS ?? 120_000));

export interface IndiegogoWebrobotsDataset {
  date: string;
  runId: string;
  url: string;
}

export interface IndiegogoWebrobotsIndex {
  ok: boolean;
  datasetCount: number;
  latestDate: string | null;
  latestUrl: string | null;
  datasets: IndiegogoWebrobotsDataset[];
}

export interface IndiegogoImportOptions {
  mode?: 'latest' | 'all_available';
  maxDatasets?: number;
}

export interface IndiegogoImportResult {
  ok: boolean;
  mode: 'latest' | 'all_available';
  datasetCount: number;
  datasetsImported: number;
  datasetsSkipped: number;
  rowsRead: number;
  rowsImported: number;
  snapshots: number;
  queuedDetails: number;
  skipped: Array<{ url: string; status?: number; message: string }>;
  message?: string;
}

export interface IndiegogoActiveResult {
  ok: boolean;
  activeCount: number;
  imported: number;
  snapshots: number;
  message?: string;
}

export interface IndiegogoDetailOptions {
  limit?: number;
  staleBefore?: number;
}

export interface IndiegogoDetailResult {
  ok: boolean;
  attempted: number;
  refreshed: number;
  invalid: number;
  failed: number;
  queued: number;
  message?: string;
}

interface WebrobotsOuterRow {
  run_id?: string;
  data?: WebrobotsProject;
}

interface WebrobotsProject {
  bullet_point?: string | null;
  category?: string | null;
  category_url?: string | null;
  clickthrough_url?: string | null;
  close_date?: string | null;
  currency?: string | null;
  funds_raised_amount?: number | string | null;
  funds_raised_percent?: number | string | null;
  image_url?: string | null;
  is_indemand?: boolean | null;
  is_pre_launch?: boolean | null;
  is_promoted?: boolean | null;
  is_proven?: boolean | null;
  open_date?: string | null;
  project_id?: number | string | null;
  project_type?: string | null;
  source_url?: string | null;
  tagline?: string | null;
  tags?: string[] | null;
  title?: string | null;
}

interface ApiProject {
  backerCount?: number;
  campaignEndDate?: string | null;
  campaignGoal?: number;
  campaignStartDate?: string | null;
  commentCount?: number;
  creatorName?: string | null;
  creatorUrlName?: string | null;
  currencyShortName?: string | null;
  fundsGathered?: number;
  projectHomeUrl?: string | null;
  projectImageUrl?: string | null;
  projectName?: string | null;
  projectType?: number | string | null;
  projectUrlName?: string | null;
  rewardCount?: number;
  shortDescription?: string | null;
  updateCount?: number;
}

interface NormalizedProject {
  source_project_id: string;
  canonical_key: string | null;
  name: string;
  blurb: string | null;
  state: string;
  category: string | null;
  country: string | null;
  currency: string | null;
  goal_amount: number;
  pledged_amount: number;
  pledged_usd: number;
  backers_count: number | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string | null;
  image_url: string | null;
  raw_status: string | null;
  project_url_name: string | null;
  creator_url_name: string | null;
  project_type: string | null;
  is_indemand: number;
  is_prelaunch: number;
  percent_raised: number | null;
  comments_count: number | null;
  updates_count: number | null;
  rewards_count: number | null;
  detail_status: string | null;
  detail_fetched_at: number | null;
  webrobots_run_id: string | null;
  last_api_seen_at: number | null;
  first_seen_at: number | null;
  last_seen_at: number | null;
}

interface StoredProject extends NormalizedProject {
  captured_at: number;
  snapshot_source: 'webrobots' | 'indiegogo_active' | 'indiegogo_detail';
  queue_detail: boolean;
}

interface QueueRow {
  project_url_name: string;
  source_project_id: string | null;
  attempts: number;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function num(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function int(value: unknown): number | null {
  const parsed = Math.round(num(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, limit) : null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!raw || raw === 'FAKE_CURRENCY') return null;
  return raw.slice(0, 12);
}

function toSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : null;
}

function runIdToSeconds(runId: string | null | undefined): number {
  if (!runId) return nowSec();
  const token = runId.match(/Indiegogo_([^/]+)$/)?.[1] ?? runId;
  const iso = token.replace(/T(\d{2})_(\d{2})_(\d{2})_(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : nowSec();
}

function runIdToDate(runId: string) {
  const ts = runIdToSeconds(runId);
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function sourceUrlFromClickthrough(clickthrough: string | null): string | null {
  if (!clickthrough) return null;
  if (clickthrough.startsWith('http')) return clickthrough;
  if (clickthrough.startsWith('/')) return `https://www.indiegogo.com${clickthrough}`;
  return null;
}

function parseProjectUrlNameFromClickthrough(value: string | null): { slug: string | null; isComingSoon: boolean } {
  if (!value) return { slug: null, isComingSoon: false };
  const match = value.match(/\/projects\/([^/?#]+)/);
  const slug = match?.[1] ? decodeURIComponent(match[1]) : null;
  return { slug, isComingSoon: /\/coming_soon(?:[/?#]|$)/.test(value) };
}

function projectUrlNameFromHomeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'projects') return null;
    return parts.length >= 3 ? decodeURIComponent(parts[2]) : decodeURIComponent(parts[1] ?? '');
  } catch {
    const parts = value.split('?')[0].split('/').filter(Boolean);
    const idx = parts.indexOf('projects');
    return idx >= 0 ? decodeURIComponent(parts[idx + 2] ?? parts[idx + 1] ?? '') || null : null;
  }
}

function usdAmounts(pledgedLocal: number, goalLocal: number, currency: string | null, backers?: number | null) {
  if (!currency) return { pledgedUsd: 0, goalUsd: 0 };
  const resolved = resolveUsdAmounts({
    pledgedLocal,
    goalLocal,
    currency,
    backers: backers ?? 0,
  });
  return { pledgedUsd: resolved.pledgedUsd, goalUsd: resolved.goalUsd };
}

export function resolveIndiegogoState(input: {
  deadline?: number | null;
  goal?: number | null;
  pledged?: number | null;
  isIndemand?: boolean;
  isPrelaunch?: boolean;
  projectType?: number | string | null;
  now?: number;
}): string {
  if (input.isPrelaunch) return 'prelaunch';
  const projectType = String(input.projectType ?? '').trim();
  if (input.isIndemand || projectType === '2') return 'indemand';
  const now = input.now ?? nowSec();
  const deadline = input.deadline ?? null;
  if (deadline && deadline > now) return 'live';
  const goal = Number(input.goal ?? 0);
  const pledged = Number(input.pledged ?? 0);
  if (deadline && deadline <= now) return goal > 0 && pledged >= goal ? 'successful' : 'failed';
  return 'live';
}

function rawStatus(input: { state: string; isIndemand?: boolean; isPrelaunch?: boolean; source?: string }) {
  if (input.isPrelaunch) return 'prelaunch';
  if (input.isIndemand) return 'indemand';
  return input.source ? `${input.source}:${input.state}` : input.state;
}

export function parseWebrobotsLine(line: string): WebrobotsOuterRow | null {
  const clean = line.trim().replace(/,$/, '');
  if (!clean) return null;
  const parsed = JSON.parse(clean) as WebrobotsOuterRow;
  return parsed?.data ? parsed : null;
}

function normalizeWebrobotsRow(row: WebrobotsOuterRow): StoredProject | null {
  const data = row.data;
  if (!data) return null;
  const projectId = data.project_id == null ? null : String(data.project_id);
  const parsedPath = parseProjectUrlNameFromClickthrough(data.clickthrough_url ?? null);
  const projectUrlName = parsedPath.slug;
  if (!projectId && !projectUrlName) return null;

  const capturedAt = runIdToSeconds(row.run_id);
  const sourceProjectId = projectId ?? `slug:${projectUrlName}`;
  const currency = normalizeCurrency(data.currency);
  const pledged = num(data.funds_raised_amount);
  const percent = num(data.funds_raised_percent);
  const goal = pledged > 0 && percent > 0 ? pledged / (percent / 100) : 0;
  const launchedAt = toSeconds(data.open_date);
  const deadline = toSeconds(data.close_date);
  const isPrelaunch = Boolean(data.is_pre_launch) || parsedPath.isComingSoon || !launchedAt;
  const isIndemand = Boolean(data.is_indemand);
  const amounts = usdAmounts(pledged, goal, currency);
  const state = resolveIndiegogoState({
    deadline,
    goal,
    pledged,
    isIndemand,
    isPrelaunch,
    projectType: data.project_type,
    now: capturedAt,
  });

  return {
    source_project_id: sourceProjectId,
    canonical_key: projectUrlName ? `${PLATFORM_ID}:${projectUrlName}` : `${PLATFORM_ID}:${sourceProjectId}`,
    name: text(data.title, 500) ?? projectUrlName ?? sourceProjectId,
    blurb: text(data.tagline ?? data.bullet_point, 1000),
    state,
    category: text(data.category, 200),
    country: null,
    currency,
    goal_amount: amounts.goalUsd,
    pledged_amount: pledged,
    pledged_usd: amounts.pledgedUsd,
    backers_count: null,
    launched_at: launchedAt,
    deadline,
    source_url: sourceUrlFromClickthrough(data.clickthrough_url ?? null) ?? text(data.source_url, 1000),
    image_url: text(data.image_url, 1000),
    raw_status: rawStatus({ state, isIndemand, isPrelaunch, source: 'webrobots' }),
    project_url_name: projectUrlName,
    creator_url_name: null,
    project_type: data.project_type ? String(data.project_type) : null,
    is_indemand: isIndemand ? 1 : 0,
    is_prelaunch: isPrelaunch ? 1 : 0,
    percent_raised: percent || null,
    comments_count: null,
    updates_count: null,
    rewards_count: null,
    detail_status: null,
    detail_fetched_at: null,
    webrobots_run_id: row.run_id ?? null,
    last_api_seen_at: null,
    first_seen_at: capturedAt,
    last_seen_at: capturedAt,
    captured_at: capturedAt,
    snapshot_source: 'webrobots',
    queue_detail: Boolean(projectUrlName && !isPrelaunch),
  };
}

export function normalizeIndiegogoApiProject(project: ApiProject, existingSourceProjectId?: string | null): StoredProject | null {
  const projectUrlName = text(project.projectUrlName, 300)
    ?? projectUrlNameFromHomeUrl(project.projectHomeUrl)
    ?? null;
  if (!projectUrlName) return null;

  const now = nowSec();
  const currency = normalizeCurrency(project.currencyShortName);
  const pledged = num(project.fundsGathered);
  const goal = num(project.campaignGoal);
  const backers = int(project.backerCount) ?? 0;
  const amounts = usdAmounts(pledged, goal, currency, backers);
  const deadline = toSeconds(project.campaignEndDate);
  const launchedAt = toSeconds(project.campaignStartDate);
  const projectType = project.projectType == null ? null : String(project.projectType);
  const state = resolveIndiegogoState({
    deadline,
    goal,
    pledged,
    projectType,
    now,
  });
  const sourceProjectId = existingSourceProjectId ?? `slug:${projectUrlName}`;

  return {
    source_project_id: sourceProjectId,
    canonical_key: `${PLATFORM_ID}:${projectUrlName}`,
    name: text(project.projectName, 500) ?? projectUrlName,
    blurb: text(project.shortDescription, 1000),
    state,
    category: null,
    country: null,
    currency,
    goal_amount: amounts.goalUsd,
    pledged_amount: pledged,
    pledged_usd: amounts.pledgedUsd,
    backers_count: backers,
    launched_at: launchedAt,
    deadline,
    source_url: text(project.projectHomeUrl, 1000),
    image_url: text(project.projectImageUrl, 1000),
    raw_status: rawStatus({ state, isIndemand: projectType === '2', source: 'api' }),
    project_url_name: projectUrlName,
    creator_url_name: text(project.creatorUrlName, 300),
    project_type: projectType,
    is_indemand: projectType === '2' ? 1 : 0,
    is_prelaunch: 0,
    percent_raised: goal > 0 ? (pledged / goal) * 100 : null,
    comments_count: int(project.commentCount),
    updates_count: int(project.updateCount),
    rewards_count: int(project.rewardCount),
    detail_status: 'ok',
    detail_fetched_at: now,
    webrobots_run_id: null,
    last_api_seen_at: now,
    first_seen_at: launchedAt ?? now,
    last_seen_at: now,
    captured_at: now,
    snapshot_source: 'indiegogo_detail',
    queue_detail: false,
  };
}

function projectInsertStatement(db: Database) {
  return db.prepare(`
    INSERT INTO platform_projects (
      platform_id, source_project_id, canonical_key, name, blurb, state, category, country,
      currency, goal_amount, pledged_amount, pledged_usd, backers_count, launched_at,
      deadline, source_url, image_url, raw_status, project_url_name, creator_url_name,
      project_type, is_indemand, is_prelaunch, percent_raised, comments_count,
      updates_count, rewards_count, detail_status, detail_fetched_at, webrobots_run_id,
      last_api_seen_at, first_seen_at, last_seen_at
    ) VALUES (
      @platform_id, @source_project_id, @canonical_key, @name, @blurb, @state, @category, @country,
      @currency, @goal_amount, @pledged_amount, @pledged_usd, @backers_count, @launched_at,
      @deadline, @source_url, @image_url, @raw_status, @project_url_name, @creator_url_name,
      @project_type, @is_indemand, @is_prelaunch, @percent_raised, @comments_count,
      @updates_count, @rewards_count, @detail_status, @detail_fetched_at, @webrobots_run_id,
      @last_api_seen_at, @first_seen_at, @last_seen_at
    )
    ON CONFLICT(platform_id, source_project_id) DO UPDATE SET
      canonical_key = COALESCE(excluded.canonical_key, platform_projects.canonical_key),
      name = COALESCE(NULLIF(excluded.name, ''), platform_projects.name),
      blurb = COALESCE(excluded.blurb, platform_projects.blurb),
      state = COALESCE(excluded.state, platform_projects.state),
      category = COALESCE(excluded.category, platform_projects.category),
      country = COALESCE(excluded.country, platform_projects.country),
      currency = COALESCE(excluded.currency, platform_projects.currency),
      goal_amount = CASE WHEN COALESCE(excluded.goal_amount, 0) > 0 THEN excluded.goal_amount ELSE platform_projects.goal_amount END,
      pledged_amount = MAX(COALESCE(platform_projects.pledged_amount, 0), COALESCE(excluded.pledged_amount, 0)),
      pledged_usd = MAX(COALESCE(platform_projects.pledged_usd, 0), COALESCE(excluded.pledged_usd, 0)),
      backers_count = MAX(COALESCE(platform_projects.backers_count, 0), COALESCE(excluded.backers_count, 0)),
      launched_at = COALESCE(excluded.launched_at, platform_projects.launched_at),
      deadline = COALESCE(excluded.deadline, platform_projects.deadline),
      source_url = COALESCE(excluded.source_url, platform_projects.source_url),
      image_url = COALESCE(excluded.image_url, platform_projects.image_url),
      raw_status = COALESCE(excluded.raw_status, platform_projects.raw_status),
      project_url_name = COALESCE(excluded.project_url_name, platform_projects.project_url_name),
      creator_url_name = COALESCE(excluded.creator_url_name, platform_projects.creator_url_name),
      project_type = COALESCE(excluded.project_type, platform_projects.project_type),
      is_indemand = MAX(COALESCE(platform_projects.is_indemand, 0), COALESCE(excluded.is_indemand, 0)),
      is_prelaunch = COALESCE(excluded.is_prelaunch, platform_projects.is_prelaunch),
      percent_raised = COALESCE(excluded.percent_raised, platform_projects.percent_raised),
      comments_count = MAX(COALESCE(platform_projects.comments_count, 0), COALESCE(excluded.comments_count, 0)),
      updates_count = MAX(COALESCE(platform_projects.updates_count, 0), COALESCE(excluded.updates_count, 0)),
      rewards_count = MAX(COALESCE(platform_projects.rewards_count, 0), COALESCE(excluded.rewards_count, 0)),
      detail_status = COALESCE(excluded.detail_status, platform_projects.detail_status),
      detail_fetched_at = COALESCE(excluded.detail_fetched_at, platform_projects.detail_fetched_at),
      webrobots_run_id = COALESCE(excluded.webrobots_run_id, platform_projects.webrobots_run_id),
      last_api_seen_at = COALESCE(MAX(platform_projects.last_api_seen_at, excluded.last_api_seen_at), platform_projects.last_api_seen_at, excluded.last_api_seen_at),
      first_seen_at = CASE
        WHEN platform_projects.first_seen_at IS NULL THEN excluded.first_seen_at
        WHEN excluded.first_seen_at IS NULL THEN platform_projects.first_seen_at
        ELSE MIN(platform_projects.first_seen_at, excluded.first_seen_at)
      END,
      last_seen_at = CASE
        WHEN platform_projects.last_seen_at IS NULL THEN excluded.last_seen_at
        WHEN excluded.last_seen_at IS NULL THEN platform_projects.last_seen_at
        ELSE MAX(platform_projects.last_seen_at, excluded.last_seen_at)
      END
  `);
}

function snapshotInsertStatement(db: Database) {
  return db.prepare(`
    INSERT INTO platform_snapshots (
      platform_id, source_project_id, captured_at, pledged_amount, pledged_usd,
      backers_count, comments_count, updates_count, state, source
    ) VALUES (
      @platform_id, @source_project_id, @captured_at, @pledged_amount, @pledged_usd,
      @backers_count, @comments_count, @updates_count, @state, @source
    )
    ON CONFLICT(platform_id, source_project_id, captured_at, source) DO UPDATE SET
      pledged_amount = MAX(COALESCE(platform_snapshots.pledged_amount, 0), COALESCE(excluded.pledged_amount, 0)),
      pledged_usd = MAX(COALESCE(platform_snapshots.pledged_usd, 0), COALESCE(excluded.pledged_usd, 0)),
      backers_count = MAX(COALESCE(platform_snapshots.backers_count, 0), COALESCE(excluded.backers_count, 0)),
      comments_count = MAX(COALESCE(platform_snapshots.comments_count, 0), COALESCE(excluded.comments_count, 0)),
      updates_count = MAX(COALESCE(platform_snapshots.updates_count, 0), COALESCE(excluded.updates_count, 0)),
      state = COALESCE(excluded.state, platform_snapshots.state)
  `);
}

function queueInsertStatement(db: Database) {
  return db.prepare(`
    INSERT INTO platform_detail_queue (
      platform_id, project_url_name, source_project_id, status, priority, attempts, next_fetch, updated_at
    ) VALUES (
      @platform_id, @project_url_name, @source_project_id, 'queued', @priority, 0, @next_fetch, @updated_at
    )
    ON CONFLICT(platform_id, project_url_name) DO UPDATE SET
      source_project_id = COALESCE(excluded.source_project_id, platform_detail_queue.source_project_id),
      priority = MAX(COALESCE(platform_detail_queue.priority, 0), COALESCE(excluded.priority, 0)),
      next_fetch = CASE
        WHEN platform_detail_queue.status IN ('ok', 'invalid_slug') THEN platform_detail_queue.next_fetch
        ELSE COALESCE(excluded.next_fetch, platform_detail_queue.next_fetch)
      END,
      updated_at = excluded.updated_at
  `);
}

function upsertStoredProjects(db: Database, rows: StoredProject[]): { imported: number; snapshots: number; queued: number } {
  if (!rows.length) return { imported: 0, snapshots: 0, queued: 0 };
  const insertProject = projectInsertStatement(db);
  const insertSnapshot = snapshotInsertStatement(db);
  const insertQueue = queueInsertStatement(db);
  let imported = 0;
  let snapshots = 0;
  let queued = 0;
  const tx = db.transaction((items: StoredProject[]) => {
    const seenSnapshots = new Set<string>();
    const seenProjects = new Set<string>();
    const seenQueue = new Set<string>();
    for (const row of items) {
      insertProject.run({ platform_id: PLATFORM_ID, ...row });
      if (!seenProjects.has(row.source_project_id)) {
        imported++;
        seenProjects.add(row.source_project_id);
      }
      const snapKey = `${row.source_project_id}:${row.captured_at}:${row.snapshot_source}`;
      if (!seenSnapshots.has(snapKey)) {
        insertSnapshot.run({
          platform_id: PLATFORM_ID,
          source_project_id: row.source_project_id,
          captured_at: row.captured_at,
          pledged_amount: row.pledged_amount,
          pledged_usd: row.pledged_usd,
          backers_count: row.backers_count,
          comments_count: row.comments_count,
          updates_count: row.updates_count,
          state: row.state,
          source: row.snapshot_source,
        });
        seenSnapshots.add(snapKey);
        snapshots++;
      }
      if (row.queue_detail && row.project_url_name && !seenQueue.has(row.project_url_name)) {
        insertQueue.run({
          platform_id: PLATFORM_ID,
          project_url_name: row.project_url_name,
          source_project_id: row.source_project_id,
          priority: row.state === 'live' ? 5 : 1,
          next_fetch: 0,
          updated_at: nowSec(),
        });
        seenQueue.add(row.project_url_name);
        queued++;
      }
    }
  });
  tx(rows);
  return { imported, snapshots, queued };
}

function startRun(db: Database, jobType: string) {
  const result = db.prepare(`
    INSERT INTO platform_crawl_runs (platform_id, job_type, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(PLATFORM_ID, jobType, nowSec());
  return Number(result.lastInsertRowid);
}

function completeRun(db: Database, id: number | null, update: {
  status: string;
  discovered?: number;
  imported?: number;
  snapshots?: number;
  pages?: number;
  blocked?: number;
  errors?: number;
  message?: string;
}) {
  if (!id) return;
  db.prepare(`
    UPDATE platform_crawl_runs
    SET status = @status,
        completed_at = @completed_at,
        discovered_count = @discovered,
        imported_count = @imported,
        snapshot_count = @snapshots,
        page_count = @pages,
        blocked_count = @blocked,
        error_count = @errors,
        message = @message
    WHERE id = @id
  `).run({
    id,
    status: update.status,
    completed_at: nowSec(),
    discovered: update.discovered ?? 0,
    imported: update.imported ?? 0,
    snapshots: update.snapshots ?? 0,
    pages: update.pages ?? 0,
    blocked: update.blocked ?? 0,
    errors: update.errors ?? 0,
    message: update.message ?? null,
  });
}

function recordError(db: Database, input: {
  jobType: string;
  sourceProjectId?: string | null;
  url?: string | null;
  statusCode?: number | null;
  message: string;
  context?: unknown;
}) {
  db.prepare(`
    INSERT INTO platform_crawler_errors
      (platform_id, job_type, source_project_id, url, status_code, message, context_json)
    VALUES
      (@platform_id, @job_type, @source_project_id, @url, @status_code, @message, @context_json)
  `).run({
    platform_id: PLATFORM_ID,
    job_type: input.jobType,
    source_project_id: input.sourceProjectId ?? null,
    url: input.url ?? null,
    status_code: input.statusCode ?? null,
    message: input.message,
    context_json: input.context ? JSON.stringify(input.context).slice(0, 5000) : null,
  });
}

function storePayloadMeta(db: Database, input: {
  sourceKey: string;
  kind: string;
  statusCode?: number | null;
  contentType?: string | null;
  bytes?: number;
  preview?: string | null;
}) {
  db.prepare(`
    INSERT INTO platform_raw_payloads
      (platform_id, source_key, payload_kind, status_code, content_type, payload_bytes, payload_preview)
    VALUES
      (@platform_id, @source_key, @payload_kind, @status_code, @content_type, @payload_bytes, @payload_preview)
  `).run({
    platform_id: PLATFORM_ID,
    source_key: input.sourceKey,
    payload_kind: input.kind,
    status_code: input.statusCode ?? null,
    content_type: input.contentType ?? null,
    payload_bytes: input.bytes ?? 0,
    payload_preview: input.preview?.slice(0, 2000) ?? null,
  });
}

async function fetchText(url: string, timeoutMs = 30_000): Promise<{ status: number; contentType: string | null; text: string }> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json,text/html,text/plain,*/*',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    text: await res.text(),
  };
}

export async function fetchWebrobotsIndex(): Promise<IndiegogoWebrobotsIndex> {
  const res = await fetchText(WEBROBOTS_INDEX_URL, 30_000);
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, datasetCount: 0, latestDate: null, latestUrl: null, datasets: [] };
  }
  const urls = [...new Set(res.text.match(/https:\/\/s3\.amazonaws\.com\/weruns\/forfun\/Indiegogo\/Indiegogo_[^"'<> \n\r]+\.json\.gz/g) ?? [])];
  const datasets = urls
    .map(url => {
      const runId = url.match(/\/(Indiegogo_[^/]+)\.json\.gz$/)?.[1] ?? '';
      return { date: runId ? runIdToDate(runId) : '', runId, url };
    })
    .filter(item => item.runId && item.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.runId.localeCompare(b.runId));
  const latest = datasets[datasets.length - 1] ?? null;
  return {
    ok: true,
    datasetCount: datasets.length,
    latestDate: latest?.date ?? null,
    latestUrl: latest?.url ?? null,
    datasets,
  };
}

async function importDataset(db: Database, dataset: IndiegogoWebrobotsDataset): Promise<{
  ok: boolean;
  rowsRead: number;
  imported: number;
  snapshots: number;
  queued: number;
  status?: number;
  message?: string;
}> {
  const runId = startRun(db, `webrobots:${dataset.date}`);
  let rowsRead = 0;
  let imported = 0;
  let snapshots = 0;
  let queued = 0;
  const uniqueProjects = new Set<string>();
  const uniqueQueuedSlugs = new Set<string>();
  try {
    const res = await fetch(dataset.url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/x-gzip,application/json,*/*',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(WEBROBOTS_TIMEOUT_MS),
    });
    const contentType = res.headers.get('content-type');
    if (!res.ok || !res.body) {
      const preview = await res.text().catch(() => '');
      storePayloadMeta(db, {
        sourceKey: dataset.url,
        kind: 'webrobots_dataset',
        statusCode: res.status,
        contentType,
        bytes: preview.length,
        preview,
      });
      const message = `Webrobots dataset HTTP ${res.status}`;
      recordError(db, { jobType: 'webrobots_import', url: dataset.url, statusCode: res.status, message });
      completeRun(db, runId, { status: 'skipped', errors: 1, message });
      return { ok: false, rowsRead, imported, snapshots, queued, status: res.status, message };
    }

    storePayloadMeta(db, {
      sourceKey: dataset.url,
      kind: 'webrobots_dataset',
      statusCode: res.status,
      contentType,
      bytes: Number(res.headers.get('content-length') ?? 0) || 0,
      preview: dataset.runId,
    });

    const stream = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]).pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let batch: StoredProject[] = [];
    for await (const line of rl) {
      rowsRead++;
      try {
        const parsed = parseWebrobotsLine(line);
        const row = parsed ? normalizeWebrobotsRow(parsed) : null;
        if (row) {
          uniqueProjects.add(row.source_project_id);
          if (row.queue_detail && row.project_url_name) uniqueQueuedSlugs.add(row.project_url_name);
          batch.push(row);
        }
      } catch (err) {
        recordError(db, {
          jobType: 'webrobots_parse',
          url: dataset.url,
          message: err instanceof Error ? err.message : String(err),
          context: { line: rowsRead },
        });
      }
      if (batch.length >= 1000) {
        const stored = upsertStoredProjects(db, batch);
        snapshots += stored.snapshots;
        batch = [];
      }
    }
    if (batch.length) {
      const stored = upsertStoredProjects(db, batch);
      snapshots += stored.snapshots;
    }
    imported = uniqueProjects.size;
    queued = uniqueQueuedSlugs.size;
    completeRun(db, runId, {
      status: 'completed',
      discovered: rowsRead,
      imported,
      snapshots,
      pages: 1,
      message: `Imported ${dataset.date}: ${imported} projects, ${snapshots} snapshots.`,
    });
    return { ok: true, rowsRead, imported, snapshots, queued };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(db, { jobType: 'webrobots_import', url: dataset.url, message, context: { rowsRead } });
    completeRun(db, runId, { status: 'error', discovered: rowsRead, imported, snapshots, errors: 1, message });
    return { ok: false, rowsRead, imported, snapshots, queued, message };
  }
}

export async function importIndiegogoWebrobots(options: IndiegogoImportOptions = {}): Promise<IndiegogoImportResult> {
  const mode = options.mode ?? 'all_available';
  const db = openPlatformSourceDb(PLATFORM_ID);
  try {
    const index = await fetchWebrobotsIndex();
    if (!index.ok) {
      return {
        ok: false,
        mode,
        datasetCount: 0,
        datasetsImported: 0,
        datasetsSkipped: 0,
        rowsRead: 0,
        rowsImported: 0,
        snapshots: 0,
        queuedDetails: 0,
        skipped: [{ url: WEBROBOTS_INDEX_URL, message: 'Could not read Webrobots Indiegogo index.' }],
      };
    }

    let datasets = mode === 'latest' ? index.datasets.slice(-1) : index.datasets;
    if (options.maxDatasets && options.maxDatasets > 0) {
      datasets = datasets.slice(-options.maxDatasets);
    }

    let datasetsImported = 0;
    let datasetsSkipped = 0;
    let rowsRead = 0;
    let rowsImported = 0;
    let snapshots = 0;
    let queuedDetails = 0;
    const skipped: IndiegogoImportResult['skipped'] = [];

    for (const dataset of datasets) {
      const result = await importDataset(db, dataset);
      rowsRead += result.rowsRead;
      rowsImported += result.imported;
      snapshots += result.snapshots;
      queuedDetails += result.queued;
      if (result.ok) datasetsImported++;
      else {
        datasetsSkipped++;
        skipped.push({ url: dataset.url, status: result.status, message: result.message ?? 'Dataset skipped.' });
      }
    }

    return {
      ok: datasetsImported > 0 || datasets.length === 0,
      mode,
      datasetCount: datasets.length,
      datasetsImported,
      datasetsSkipped,
      rowsRead,
      rowsImported,
      snapshots,
      queuedDetails,
      skipped,
      message: `Imported ${datasetsImported}/${datasets.length} Webrobots dataset(s).`,
    };
  } finally {
    db.close();
  }
}

function existingSourceIdForSlug(db: Database, projectUrlName: string | null): string | null {
  if (!projectUrlName) return null;
  const row = db.prepare(`
    SELECT source_project_id
    FROM platform_projects
    WHERE platform_id = ? AND project_url_name = ?
    ORDER BY source_project_id NOT LIKE 'slug:%' DESC, last_seen_at DESC
    LIMIT 1
  `).get(PLATFORM_ID, projectUrlName) as { source_project_id: string } | undefined;
  return row?.source_project_id ?? null;
}

async function fetchApiProject(projectUrlName: string): Promise<{ status: number; text: string; project: ApiProject | null }> {
  const url = `${DETAIL_API_URL}?urlName=${encodeURIComponent(projectUrlName)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
  });
  const textBody = await res.text();
  if (!res.ok) return { status: res.status, text: textBody, project: null };
  try {
    return { status: res.status, text: textBody, project: JSON.parse(textBody) as ApiProject };
  } catch {
    return { status: res.status, text: textBody, project: null };
  }
}

export async function syncIndiegogoActive(): Promise<IndiegogoActiveResult> {
  const db = openPlatformSourceDb(PLATFORM_ID);
  const runId = startRun(db, 'active_api');
  try {
    const res = await fetch(ACTIVE_API_URL, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.text();
    storePayloadMeta(db, {
      sourceKey: ACTIVE_API_URL,
      kind: 'active_api',
      statusCode: res.status,
      contentType: res.headers.get('content-type'),
      bytes: Buffer.byteLength(body),
      preview: body.slice(0, 1000),
    });
    if (!res.ok) {
      const message = `Indiegogo active API HTTP ${res.status}`;
      recordError(db, { jobType: 'active_api', url: ACTIVE_API_URL, statusCode: res.status, message });
      completeRun(db, runId, { status: 'error', errors: 1, message });
      return { ok: false, activeCount: 0, imported: 0, snapshots: 0, message };
    }
    const projects = JSON.parse(body) as ApiProject[];
    const normalized = projects
      .map(project => {
        const slug = text(project.projectUrlName, 300) ?? projectUrlNameFromHomeUrl(project.projectHomeUrl);
        return normalizeIndiegogoApiProject(project, existingSourceIdForSlug(db, slug));
      })
      .filter((project): project is StoredProject => Boolean(project))
      .map(project => ({ ...project, snapshot_source: 'indiegogo_active' as const }));
    const stored = upsertStoredProjects(db, normalized);
    completeRun(db, runId, {
      status: 'completed',
      discovered: projects.length,
      imported: stored.imported,
      snapshots: stored.snapshots,
      pages: 1,
      message: `Synced ${projects.length} active Indiegogo project(s).`,
    });
    return { ok: true, activeCount: projects.length, imported: stored.imported, snapshots: stored.snapshots };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(db, { jobType: 'active_api', url: ACTIVE_API_URL, message });
    completeRun(db, runId, { status: 'error', errors: 1, message });
    return { ok: false, activeCount: 0, imported: 0, snapshots: 0, message };
  } finally {
    db.close();
  }
}

function enqueueStaleDetails(db: Database, staleBefore?: number): number {
  if (!staleBefore) return 0;
  const now = nowSec();
  const insert = db.prepare(`
    INSERT INTO platform_detail_queue
      (platform_id, project_url_name, source_project_id, status, priority, attempts, next_fetch, updated_at)
    SELECT platform_id, project_url_name, source_project_id, 'queued',
           CASE WHEN state = 'live' THEN 5 ELSE 1 END, 0, 0, @now
    FROM platform_projects
    WHERE platform_id = @platform_id
      AND project_url_name IS NOT NULL
      AND COALESCE(is_prelaunch, 0) = 0
      AND COALESCE(detail_status, '') <> 'invalid_slug'
      AND (detail_fetched_at IS NULL OR detail_fetched_at <= @stale)
    ON CONFLICT(platform_id, project_url_name) DO UPDATE SET
      source_project_id = COALESCE(excluded.source_project_id, platform_detail_queue.source_project_id),
      status = CASE WHEN platform_detail_queue.status = 'invalid_slug' THEN 'invalid_slug' ELSE 'queued' END,
      priority = MAX(COALESCE(platform_detail_queue.priority, 0), COALESCE(excluded.priority, 0)),
      next_fetch = CASE WHEN platform_detail_queue.status = 'invalid_slug' THEN platform_detail_queue.next_fetch ELSE 0 END,
      updated_at = @now
  `);
  return insert.run({ platform_id: PLATFORM_ID, stale: staleBefore, now }).changes;
}

function dueDetails(db: Database, limit: number): QueueRow[] {
  const now = nowSec();
  return db.prepare(`
    SELECT project_url_name, source_project_id, COALESCE(attempts, 0) AS attempts
    FROM platform_detail_queue
    WHERE platform_id = @platform_id
      AND status IN ('queued', 'error')
      AND (next_fetch IS NULL OR next_fetch <= @now)
    ORDER BY priority DESC, COALESCE(next_fetch, 0) ASC, updated_at ASC
    LIMIT @limit
  `).all({ platform_id: PLATFORM_ID, now, limit }) as QueueRow[];
}

function markDetailOk(db: Database, row: QueueRow, sourceProjectId: string) {
  db.prepare(`
    UPDATE platform_detail_queue
    SET status = 'ok',
        source_project_id = @source_project_id,
        attempts = 0,
        next_fetch = NULL,
        last_error = NULL,
        updated_at = @updated_at
    WHERE platform_id = @platform_id AND project_url_name = @project_url_name
  `).run({
    platform_id: PLATFORM_ID,
    project_url_name: row.project_url_name,
    source_project_id: sourceProjectId,
    updated_at: nowSec(),
  });
}

function markDetailInvalid(db: Database, row: QueueRow, message: string) {
  const now = nowSec();
  db.prepare(`
    UPDATE platform_detail_queue
    SET status = 'invalid_slug',
        attempts = attempts + 1,
        next_fetch = NULL,
        last_error = @message,
        updated_at = @now
    WHERE platform_id = @platform_id AND project_url_name = @project_url_name
  `).run({ platform_id: PLATFORM_ID, project_url_name: row.project_url_name, message, now });
  db.prepare(`
    UPDATE platform_projects
    SET detail_status = 'invalid_slug', detail_fetched_at = @now
    WHERE platform_id = @platform_id AND project_url_name = @project_url_name
  `).run({ platform_id: PLATFORM_ID, project_url_name: row.project_url_name, now });
}

function markDetailFailure(db: Database, row: QueueRow, message: string) {
  const now = nowSec();
  const attempts = row.attempts + 1;
  const backoff = [30 * 60, 2 * 3600, 6 * 3600, 24 * 3600][Math.min(attempts - 1, 3)];
  db.prepare(`
    UPDATE platform_detail_queue
    SET status = 'error',
        attempts = @attempts,
        next_fetch = @next_fetch,
        last_error = @message,
        updated_at = @now
    WHERE platform_id = @platform_id AND project_url_name = @project_url_name
  `).run({
    platform_id: PLATFORM_ID,
    project_url_name: row.project_url_name,
    attempts,
    next_fetch: now + backoff,
    message,
    now,
  });
}

export async function refreshIndiegogoDetails(options: IndiegogoDetailOptions = {}): Promise<IndiegogoDetailResult> {
  const db = openPlatformSourceDb(PLATFORM_ID);
  const runId = startRun(db, 'detail_api');
  const limit = Math.max(1, options.limit ?? DEFAULT_DETAIL_LIMIT);
  let attempted = 0;
  let refreshed = 0;
  let invalid = 0;
  let failed = 0;
  let queued = 0;
  try {
    queued = enqueueStaleDetails(db, options.staleBefore);
    const due = dueDetails(db, limit);
    for (const row of due) {
      if (attempted > 0) await sleep(DETAIL_DELAY_MS);
      attempted++;
      const detailUrl = `${DETAIL_API_URL}?urlName=${encodeURIComponent(row.project_url_name)}`;
      try {
        const result = await fetchApiProject(row.project_url_name);
        storePayloadMeta(db, {
          sourceKey: detailUrl,
          kind: 'detail_api',
          statusCode: result.status,
          contentType: 'application/json',
          bytes: Buffer.byteLength(result.text),
          preview: result.text.slice(0, 1000),
        });
        if (result.status === 400) {
          invalid++;
          markDetailInvalid(db, row, result.text.slice(0, 500));
          continue;
        }
        if (!result.project) {
          failed++;
          const message = `Detail API returned HTTP ${result.status} without a usable project.`;
          markDetailFailure(db, row, message);
          recordError(db, { jobType: 'detail_api', url: detailUrl, statusCode: result.status, message });
          continue;
        }
        const normalized = normalizeIndiegogoApiProject(
          result.project,
          row.source_project_id ?? existingSourceIdForSlug(db, row.project_url_name),
        );
        if (!normalized) {
          failed++;
          const message = 'Detail API response did not include projectUrlName.';
          markDetailFailure(db, row, message);
          recordError(db, { jobType: 'detail_api', url: detailUrl, statusCode: result.status, message });
          continue;
        }
        const stored = upsertStoredProjects(db, [normalized]);
        markDetailOk(db, row, normalized.source_project_id);
        refreshed += stored.imported > 0 ? 1 : 0;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        markDetailFailure(db, row, message);
        recordError(db, { jobType: 'detail_api', url: detailUrl, message });
      }
    }
    completeRun(db, runId, {
      status: failed > 0 && refreshed === 0 && invalid === 0 ? 'error' : 'completed',
      discovered: due.length,
      imported: refreshed,
      snapshots: refreshed,
      errors: failed,
      message: `Detail refresh: ${refreshed} ok, ${invalid} invalid, ${failed} failed.`,
    });
    return { ok: failed === 0 || refreshed > 0 || invalid > 0 || attempted === 0, attempted, refreshed, invalid, failed, queued };
  } finally {
    db.close();
  }
}

export async function runIndiegogoPipelineOnce() {
  const active = await syncIndiegogoActive();
  const details = await refreshIndiegogoDetails({ limit: Number(process.env.INDIEGOGO_DETAIL_BATCH_SIZE ?? DEFAULT_DETAIL_LIMIT) });
  return { active, details };
}

export async function validateIndiegogoConfig() {
  const [index, active] = await Promise.allSettled([
    fetchWebrobotsIndex(),
    fetch(ACTIVE_API_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    }).then(async res => {
      const textBody = await res.text();
      let activeCount: number | null = null;
      try {
        const parsed = JSON.parse(textBody);
        activeCount = Array.isArray(parsed) ? parsed.length : null;
      } catch { /* ignore */ }
      return { ok: res.ok, status: res.status, activeCount, bytes: Buffer.byteLength(textBody) };
    }),
  ]);

  return {
    webrobots: index.status === 'fulfilled'
      ? {
          ok: index.value.ok,
          datasetCount: index.value.datasetCount,
          latestDate: index.value.latestDate,
          latestUrl: index.value.latestUrl,
        }
      : { ok: false, error: index.reason instanceof Error ? index.reason.message : String(index.reason) },
    activeApi: active.status === 'fulfilled'
      ? active.value
      : { ok: false, error: active.reason instanceof Error ? active.reason.message : String(active.reason) },
  };
}
