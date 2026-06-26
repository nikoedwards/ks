import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import fs from 'fs';
import BetterSqlite3, { type Database } from 'better-sqlite3';
import { getPlatformDbPath, openPlatformSourceDb } from './platformDb';
import { resolveUsdAmounts } from './money';
import {
  searchIndiegogoViaWorker,
  indiegogoWorkerConfigured,
  type IndiegogoSearchCard,
  type IndiegogoSearchParams,
} from './indiegogoWorker';

const PLATFORM_ID = 'indiegogo';
const WEBROBOTS_INDEX_URL = 'https://webrobots.io/indiegogo-dataset/';
const ACTIVE_API_URL = 'https://www.indiegogo.com/api/public/projects/getActiveCrowdfundingProjects';
const DETAIL_API_URL = 'https://www.indiegogo.com/api/public/projects/getCrowdfundingProject';

const USER_AGENT = 'Mozilla/5.0 (compatible; KicksonarIndiegogo/0.1)';
const DEFAULT_DETAIL_LIMIT = 25;
const DETAIL_DELAY_MS = Math.max(250, Number(process.env.INDIEGOGO_DETAIL_DELAY_MS ?? 1000));
const DETAIL_TIMEOUT_MS = Math.max(5000, Number(process.env.INDIEGOGO_DETAIL_TIMEOUT_MS ?? 20_000));
const WEBROBOTS_TIMEOUT_MS = Math.max(15_000, Number(process.env.INDIEGOGO_WEBROBOTS_TIMEOUT_MS ?? 120_000));
const WEBROBOTS_STALE_RUN_SECONDS = Math.max(
  300,
  Number(process.env.INDIEGOGO_WEBROBOTS_STALE_RUN_SECONDS ?? 10 * 60),
);

const SEARCH_PAGE_SIZE = 24;
const SEARCH_QUERY_CAP = 10_000; // Indiegogo caps any single query at ~10k items.
const SEARCH_PAGE_DELAY_MS = Math.max(200, Number(process.env.INDIEGOGO_SEARCH_PAGE_DELAY_MS ?? 600));

// Indiegogo project phases observed on searchProjectsForCards (projectPhaseSearchTypes).
// 3 (ongoing) and 4 (ended) are the large buckets that exceed the 10k cap and must
// be split by category; the rest are small.
const INDIEGOGO_SEARCH_PHASES = [0, 1, 2, 3, 4, 5, 6] as const;

// Full catalog category enum (projectCatalogCategories), harvested from live cards.
// Used to partition the big phases below the 10k query cap during the backlog sweep.
const INDIEGOGO_CATEGORIES: readonly string[] = [
  'BoardAndCardGames', 'TTRPG', 'Others', 'Accessories', 'PhonesAndAccessories', 'Audio',
  'CameraGear', 'Home', 'HealthAndFitness', 'Productivity', 'TravelAndOutdoors', 'Transportation',
  'FashionAndWearables', 'General', 'Art', 'Film', 'Music', 'DanceAndTheater', 'Comics',
  'WritingAndPublishing', 'Photography', 'VideoGames', 'LocalBusinesses', 'Education', 'HumanRights',
  'Wellness', 'Environment', 'OtherCommunityProjects', 'EnergyAndGreenTech', 'FoodAndBeverages',
  'WebSeriesAndTVShows', 'PodcastsBlogsAndVlogs', 'Culture',
];

// Sort by funds raised (descending) so the highest-value projects in each slice land
// first; sortType 0 is Indiegogo's default "trending". Newest is used for discovery.
const SORT_TRENDING = 0;
const SORT_NEWEST = 1;

// Best-effort currency-symbol -> ISO code. Search cards only expose a symbol; the
// detail API later provides the authoritative currencyShortName and corrects this.
// '$' defaults to USD (the overwhelming majority of Indiegogo campaigns).
const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  $: 'USD', US$: 'USD', 'C$': 'CAD', CA$: 'CAD', 'A$': 'AUD', AU$: 'AUD', 'NZ$': 'NZD',
  'HK$': 'HKD', 'S$': 'SGD', 'R$': 'BRL', 'MX$': 'MXN', '£': 'GBP', '€': 'EUR', '¥': 'JPY',
  '₹': 'INR', '₩': 'KRW', '₽': 'RUB', '₪': 'ILS', '฿': 'THB', 'CHF': 'CHF', kr: 'SEK', zł: 'PLN',
};

function currencyFromSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const raw = symbol.trim();
  return CURRENCY_SYMBOL_MAP[raw] ?? null;
}

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

export type IndiegogoImportMode = 'latest' | 'all_available' | 'missing';

export interface IndiegogoImportOptions {
  mode?: IndiegogoImportMode;
  maxDatasets?: number;
}

export interface IndiegogoImportResult {
  ok: boolean;
  mode: IndiegogoImportMode;
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

export type IndiegogoMonthImportStatus = 'completed' | 'missing' | 'running' | 'stale' | 'source_unavailable' | 'error' | 'skipped';

export interface IndiegogoWebrobotsMonthStatus {
  date: string;
  runId: string | null;
  url: string | null;
  status: IndiegogoMonthImportStatus;
  runCount: number;
  importedCount: number;
  snapshotCount: number;
  errorCount: number;
  startedAt: number | null;
  completedAt: number | null;
  message: string | null;
}

export interface IndiegogoWebrobotsDiagnostics {
  checkedAt: number;
  databaseExists: boolean;
  source: {
    ok: boolean;
    datasetCount: number;
    firstDate: string | null;
    latestDate: string | null;
    latestUrl: string | null;
    error?: string;
  };
  coverage: {
    expected: number;
    completed: number;
    missing: number;
    failed: number;
    running: number;
    stale: number;
    sourceUnavailable: number;
    skipped: number;
    percent: number | null;
  };
  range: {
    firstSnapshotAt: number | null;
    latestSnapshotAt: number | null;
    webrobotsProjects: number;
    webrobotsSnapshots: number;
    webrobotsDetails: number;
  };
  detailQueue: {
    total: number;
    byStatus: Record<string, number>;
  };
  errorSummary: Array<{
    jobType: string | null;
    statusCode: number | null;
    message: string;
    count: number;
    lastOccurredAt: number | null;
  }>;
  months: IndiegogoWebrobotsMonthStatus[];
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
  snapshot_source: 'webrobots' | 'indiegogo_active' | 'indiegogo_detail' | 'indiegogo_search';
  queue_detail: boolean;
}

type IndiegogoNativeSource = 'webrobots' | 'active_api' | 'detail_api';

interface NativeProjectDetail {
  source_project_id: string;
  project_url_name: string | null;
  source: IndiegogoNativeSource;
  fetched_at: number;
  status_code: number | null;
  raw_json: string;
  detail_json: string | null;
  webrobots_json: string | null;
  webrobots_run_id: string | null;
  payload_bytes: number;
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

function webrobotsDateFromJobType(jobType: string | null | undefined): string | null {
  const match = String(jobType ?? '').match(/^webrobots:(\d{4}-\d{2}-\d{2})$/);
  return match?.[1] ?? null;
}

function isSourceUnavailableStatus(status: number | null | undefined) {
  return status === 403 || status === 404 || status === 410;
}

function isSourceUnavailableMessage(message: string | null | undefined) {
  return /Webrobots dataset HTTP (403|404|410)\b/i.test(String(message ?? ''));
}

function tableExists(db: Database, table: string) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function scalarNumber(db: Database, sql: string, params: Record<string, unknown> = {}) {
  const row = db.prepare(sql).get(params) as { value?: number | null } | undefined;
  return Number(row?.value ?? 0);
}

function scalarNullableNumber(db: Database, sql: string, params: Record<string, unknown> = {}) {
  const row = db.prepare(sql).get(params) as { value?: number | null } | undefined;
  const value = row?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

interface WebrobotsRunRow {
  id: number;
  job_type: string;
  status: string;
  started_at: number;
  completed_at: number | null;
  imported_count: number;
  snapshot_count: number;
  error_count: number;
  message: string | null;
}

function readWebrobotsRuns(db: Database): WebrobotsRunRow[] {
  if (!tableExists(db, 'platform_crawl_runs')) return [];
  return db.prepare(`
    SELECT id, job_type, status, started_at, completed_at,
           imported_count, snapshot_count, error_count, message
    FROM platform_crawl_runs
    WHERE platform_id = ? AND job_type LIKE 'webrobots:%'
    ORDER BY started_at DESC, id DESC
  `).all(PLATFORM_ID) as WebrobotsRunRow[];
}

function completedWebrobotsDates(db: Database) {
  return new Set(
    readWebrobotsRuns(db)
      .filter(row => row.status === 'completed')
      .map(row => webrobotsDateFromJobType(row.job_type))
      .filter((date): date is string => Boolean(date)),
  );
}

function isStaleWebrobotsRun(row: WebrobotsRunRow, now = nowSec()) {
  return row.status === 'running' && now - Number(row.started_at ?? 0) > WEBROBOTS_STALE_RUN_SECONDS;
}

function activeRunningWebrobotsDates(db: Database) {
  return new Set(
    readWebrobotsRuns(db)
      .filter(row => row.status === 'running' && !isStaleWebrobotsRun(row))
      .map(row => webrobotsDateFromJobType(row.job_type))
      .filter((date): date is string => Boolean(date)),
  );
}

function sourceUnavailableWebrobotsDates(db: Database) {
  return new Set(
    readWebrobotsRuns(db)
      .filter(row => (row.status === 'skipped' || row.status === 'error') && isSourceUnavailableMessage(row.message))
      .map(row => webrobotsDateFromJobType(row.job_type))
      .filter((date): date is string => Boolean(date)),
  );
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

export function normalizeIndiegogoSearchCard(card: IndiegogoSearchCard): StoredProject | null {
  const projectUrlName = text(card.projectUrlName, 300)
    ?? projectUrlNameFromHomeUrl(card.url ?? null)
    ?? null;
  const projectId = card.projectID == null ? null : String(card.projectID);
  if (!projectUrlName && !projectId) return null;

  const now = nowSec();
  const currency = currencyFromSymbol(card.currencySymbol);
  const pledged = num(card.fundsGathered);
  const goal = num(card.campaignGoal);
  const backers = int(card.backersCount) ?? 0;
  const amounts = usdAmounts(pledged, goal, currency, backers);
  const launchedAt = toSeconds(card.campaignStart);
  const deadline = toSeconds(card.campaignEnd);
  // type/originalType: 2 denotes InDemand (post-campaign ongoing) on Indiegogo.
  const projectType = card.type == null ? null : String(card.type);
  const isIndemand = projectType === '2' || String(card.originalType ?? '') === '2';
  // phase 0 with no launch date = prelaunch/coming soon.
  const isPrelaunch = card.phase === 0 || !launchedAt;
  const state = resolveIndiegogoState({
    deadline,
    goal,
    pledged,
    isIndemand,
    isPrelaunch,
    projectType,
    now,
  });
  const sourceProjectId = projectId ?? `slug:${projectUrlName}`;

  return {
    source_project_id: sourceProjectId,
    canonical_key: projectUrlName ? `${PLATFORM_ID}:${projectUrlName}` : `${PLATFORM_ID}:${sourceProjectId}`,
    name: text(card.name, 500) ?? projectUrlName ?? sourceProjectId,
    blurb: text(card.shortDescription, 1000),
    state,
    category: text(card.catalogCategory?.name, 200),
    country: null,
    currency,
    goal_amount: amounts.goalUsd,
    pledged_amount: pledged,
    pledged_usd: amounts.pledgedUsd,
    backers_count: backers,
    launched_at: launchedAt,
    deadline,
    source_url: text(card.url, 1000) ?? (projectUrlName ? `https://www.indiegogo.com/projects/${projectUrlName}` : null),
    image_url: text(card.imageUrl, 1000),
    raw_status: rawStatus({ state, isIndemand, isPrelaunch, source: 'search' }),
    project_url_name: projectUrlName,
    creator_url_name: text(card.creator?.urlName, 300),
    project_type: projectType,
    is_indemand: isIndemand ? 1 : 0,
    is_prelaunch: isPrelaunch ? 1 : 0,
    percent_raised: goal > 0 ? (pledged / goal) * 100 : null,
    comments_count: null,
    updates_count: null,
    rewards_count: null,
    detail_status: null,
    detail_fetched_at: null,
    webrobots_run_id: null,
    last_api_seen_at: now,
    first_seen_at: launchedAt ?? now,
    last_seen_at: now,
    captured_at: now,
    snapshot_source: 'indiegogo_search',
    queue_detail: Boolean(projectUrlName && !isPrelaunch),
  };
}

function nativeSearchCardDetail(card: IndiegogoSearchCard, row: StoredProject): NativeProjectDetail {
  const payload = jsonPayload(card);
  return {
    source_project_id: row.source_project_id,
    project_url_name: row.project_url_name,
    source: 'detail_api',
    fetched_at: row.captured_at,
    status_code: 200,
    raw_json: payload,
    detail_json: null,
    webrobots_json: null,
    webrobots_run_id: null,
    payload_bytes: Buffer.byteLength(payload),
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

function nativeProjectDetailInsertStatement(db: Database) {
  return db.prepare(`
    INSERT INTO indiegogo_project_details (
      platform_id, source_project_id, project_url_name, source, fetched_at, status_code,
      raw_json, detail_json, webrobots_json, webrobots_run_id, payload_bytes, updated_at
    ) VALUES (
      @platform_id, @source_project_id, @project_url_name, @source, @fetched_at, @status_code,
      @raw_json, @detail_json, @webrobots_json, @webrobots_run_id, @payload_bytes, @updated_at
    )
    ON CONFLICT(platform_id, source_project_id, source, fetched_at) DO UPDATE SET
      project_url_name = COALESCE(excluded.project_url_name, indiegogo_project_details.project_url_name),
      status_code = COALESCE(excluded.status_code, indiegogo_project_details.status_code),
      raw_json = excluded.raw_json,
      detail_json = COALESCE(excluded.detail_json, indiegogo_project_details.detail_json),
      webrobots_json = COALESCE(excluded.webrobots_json, indiegogo_project_details.webrobots_json),
      webrobots_run_id = COALESCE(excluded.webrobots_run_id, indiegogo_project_details.webrobots_run_id),
      payload_bytes = excluded.payload_bytes,
      updated_at = excluded.updated_at
  `);
}

function upsertIndiegogoProjectDetails(db: Database, rows: NativeProjectDetail[]): number {
  if (!rows.length) return 0;
  const insert = nativeProjectDetailInsertStatement(db);
  let stored = 0;
  const tx = db.transaction((items: NativeProjectDetail[]) => {
    const seen = new Set<string>();
    const updatedAt = nowSec();
    for (const row of items) {
      const key = `${row.source_project_id}:${row.source}:${row.fetched_at}`;
      if (seen.has(key)) continue;
      insert.run({
        platform_id: PLATFORM_ID,
        ...row,
        updated_at: updatedAt,
      });
      seen.add(key);
      stored++;
    }
  });
  tx(rows);
  return stored;
}

function jsonPayload(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function nativeWebrobotsDetail(parsed: WebrobotsOuterRow, row: StoredProject): NativeProjectDetail {
  const payload = jsonPayload(parsed);
  return {
    source_project_id: row.source_project_id,
    project_url_name: row.project_url_name,
    source: 'webrobots',
    fetched_at: row.captured_at,
    status_code: null,
    raw_json: payload,
    detail_json: null,
    webrobots_json: payload,
    webrobots_run_id: row.webrobots_run_id,
    payload_bytes: Buffer.byteLength(payload),
  };
}

function nativeApiProjectDetail(
  project: ApiProject,
  row: StoredProject,
  source: Extract<IndiegogoNativeSource, 'active_api' | 'detail_api'>,
  statusCode: number,
  rawText?: string,
): NativeProjectDetail {
  const payload = rawText?.trim() || jsonPayload(project);
  return {
    source_project_id: row.source_project_id,
    project_url_name: row.project_url_name,
    source,
    fetched_at: row.captured_at,
    status_code: statusCode,
    raw_json: payload,
    detail_json: source === 'detail_api' ? payload : null,
    webrobots_json: null,
    webrobots_run_id: null,
    payload_bytes: Buffer.byteLength(payload),
  };
}

function nativeDetailResponse(row: QueueRow, statusCode: number, rawText: string): NativeProjectDetail {
  const payload = rawText || '';
  return {
    source_project_id: row.source_project_id ?? `slug:${row.project_url_name}`,
    project_url_name: row.project_url_name,
    source: 'detail_api',
    fetched_at: nowSec(),
    status_code: statusCode,
    raw_json: payload,
    detail_json: statusCode >= 200 && statusCode < 300 ? payload : null,
    webrobots_json: null,
    webrobots_run_id: null,
    payload_bytes: Buffer.byteLength(payload),
  };
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

function summarizeMonthStatus(
  dataset: IndiegogoWebrobotsDataset | null,
  date: string,
  runs: WebrobotsRunRow[],
  now = nowSec(),
): IndiegogoWebrobotsMonthStatus {
  const sorted = [...runs].sort((a, b) => (b.started_at - a.started_at) || (b.id - a.id));
  const completed = sorted.find(row => row.status === 'completed');
  const running = sorted.find(row => row.status === 'running' && !isStaleWebrobotsRun(row, now));
  const stale = sorted.find(row => row.status === 'running' && isStaleWebrobotsRun(row, now));
  const sourceUnavailable = sorted.find(row => (row.status === 'skipped' || row.status === 'error') && isSourceUnavailableMessage(row.message));
  const errored = sorted.find(row => row.status === 'error');
  const skipped = sorted.find(row => row.status === 'skipped');
  const selected = completed ?? running ?? stale ?? sourceUnavailable ?? errored ?? skipped ?? sorted[0] ?? null;
  const status: IndiegogoMonthImportStatus = completed
    ? 'completed'
    : running
      ? 'running'
      : stale
        ? 'stale'
        : sourceUnavailable
          ? 'source_unavailable'
          : errored
            ? 'error'
            : skipped
              ? 'skipped'
              : 'missing';

  return {
    date,
    runId: dataset?.runId ?? null,
    url: dataset?.url ?? null,
    status,
    runCount: sorted.length,
    importedCount: Number(selected?.imported_count ?? 0),
    snapshotCount: Number(selected?.snapshot_count ?? 0),
    errorCount: sorted.reduce((sum, row) => sum + Number(row.error_count ?? 0), 0),
    startedAt: selected?.started_at ?? null,
    completedAt: selected?.completed_at ?? null,
    message: selected?.message ?? null,
  };
}

function readDetailQueueSummary(db: Database): IndiegogoWebrobotsDiagnostics['detailQueue'] {
  if (!tableExists(db, 'platform_detail_queue')) return { total: 0, byStatus: {} };
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM platform_detail_queue
    WHERE platform_id = ?
    GROUP BY status
    ORDER BY count DESC
  `).all(PLATFORM_ID) as Array<{ status: string | null; count: number }>;
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const key = row.status || 'unknown';
    const count = Number(row.count ?? 0);
    byStatus[key] = count;
    total += count;
  }
  for (const status of ['queued', 'ok', 'error', 'invalid_slug']) {
    if (byStatus[status] === undefined) byStatus[status] = 0;
  }
  return { total, byStatus };
}

function readErrorSummary(db: Database): IndiegogoWebrobotsDiagnostics['errorSummary'] {
  if (!tableExists(db, 'platform_crawler_errors')) return [];
  return db.prepare(`
    SELECT job_type AS jobType,
           status_code AS statusCode,
           message,
           COUNT(*) AS count,
           MAX(occurred_at) AS lastOccurredAt
    FROM platform_crawler_errors
    WHERE platform_id = ?
    GROUP BY job_type, status_code, message
    ORDER BY lastOccurredAt DESC
    LIMIT 12
  `).all(PLATFORM_ID) as IndiegogoWebrobotsDiagnostics['errorSummary'];
}

function readWebrobotsRange(db: Database): IndiegogoWebrobotsDiagnostics['range'] {
  if (!tableExists(db, 'platform_snapshots')) {
    return { firstSnapshotAt: null, latestSnapshotAt: null, webrobotsProjects: 0, webrobotsSnapshots: 0, webrobotsDetails: 0 };
  }
  const firstSnapshotAt = scalarNullableNumber(db, `
    SELECT MIN(captured_at) AS value
    FROM platform_snapshots
    WHERE platform_id = @platform_id AND source = 'webrobots'
  `, { platform_id: PLATFORM_ID });
  const latestSnapshotAt = scalarNullableNumber(db, `
    SELECT MAX(captured_at) AS value
    FROM platform_snapshots
    WHERE platform_id = @platform_id AND source = 'webrobots'
  `, { platform_id: PLATFORM_ID });
  const webrobotsSnapshots = scalarNumber(db, `
    SELECT COUNT(*) AS value
    FROM platform_snapshots
    WHERE platform_id = @platform_id AND source = 'webrobots'
  `, { platform_id: PLATFORM_ID });
  const webrobotsProjects = tableExists(db, 'platform_projects')
    ? scalarNumber(db, `
        SELECT COUNT(*) AS value
        FROM platform_projects
        WHERE platform_id = @platform_id AND webrobots_run_id IS NOT NULL
      `, { platform_id: PLATFORM_ID })
    : 0;
  const webrobotsDetails = tableExists(db, 'indiegogo_project_details')
    ? scalarNumber(db, `
        SELECT COUNT(*) AS value
        FROM indiegogo_project_details
        WHERE platform_id = @platform_id AND source = 'webrobots'
      `, { platform_id: PLATFORM_ID })
    : 0;
  return { firstSnapshotAt, latestSnapshotAt, webrobotsProjects, webrobotsSnapshots, webrobotsDetails };
}

export async function getIndiegogoWebrobotsDiagnostics(): Promise<IndiegogoWebrobotsDiagnostics> {
  const checkedAt = nowSec();
  const dbPath = getPlatformDbPath(PLATFORM_ID);
  const databaseExists = fs.existsSync(dbPath);
  let index: IndiegogoWebrobotsIndex = { ok: false, datasetCount: 0, latestDate: null, latestUrl: null, datasets: [] };
  let sourceError: string | undefined;
  try {
    index = await fetchWebrobotsIndex();
    if (!index.ok) sourceError = 'Webrobots index returned a non-success response.';
  } catch (err) {
    sourceError = err instanceof Error ? err.message : String(err);
  }

  const emptyRange = { firstSnapshotAt: null, latestSnapshotAt: null, webrobotsProjects: 0, webrobotsSnapshots: 0, webrobotsDetails: 0 };
  if (!databaseExists) {
    const months = index.datasets.map(dataset => summarizeMonthStatus(dataset, dataset.date, []));
    return {
      checkedAt,
      databaseExists,
      source: {
        ok: index.ok,
        datasetCount: index.datasetCount,
        firstDate: index.datasets[0]?.date ?? null,
        latestDate: index.latestDate,
        latestUrl: index.latestUrl,
        error: sourceError,
      },
      coverage: {
        expected: index.datasetCount,
        completed: 0,
        missing: index.datasetCount,
        failed: 0,
        running: 0,
        stale: 0,
        sourceUnavailable: 0,
        skipped: 0,
        percent: index.datasetCount ? 0 : null,
      },
      range: emptyRange,
      detailQueue: { total: 0, byStatus: { queued: 0, ok: 0, error: 0, invalid_slug: 0 } },
      errorSummary: [],
      months,
    };
  }

  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    const runs = readWebrobotsRuns(db);
    const runsByDate = new Map<string, WebrobotsRunRow[]>();
    for (const run of runs) {
      const date = webrobotsDateFromJobType(run.job_type);
      if (!date) continue;
      const list = runsByDate.get(date) ?? [];
      list.push(run);
      runsByDate.set(date, list);
    }

    const sourceDates = index.ok
      ? index.datasets.map(dataset => dataset.date)
      : [...runsByDate.keys()].sort();
    const datasetByDate = new Map(index.datasets.map(dataset => [dataset.date, dataset]));
    const months = sourceDates.map(date => summarizeMonthStatus(datasetByDate.get(date) ?? null, date, runsByDate.get(date) ?? []));
    const completed = months.filter(month => month.status === 'completed').length;
    const running = months.filter(month => month.status === 'running').length;
    const stale = months.filter(month => month.status === 'stale').length;
    const sourceUnavailable = months.filter(month => month.status === 'source_unavailable').length;
    const failed = months.filter(month => month.status === 'error').length;
    const skipped = months.filter(month => month.status === 'skipped').length;
    const missing = months.filter(month => month.status === 'missing').length;
    const expected = sourceDates.length;

    return {
      checkedAt,
      databaseExists,
      source: {
        ok: index.ok,
        datasetCount: index.datasetCount,
        firstDate: index.datasets[0]?.date ?? null,
        latestDate: index.latestDate,
        latestUrl: index.latestUrl,
        error: sourceError,
      },
      coverage: {
        expected,
        completed,
        missing,
        failed,
        running,
        stale,
        sourceUnavailable,
        skipped,
        percent: expected ? Math.round((completed / expected) * 1000) / 10 : null,
      },
      range: readWebrobotsRange(db),
      detailQueue: readDetailQueueSummary(db),
      errorSummary: readErrorSummary(db),
      months,
    };
  } finally {
    db.close();
  }
}

async function checkDatasetAvailability(dataset: IndiegogoWebrobotsDataset): Promise<{
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bytes: number;
  message?: string;
}> {
  try {
    const res = await fetch(dataset.url, {
      method: 'HEAD',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/x-gzip,application/json,*/*',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok && res.status !== 405) {
      const sourceUnavailable = isSourceUnavailableStatus(res.status);
      return {
        ok: false,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: Number(res.headers.get('content-length') ?? 0) || 0,
        message: sourceUnavailable ? `Webrobots dataset HTTP ${res.status}` : `Webrobots dataset preflight HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes: Number(res.headers.get('content-length') ?? 0) || 0,
    };
  } catch {
    // Some hosts do not handle HEAD consistently; let the main GET path decide.
    return { ok: true, status: null, contentType: null, bytes: 0 };
  }
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
    const availability = await checkDatasetAvailability(dataset);
    if (!availability.ok) {
      storePayloadMeta(db, {
        sourceKey: dataset.url,
        kind: 'webrobots_dataset_head',
        statusCode: availability.status,
        contentType: availability.contentType,
        bytes: availability.bytes,
        preview: dataset.runId,
      });
      const message = availability.message ?? 'Webrobots dataset is not available.';
      recordError(db, { jobType: 'webrobots_import', url: dataset.url, statusCode: availability.status, message });
      completeRun(db, runId, { status: 'skipped', errors: 1, message });
      return { ok: false, rowsRead, imported, snapshots, queued, status: availability.status ?? undefined, message };
    }

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
    let nativeBatch: NativeProjectDetail[] = [];
    for await (const line of rl) {
      rowsRead++;
      try {
        const parsed = parseWebrobotsLine(line);
        const row = parsed ? normalizeWebrobotsRow(parsed) : null;
        if (row) {
          uniqueProjects.add(row.source_project_id);
          if (row.queue_detail && row.project_url_name) uniqueQueuedSlugs.add(row.project_url_name);
          batch.push(row);
          nativeBatch.push(nativeWebrobotsDetail(parsed as WebrobotsOuterRow, row));
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
        upsertIndiegogoProjectDetails(db, nativeBatch);
        snapshots += stored.snapshots;
        batch = [];
        nativeBatch = [];
      }
    }
    if (batch.length) {
      const stored = upsertStoredProjects(db, batch);
      upsertIndiegogoProjectDetails(db, nativeBatch);
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
    if (mode === 'missing') {
      const completedDates = completedWebrobotsDates(db);
      const runningDates = activeRunningWebrobotsDates(db);
      const unavailableDates = sourceUnavailableWebrobotsDates(db);
      datasets = index.datasets.filter(dataset =>
        !completedDates.has(dataset.date) &&
        !runningDates.has(dataset.date) &&
        !unavailableDates.has(dataset.date),
      );
    }
    if (options.maxDatasets && options.maxDatasets > 0) {
      datasets = datasets.slice(0, options.maxDatasets);
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
    const normalized: StoredProject[] = [];
    const nativeRows: NativeProjectDetail[] = [];
    for (const project of projects) {
      const slug = text(project.projectUrlName, 300) ?? projectUrlNameFromHomeUrl(project.projectHomeUrl);
      const normalizedProject = normalizeIndiegogoApiProject(project, existingSourceIdForSlug(db, slug));
      if (!normalizedProject) continue;
      const activeProject = { ...normalizedProject, snapshot_source: 'indiegogo_active' as const };
      normalized.push(activeProject);
      nativeRows.push(nativeApiProjectDetail(project, activeProject, 'active_api', res.status));
    }
    const stored = upsertStoredProjects(db, normalized);
    upsertIndiegogoProjectDetails(db, nativeRows);
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
  // 'queued'/'error' rows are first-time/retry fetches; 'ok' rows with a scheduled
  // next_fetch are the tiered live-tracking re-fetches (see indiegogoTrackInterval).
  return db.prepare(`
    SELECT project_url_name, source_project_id, COALESCE(attempts, 0) AS attempts
    FROM platform_detail_queue
    WHERE platform_id = @platform_id
      AND (
        (status IN ('queued', 'error') AND (next_fetch IS NULL OR next_fetch <= @now))
        OR (status = 'ok' AND next_fetch IS NOT NULL AND next_fetch <= @now)
      )
    ORDER BY priority DESC, COALESCE(next_fetch, 0) ASC, updated_at ASC
    LIMIT @limit
  `).all({ platform_id: PLATFORM_ID, now, limit }) as QueueRow[];
}

interface TrackSchedule {
  state: string;
  pledged_usd: number | null;
  backers: number | null;
  launched_at: number | null;
  deadline: number | null;
}

// Tiered live-tracking cadence, aligned with the Kickstarter tracker (db.ts
// markFetched): hot / first-day / last-48h projects refresh fast; long-tail
// projects far from their deadline refresh slowly; ended projects stop. This runs
// over the cheap detail API (no browser worker), so frequent tiers are affordable.
function indiegogoTrackInterval(p: TrackSchedule, now = nowSec()): number | null {
  if (p.state === 'live') {
    const launchedAt = Number(p.launched_at ?? 0);
    const deadline = Number(p.deadline ?? 0);
    const firstDay = launchedAt > 0 && now - launchedAt <= 24 * 3600;
    const lastTwoDays = deadline > 0 && deadline - now <= 48 * 3600;
    const hot = Number(p.pledged_usd ?? 0) >= 500_000 || Number(p.backers ?? 0) >= 5_000;
    const lowValue = Number(p.pledged_usd ?? 0) < 5_000 && Number(p.backers ?? 0) < 50;
    const farFromDeadline = deadline > 0 && deadline - now > 14 * 86400;
    if (firstDay || lastTwoDays) return 3600;
    if (hot) return 2 * 3600;
    if (lowValue && farFromDeadline) return 72 * 3600;
    return 24 * 3600;
  }
  if (p.state === 'indemand') return 24 * 3600; // ongoing post-campaign, slow cadence
  return null; // successful/failed/prelaunch -> stop re-tracking via this queue
}

function markDetailOk(db: Database, row: QueueRow, sourceProjectId: string, schedule?: TrackSchedule) {
  const now = nowSec();
  const interval = schedule ? indiegogoTrackInterval(schedule, now) : null;
  const nextFetch = interval == null ? null : now + interval;
  db.prepare(`
    UPDATE platform_detail_queue
    SET status = 'ok',
        source_project_id = @source_project_id,
        attempts = 0,
        next_fetch = @next_fetch,
        last_error = NULL,
        updated_at = @updated_at
    WHERE platform_id = @platform_id AND project_url_name = @project_url_name
  `).run({
    platform_id: PLATFORM_ID,
    project_url_name: row.project_url_name,
    source_project_id: sourceProjectId,
    next_fetch: nextFetch,
    updated_at: now,
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
          upsertIndiegogoProjectDetails(db, [nativeDetailResponse(row, result.status, result.text)]);
          invalid++;
          markDetailInvalid(db, row, result.text.slice(0, 500));
          continue;
        }
        if (!result.project) {
          upsertIndiegogoProjectDetails(db, [nativeDetailResponse(row, result.status, result.text)]);
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
          upsertIndiegogoProjectDetails(db, [nativeDetailResponse(row, result.status, result.text)]);
          failed++;
          const message = 'Detail API response did not include projectUrlName.';
          markDetailFailure(db, row, message);
          recordError(db, { jobType: 'detail_api', url: detailUrl, statusCode: result.status, message });
          continue;
        }
        const stored = upsertStoredProjects(db, [normalized]);
        upsertIndiegogoProjectDetails(db, [nativeApiProjectDetail(result.project, normalized, 'detail_api', result.status, result.text)]);
        markDetailOk(db, row, normalized.source_project_id, {
          state: normalized.state,
          pledged_usd: normalized.pledged_usd,
          backers: normalized.backers_count,
          launched_at: normalized.launched_at,
          deadline: normalized.deadline,
        });
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

// ── Real-time discovery (live worker) ─────────────────────────────────────────

export interface IndiegogoDiscoverOptions {
  maxPages?: number;
}

export interface IndiegogoDiscoverResult {
  ok: boolean;
  discovered: number;
  imported: number;
  snapshots: number;
  queued: number;
  pages: number;
  blocked: number;
  message?: string;
}

function ingestSearchCards(db: Database, items: IndiegogoSearchCard[]): { imported: number; snapshots: number; queued: number } {
  const batch: StoredProject[] = [];
  const native: NativeProjectDetail[] = [];
  for (const card of items) {
    const row = normalizeIndiegogoSearchCard(card);
    if (!row) continue;
    batch.push(row);
    native.push(nativeSearchCardDetail(card, row));
  }
  const stored = upsertStoredProjects(db, batch);
  upsertIndiegogoProjectDetails(db, native);
  return stored;
}

export async function discoverIndiegogoIncremental(options: IndiegogoDiscoverOptions = {}): Promise<IndiegogoDiscoverResult> {
  if (!indiegogoWorkerConfigured('live')) {
    return { ok: false, discovered: 0, imported: 0, snapshots: 0, queued: 0, pages: 0, blocked: 0, message: 'Indiegogo live worker is not configured (set INDIEGOGO_LIVE_WORKER_URL).' };
  }
  const maxPages = Math.max(1, options.maxPages ?? Number(process.env.INDIEGOGO_DISCOVER_MAX_PAGES ?? 5));
  const db = openPlatformSourceDb(PLATFORM_ID);
  const runId = startRun(db, 'discover');
  let discovered = 0;
  let imported = 0;
  let snapshots = 0;
  let queued = 0;
  let pages = 0;
  let blocked = 0;
  let errors = 0;
  try {
    // Newest across everything (new launches) + newest within the ongoing phase.
    const passes: IndiegogoSearchParams[] = [
      { sortType: SORT_NEWEST },
      { sortType: SORT_NEWEST, projectPhaseSearchTypes: [3] },
    ];
    for (const pass of passes) {
      for (let pageIndex = 1; pageIndex <= maxPages; pageIndex++) {
        const res = await searchIndiegogoViaWorker('live', { ...pass, pageIndex });
        pages++;
        if (!res.ok) {
          if (!res.cleared) blocked++;
          else errors++;
          recordError(db, { jobType: 'discover', message: res.error ?? 'search failed', statusCode: res.status ?? null, context: { pass, pageIndex } });
          break;
        }
        const items = res.items ?? [];
        discovered += items.length;
        const stored = ingestSearchCards(db, items);
        imported += stored.imported;
        snapshots += stored.snapshots;
        queued += stored.queued;
        if (items.length < SEARCH_PAGE_SIZE) break;
        if (res.totalPages && pageIndex >= res.totalPages) break;
        await sleep(SEARCH_PAGE_DELAY_MS);
      }
    }
    const ok = !(blocked > 0 && imported === 0);
    completeRun(db, runId, {
      status: ok ? 'completed' : 'error',
      discovered,
      imported,
      snapshots,
      pages,
      blocked,
      errors,
      message: `Discover: ${imported} projects, ${snapshots} snapshots, ${queued} queued for detail.`,
    });
    return { ok, discovered, imported, snapshots, queued, pages, blocked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(db, { jobType: 'discover', message });
    completeRun(db, runId, { status: 'error', discovered, imported, snapshots, pages, blocked, errors: errors + 1, message });
    return { ok: false, discovered, imported, snapshots, queued, pages, blocked, message };
  } finally {
    db.close();
  }
}

// ── Tiered live tracker (detail API, no browser worker) ───────────────────────

function autoTrackIndiegogoLive(db: Database, limit: number): number {
  const now = nowSec();
  const jitter = 24 * 3600; // spread first re-fetch across a day to avoid a thundering herd
  return db.prepare(`
    INSERT INTO platform_detail_queue
      (platform_id, project_url_name, source_project_id, status, priority, attempts, next_fetch, updated_at)
    SELECT platform_id, project_url_name, source_project_id, 'queued',
           CASE WHEN state = 'live' THEN 5 ELSE 1 END, 0,
           @now + (ABS(RANDOM()) % @jitter), @now
    FROM platform_projects
    WHERE platform_id = @platform_id
      AND state IN ('live', 'indemand')
      AND project_url_name IS NOT NULL
      AND COALESCE(is_prelaunch, 0) = 0
    ORDER BY COALESCE(deadline, 0) ASC
    LIMIT @limit
    ON CONFLICT(platform_id, project_url_name) DO NOTHING
  `).run({ platform_id: PLATFORM_ID, now, jitter, limit }).changes;
}

export interface IndiegogoTrackOptions {
  limit?: number;
  autoTrackLimit?: number;
}

export interface IndiegogoTrackResult {
  ok: boolean;
  enrolled: number;
  details: IndiegogoDetailResult;
}

export async function trackIndiegogoLive(options: IndiegogoTrackOptions = {}): Promise<IndiegogoTrackResult> {
  const db = openPlatformSourceDb(PLATFORM_ID);
  let enrolled = 0;
  try {
    enrolled = autoTrackIndiegogoLive(db, Math.max(1, options.autoTrackLimit ?? 500));
  } finally {
    db.close();
  }
  // Per-round detail batch. Env-tunable (INDIEGOGO_TRACK_LIMIT) so the large
  // legacy backlog can be drained from Railway without a code change; both the
  // cron pass and the manual panel button honour it.
  const defaultLimit = Math.max(1, Number(process.env.INDIEGOGO_TRACK_LIMIT ?? 50));
  const details = await refreshIndiegogoDetails({ limit: Math.max(1, options.limit ?? defaultLimit) });
  return { ok: details.ok, enrolled, details };
}

// ── Backlog catalog sweep (bulk worker, recursive partition, resumable) ────────

interface SliceRow {
  id: number;
  slice_key: string;
  sort_type: number;
  phase: number | null;
  category: string | null;
  tag: number | null;
  status: string;
  total_items: number | null;
  total_pages: number | null;
  capped: number;
  next_page: number;
  discovered: number;
}

export interface IndiegogoBacklogOptions {
  sweepId?: string;
  pageBudget?: number;
  sortType?: number;
}

export interface IndiegogoBacklogResult {
  ok: boolean;
  sweepId: string;
  pagesProcessed: number;
  imported: number;
  snapshots: number;
  slicesDone: number;
  slicesRemaining: number;
  blocked: number;
  message?: string;
}

function seedBacklogSlices(db: Database, sweepId: string, sortType: number) {
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM indiegogo_search_slices WHERE platform_id = ? AND sweep_id = ?`).get(PLATFORM_ID, sweepId) as { c: number };
  if (existing.c > 0) return;
  const insert = db.prepare(`
    INSERT INTO indiegogo_search_slices (platform_id, sweep_id, slice_key, sort_type, phase, status, priority, updated_at)
    VALUES (@platform_id, @sweep_id, @slice_key, @sort_type, @phase, 'pending', @priority, @now)
    ON CONFLICT(platform_id, sweep_id, slice_key) DO NOTHING
  `);
  const now = nowSec();
  for (const phase of INDIEGOGO_SEARCH_PHASES) {
    insert.run({ platform_id: PLATFORM_ID, sweep_id: sweepId, slice_key: `p${phase}`, sort_type: sortType, phase, priority: 0, now });
  }
}

function expandCategorySlices(db: Database, sweepId: string, parent: SliceRow) {
  const insert = db.prepare(`
    INSERT INTO indiegogo_search_slices (platform_id, sweep_id, slice_key, sort_type, phase, category, status, priority, updated_at)
    VALUES (@platform_id, @sweep_id, @slice_key, @sort_type, @phase, @category, 'pending', @priority, @now)
    ON CONFLICT(platform_id, sweep_id, slice_key) DO NOTHING
  `);
  const now = nowSec();
  for (const category of INDIEGOGO_CATEGORIES) {
    insert.run({
      platform_id: PLATFORM_ID,
      sweep_id: sweepId,
      slice_key: `p${parent.phase}:${category}`,
      sort_type: parent.sort_type,
      phase: parent.phase,
      category,
      priority: 1,
      now,
    });
  }
}

function addNewestSibling(db: Database, sweepId: string, slice: SliceRow) {
  // A category that is still capped under one sort can surface different top-10k
  // items under the newest sort; add that sibling once for extra coverage.
  if (slice.sort_type !== SORT_TRENDING) return;
  db.prepare(`
    INSERT INTO indiegogo_search_slices (platform_id, sweep_id, slice_key, sort_type, phase, category, tag, status, priority, updated_at)
    VALUES (@platform_id, @sweep_id, @slice_key, @sort_type, @phase, @category, @tag, 'pending', @priority, @now)
    ON CONFLICT(platform_id, sweep_id, slice_key) DO NOTHING
  `).run({
    platform_id: PLATFORM_ID,
    sweep_id: sweepId,
    slice_key: `${slice.slice_key}:newest`,
    sort_type: SORT_NEWEST,
    phase: slice.phase,
    category: slice.category,
    tag: slice.tag,
    priority: 1,
    now: nowSec(),
  });
}

function nextBacklogSlice(db: Database, sweepId: string): SliceRow | null {
  return (db.prepare(`
    SELECT id, slice_key, sort_type, phase, category, tag, status, total_items, total_pages, capped, next_page, discovered
    FROM indiegogo_search_slices
    WHERE platform_id = ? AND sweep_id = ? AND status IN ('pending', 'in_progress')
    ORDER BY priority ASC, status DESC, id ASC
    LIMIT 1
  `).get(PLATFORM_ID, sweepId) as SliceRow | undefined) ?? null;
}

export async function runIndiegogoBacklogSweep(options: IndiegogoBacklogOptions = {}): Promise<IndiegogoBacklogResult> {
  const sweepId = options.sweepId ?? 'catalog';
  if (!indiegogoWorkerConfigured('bulk')) {
    return { ok: false, sweepId, pagesProcessed: 0, imported: 0, snapshots: 0, slicesDone: 0, slicesRemaining: 0, blocked: 0, message: 'Indiegogo bulk worker is not configured (set INDIEGOGO_BULK_WORKER_URL).' };
  }
  const pageBudget = Math.max(1, options.pageBudget ?? Number(process.env.INDIEGOGO_BACKLOG_PAGE_BUDGET ?? 40));
  const sortType = options.sortType ?? SORT_TRENDING;
  const maxPagesPerSlice = Math.ceil(SEARCH_QUERY_CAP / SEARCH_PAGE_SIZE); // 417

  const db = openPlatformSourceDb(PLATFORM_ID);
  const runId = startRun(db, 'backlog_sweep');
  let pagesProcessed = 0;
  let imported = 0;
  let snapshots = 0;
  let blocked = 0;
  let errors = 0;
  try {
    seedBacklogSlices(db, sweepId, sortType);

    while (pagesProcessed < pageBudget) {
      const slice = nextBacklogSlice(db, sweepId);
      if (!slice) break;

      const params: IndiegogoSearchParams = {
        sortType: slice.sort_type,
        pageIndex: slice.next_page,
        projectPhaseSearchTypes: slice.phase == null ? [] : [slice.phase],
        projectCatalogCategories: slice.category ? [slice.category] : [],
        projectTags: slice.tag ? [slice.tag] : [],
      };
      const res = await searchIndiegogoViaWorker('bulk', params);
      pagesProcessed++;

      if (!res.ok) {
        if (!res.cleared) blocked++;
        else errors++;
        db.prepare(`UPDATE indiegogo_search_slices SET last_error = ?, updated_at = ? WHERE id = ?`)
          .run((res.error ?? 'search failed').slice(0, 500), nowSec(), slice.id);
        recordError(db, { jobType: 'backlog_sweep', message: res.error ?? 'search failed', statusCode: res.status ?? null, context: { slice: slice.slice_key } });
        if (!res.cleared) break; // worker can't clear Cloudflare; stop this run
        continue;
      }

      // First page of a slice: learn its size and decide whether to split.
      if (slice.next_page === 1) {
        const capped = res.capped ? 1 : 0;
        db.prepare(`UPDATE indiegogo_search_slices SET total_items = ?, total_pages = ?, capped = ?, updated_at = ? WHERE id = ?`)
          .run(Number(res.total ?? 0), Number(res.totalPages ?? 0), capped, nowSec(), slice.id);

        if (capped && slice.phase != null && !slice.category) {
          expandCategorySlices(db, sweepId, slice);
          db.prepare(`UPDATE indiegogo_search_slices SET status = 'split', updated_at = ? WHERE id = ?`).run(nowSec(), slice.id);
          continue; // don't page the over-capped parent; its children cover it
        }
        if (capped && slice.category) {
          addNewestSibling(db, sweepId, slice);
        }
      }

      const items = res.items ?? [];
      const stored = ingestSearchCards(db, items);
      imported += stored.imported;
      snapshots += stored.snapshots;

      const totalPages = Math.min(Number(res.totalPages ?? slice.next_page), maxPagesPerSlice);
      const nextPage = slice.next_page + 1;
      const done = items.length < SEARCH_PAGE_SIZE || nextPage > totalPages;
      db.prepare(`
        UPDATE indiegogo_search_slices
        SET status = ?, next_page = ?, discovered = discovered + ?, last_error = NULL, updated_at = ?
        WHERE id = ?
      `).run(done ? 'done' : 'in_progress', nextPage, items.length, nowSec(), slice.id);

      await sleep(SEARCH_PAGE_DELAY_MS);
    }

    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status IN ('pending', 'in_progress') THEN 1 ELSE 0 END) AS remaining
      FROM indiegogo_search_slices WHERE platform_id = ? AND sweep_id = ?
    `).get(PLATFORM_ID, sweepId) as { done: number | null; remaining: number | null };
    const slicesDone = Number(counts.done ?? 0);
    const slicesRemaining = Number(counts.remaining ?? 0);

    completeRun(db, runId, {
      status: blocked > 0 && imported === 0 ? 'error' : 'completed',
      discovered: pagesProcessed,
      imported,
      snapshots,
      pages: pagesProcessed,
      blocked,
      errors,
      message: `Backlog sweep '${sweepId}': ${imported} projects this run; slices ${slicesDone} done / ${slicesRemaining} remaining.`,
    });
    return { ok: !(blocked > 0 && imported === 0), sweepId, pagesProcessed, imported, snapshots, slicesDone, slicesRemaining, blocked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordError(db, { jobType: 'backlog_sweep', message });
    completeRun(db, runId, { status: 'error', discovered: pagesProcessed, imported, snapshots, pages: pagesProcessed, blocked, errors: errors + 1, message });
    return { ok: false, sweepId, pagesProcessed, imported, snapshots, slicesDone: 0, slicesRemaining: 0, blocked, message };
  } finally {
    db.close();
  }
}

export interface IndiegogoBacklogStatus {
  sweepId: string;
  totalSlices: number;
  byStatus: Record<string, number>;
  discovered: number;
  capped: number;
  updatedAt: number | null;
}

export function getIndiegogoBacklogStatus(sweepId = 'catalog'): IndiegogoBacklogStatus {
  const dbPath = getPlatformDbPath(PLATFORM_ID);
  const empty: IndiegogoBacklogStatus = { sweepId, totalSlices: 0, byStatus: {}, discovered: 0, capped: 0, updatedAt: null };
  if (!fs.existsSync(dbPath)) return empty;
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, 'indiegogo_search_slices')) return empty;
    const rows = db.prepare(`
      SELECT status, COUNT(*) AS count, COALESCE(SUM(discovered), 0) AS discovered,
             COALESCE(SUM(capped), 0) AS capped, MAX(updated_at) AS updatedAt
      FROM indiegogo_search_slices WHERE platform_id = ? AND sweep_id = ?
      GROUP BY status
    `).all(PLATFORM_ID, sweepId) as Array<{ status: string; count: number; discovered: number; capped: number; updatedAt: number }>;
    const byStatus: Record<string, number> = {};
    let total = 0;
    let discovered = 0;
    let capped = 0;
    let updatedAt: number | null = null;
    for (const row of rows) {
      byStatus[row.status || 'unknown'] = Number(row.count ?? 0);
      total += Number(row.count ?? 0);
      discovered += Number(row.discovered ?? 0);
      capped += Number(row.capped ?? 0);
      updatedAt = Math.max(updatedAt ?? 0, Number(row.updatedAt ?? 0)) || updatedAt;
    }
    return { sweepId, totalSlices: total, byStatus, discovered, capped, updatedAt };
  } finally {
    db.close();
  }
}

export interface IndiegogoCategoryCensusRow {
  category: string;
  count: number;
  live: number;
}

// Read-only census of the distinct stored `category` values so we can size the
// KS↔IGG taxonomy gap before writing a unified mapping. Values are a mix of
// webrobots strings + search catalogCategory display names + nulls.
export function getIndiegogoCategoryCensus(): IndiegogoCategoryCensusRow[] {
  const dbPath = getPlatformDbPath(PLATFORM_ID);
  if (!fs.existsSync(dbPath)) return [];
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    if (!tableExists(db, 'platform_projects')) return [];
    return db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(category), ''), '(uncategorized)') AS category,
             COUNT(*) AS count,
             SUM(CASE WHEN state IN ('live', 'indemand') THEN 1 ELSE 0 END) AS live
      FROM platform_projects
      WHERE platform_id = ?
      GROUP BY COALESCE(NULLIF(TRIM(category), ''), '(uncategorized)')
      ORDER BY count DESC
    `).all(PLATFORM_ID) as IndiegogoCategoryCensusRow[];
  } finally {
    db.close();
  }
}

export function pauseIndiegogoBacklogSweep(sweepId = 'catalog'): number {
  const db = openPlatformSourceDb(PLATFORM_ID);
  try {
    return db.prepare(`
      UPDATE indiegogo_search_slices SET status = 'paused', updated_at = ?
      WHERE platform_id = ? AND sweep_id = ? AND status IN ('pending', 'in_progress')
    `).run(nowSec(), PLATFORM_ID, sweepId).changes;
  } finally {
    db.close();
  }
}

export function resumeIndiegogoBacklogSweep(sweepId = 'catalog'): number {
  const db = openPlatformSourceDb(PLATFORM_ID);
  try {
    return db.prepare(`
      UPDATE indiegogo_search_slices
      SET status = CASE WHEN next_page > 1 THEN 'in_progress' ELSE 'pending' END, updated_at = ?
      WHERE platform_id = ? AND sweep_id = ? AND status = 'paused'
    `).run(nowSec(), PLATFORM_ID, sweepId).changes;
  } finally {
    db.close();
  }
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
