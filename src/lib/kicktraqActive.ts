import {
  completeCrawlRun,
  insertSnapshot,
  insertSyncLog,
  recordCrawlerError,
  saveDB,
  startCrawlRun,
  updateSyncLog,
  upsertProjects,
  getProjectIdBySlug,
  mergeKicktraqIntoProject,
} from './db';
import { updateSyncState } from './syncState';
import { resolveUsdAmounts } from './money';

const KICKTRAQ_ACTIVE_URL = 'https://www.kicktraq.com/projects/';

// Kicktraq lists amounts in the campaign's native currency. Route them through the
// shared resolver so a non-USD project never gets stored with goal/usd_pledged = 0
// (the old `currency === 'USD' ? amount : 0` logic silently dropped every JPY/EUR/…
// figure, producing the "$0 goal" rows in the project list).
function ktUsd(project: KicktraqListProject): { pledgedUsd: number; goalUsd: number } {
  const { pledgedUsd, goalUsd } = resolveUsdAmounts({
    pledgedLocal: project.pledged,
    goalLocal: project.goal,
    currency: project.currency,
  });
  return { pledgedUsd, goalUsd };
}

interface KicktraqListProject {
  id: string;
  name: string;
  blurb: string | null;
  creator_slug: string;
  slug: string;
  category_parent: string | null;
  category_name: string | null;
  backers_count: number;
  pledged: number;
  goal: number;
  currency: string | null;
  launched_at: number | null;
  deadline: number | null;
  source_url: string;
}

export interface KicktraqActiveSyncResult {
  pages: number;
  imported: number;
  snapshots: number;
  stoppedReason: 'completed' | 'max_pages' | 'error';
  message?: string;
}

export interface KicktraqActiveSyncOptions {
  maxPages?: number;
  since?: number;
  until?: number;
  onlyCurrentlyLive?: boolean;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '->')
    .replace(/-&gt;/g, '->')
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
}

function parseMoney(raw: string | undefined): { amount: number; currency: string | null } {
  if (!raw) return { amount: 0, currency: null };
  const currencySymbol = raw.match(/[^\d,.\s-]/)?.[0] ?? null;
  const amount = parseFloat(raw.replace(/[^\d.-]/g, '')) || 0;
  const currencyMap: Record<string, string> = {
    '$': 'USD',
    '£': 'GBP',
    '€': 'EUR',
    '¥': 'JPY',
    'A': 'AUD',
    'C': 'CAD',
  };
  return { amount, currency: currencySymbol ? currencyMap[currencySymbol] ?? currencySymbol : null };
}

function parseMoneySafe(raw: string | undefined): { amount: number; currency: string | null } {
  if (!raw) return { amount: 0, currency: null };
  const amount = parseFloat(raw.replace(/[^\d.-]/g, '')) || 0;
  let currency: string | null = null;
  if (/HK\$/i.test(raw)) currency = 'HKD';
  else if (/US\$/i.test(raw) || /\bUSD\b/i.test(raw)) currency = 'USD';
  else if (/A\$/i.test(raw)) currency = 'AUD';
  else if (/C\$/i.test(raw)) currency = 'CAD';
  else if (raw.includes('$')) currency = 'USD';
  else if (/[\u00a5\uffe5]|JPY|¥/i.test(raw)) currency = 'JPY';
  else if (/[\u00a3]|GBP|£/i.test(raw)) currency = 'GBP';
  else if (/[\u20ac]|EUR|€/i.test(raw)) currency = 'EUR';
  return { amount, currency };
}

function parseCampaignDate(monthDay: string, year: number): number | null {
  const clean = `${monthDay.replace(/(\d+)(st|nd|rd|th)/i, '$1')} ${year}`;
  const ts = Date.parse(`${clean} UTC`);
  return Number.isNaN(ts) ? null : Math.floor(ts / 1000);
}

function parseCampaignDates(details: string): { launched_at: number | null; deadline: number | null } {
  const match = details.match(/Campaign Dates:\s*([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)\s*->\s*([A-Za-z]+\s+\d+(?:st|nd|rd|th)?)\s*\((\d{4})\)/i);
  if (!match) return { launched_at: null, deadline: null };
  const endYear = parseInt(match[3]);
  const deadline = parseCampaignDate(match[2], endYear);
  let launchYear = endYear;
  let launchedAt = parseCampaignDate(match[1], launchYear);
  if (launchedAt && deadline && launchedAt > deadline) {
    launchYear = endYear - 1;
    launchedAt = parseCampaignDate(match[1], launchYear);
  }
  return {
    launched_at: launchedAt,
    deadline,
  };
}

function parseCategories(block: string): { category_parent: string | null; category_name: string | null } {
  const catMatch = block.match(/<div class="project-cat">([\s\S]*?)<\/div>/);
  if (!catMatch) return { category_parent: null, category_name: null };
  const cats = [...catMatch[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map(m => stripTags(m[1]));
  return {
    category_parent: cats[0] ?? null,
    category_name: cats[1] ?? cats[0] ?? null,
  };
}

function parseProjectBlock(block: string): KicktraqListProject | null {
  const hrefMatch = block.match(/<h2>\s*<a href="\/projects\/([^/"]+)\/([^/"]+)\/">([\s\S]*?)<\/a>\s*<\/h2>/);
  if (!hrefMatch) return null;

  const creatorSlug = decodeURIComponent(hrefMatch[1]);
  const slug = decodeURIComponent(hrefMatch[2]);
  const name = stripTags(hrefMatch[3]);
  if (!name) return null;

  const afterTitle = block.slice((hrefMatch.index ?? 0) + hrefMatch[0].length);
  const blurbMatch = afterTitle.match(/<div>([\s\S]*?)<\/div>/);
  const blurb = blurbMatch ? stripTags(blurbMatch[1]) : null;
  const detailsMatch = block.match(/<div class="project-details">([\s\S]*?)<\/div>/);
  const details = detailsMatch ? stripTags(detailsMatch[1]) : '';
  const backers = parseInt(details.match(/Backers:\s*([\d,]+)/i)?.[1]?.replace(/,/g, '') ?? '0') || 0;
  const fundingMatch = details.match(/Funding:\s*([^<]+?)\s+of\s+([^<(]+)\s*\(/i);
  const pledged = parseMoneySafe(fundingMatch?.[1]);
  const goal = parseMoneySafe(fundingMatch?.[2]);
  const { category_parent, category_name } = parseCategories(block);
  const dates = parseCampaignDates(details);
  const sourceUrl = `https://www.kickstarter.com/projects/${creatorSlug}/${slug}`;

  return {
    id: `kt:${creatorSlug}--${slug}`,
    name,
    blurb,
    creator_slug: creatorSlug,
    slug,
    category_parent,
    category_name,
    backers_count: backers,
    pledged: pledged.amount,
    goal: goal.amount,
    currency: pledged.currency ?? goal.currency,
    launched_at: dates.launched_at,
    deadline: dates.deadline,
    source_url: sourceUrl,
  };
}

function parseProjects(html: string): KicktraqListProject[] {
  const blocks = [...html.matchAll(/<div class="project(?:\s[^"]*)?">([\s\S]*?)(?=<div class="project(?:\s[^"]*)?">|<div class="ribbon|<hr noshade="noshade">)/g)];
  return blocks
    .map(match => parseProjectBlock(match[0]))
    .filter((project): project is KicktraqListProject => !!project);
}

function maxPageFromHtml(html: string): number {
  const pages = [...html.matchAll(/href="\?page=(\d+)"/g)].map(m => parseInt(m[1]) || 0);
  return Math.max(1, ...pages);
}

async function fetchActivePage(page: number): Promise<string> {
  const url = page === 1 ? KICKTRAQ_ACTIVE_URL : `${KICKTRAQ_ACTIVE_URL}?page=${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kicksonar/0.1)' },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Kicktraq active HTTP ${res.status} on page ${page}`);
  return res.text();
}

function inferProjectState(project: KicktraqListProject, now: number): string {
  if (project.deadline && project.deadline > now) return 'live';
  if (project.goal > 0 && project.pledged >= project.goal) return 'successful';
  if (project.deadline && project.deadline <= now) return 'failed';
  // Unknown deadline — assume still running (will be corrected on next snapshot).
  return 'live';
}

function toProjectRows(projects: KicktraqListProject[], now: number): Record<string, unknown>[] {
  return projects.map(project => {
    const { pledgedUsd, goalUsd } = ktUsd(project);
    return {
    id: project.id,
    name: project.name,
    blurb: project.blurb,
    goal: goalUsd,
    pledged: project.pledged,
    usd_pledged: pledgedUsd,
    state: inferProjectState(project, now),
    country: null,
    country_name: null,
    currency: project.currency,
    category_id: null,
    category_name: project.category_name,
    category_parent: project.category_parent,
    backers_count: project.backers_count,
    staff_pick: 0,
    created_at: null,
    launched_at: project.launched_at,
    deadline: project.deadline,
    creator_name: project.creator_slug,
    creator_slug: project.creator_slug,
    creator_url: `https://www.kickstarter.com/profile/${project.creator_slug}`,
    source_url: project.source_url,
    slug: project.slug,
    data_source: 'kicktraq_active',
    first_seen_at: now,
    last_seen_at: now,
    webrobots_synced_at: null,
    ks_live_synced_at: null,
  };
  });
}

function filterProjects(projects: KicktraqListProject[], options: Required<Pick<KicktraqActiveSyncOptions, 'since' | 'until' | 'onlyCurrentlyLive'>>) {
  return projects.filter(project => {
    // Drop empty / broken entries (kicktraq sometimes serves placeholder cards with no name).
    if (!project.name || (project.backers_count === 0 && project.pledged <= 0)) return false;
    // Reject projects with neither a parsable launch date nor any funding signal.
    if (!project.launched_at && project.backers_count === 0 && project.pledged <= 0) return false;
    if (project.launched_at && (project.launched_at < options.since || project.launched_at > options.until)) return false;
    // `onlyCurrentlyLive` used to require deadline > now, but kicktraq's listing pages
    // now mostly surface popular-but-recently-ended projects — applying that filter
    // dropped 100% of imports. We still want to capture them (they're real KS projects
    // with valid funding data); inferProjectState marks them as ended for downstream
    // consumers.
    void options.onlyCurrentlyLive;
    return true;
  });
}

async function storeProjects(projects: KicktraqListProject[], now: number) {
  // Split into: projects that already exist in DB (by slug) vs truly new ones
  const newProjects: KicktraqListProject[] = [];
  let merged = 0;

  for (const project of projects) {
    const canonicalId = getProjectIdBySlug(project.creator_slug, project.slug);
    const { pledgedUsd } = ktUsd(project);
    if (canonicalId) {
      // Already in DB from webrobots/KS-live — just enrich + add snapshot
      mergeKicktraqIntoProject(canonicalId, {
        backers_count: project.backers_count,
        pledged_usd: pledgedUsd > 0 ? pledgedUsd : null,
        launched_at: project.launched_at,
        deadline: project.deadline,
        category_parent: project.category_parent,
        category_name: project.category_name,
      });
      insertSnapshot({
        project_id: canonicalId,
        captured_at: now,
        pledged_usd: pledgedUsd,
        backers_count: project.backers_count,
        days_to_go: project.deadline ? Math.max(0, Math.round((project.deadline - now) / 86400)) : 0,
        comments_count: 0,
        updates_count: 0,
        state: inferProjectState(project, now),
        source: 'kicktraq_active',
      });
      merged++;
    } else {
      newProjects.push(project);
    }
  }

  // Insert truly new projects (not in DB yet)
  const rows = toProjectRows(newProjects, now);
  const imported = rows.length ? await upsertProjects(rows) : 0;
  let snapshots = merged; // already counted merged snapshots above

  for (const project of newProjects) {
    insertSnapshot({
      project_id: project.id,
      captured_at: now,
      pledged_usd: ktUsd(project).pledgedUsd,
      backers_count: project.backers_count,
      days_to_go: project.deadline ? Math.max(0, Math.round((project.deadline - now) / 86400)) : 0,
      comments_count: 0,
      updates_count: 0,
      state: inferProjectState(project, now),
      source: 'kicktraq_active',
    });
    snapshots++;
  }

  return { imported: imported + merged, snapshots };
}

export async function runKicktraqActiveSync(options: KicktraqActiveSyncOptions = {}): Promise<KicktraqActiveSyncResult> {
  const startedAt = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);
  const since = options.since ?? 0;
  const until = options.until ?? now;
  const onlyCurrentlyLive = options.onlyCurrentlyLive ?? true;
  let logId: number | undefined;
  let imported = 0;
  let snapshots = 0;
  let pages = 0;
  let projectsFound = 0;
  let crawlRunId: number | undefined;

  updateSyncState({
    status: 'running',
    message: 'Importing Kicktraq active projects...',
    progress: 2,
    startedAt,
    completedAt: null,
    recordsImported: 0,
    error: null,
    lastUrl: KICKTRAQ_ACTIVE_URL,
  });

  try {
    crawlRunId = startCrawlRun('kicktraq_active', 'active_projects');
    logId = await insertSyncLog({
      url: `kicktraq_active:maxPages=${options.maxPages ?? 'all'}:since=${since}:until=${until}:onlyLive=${onlyCurrentlyLive}`,
      started_at: startedAt,
      status: 'running',
    });

    const firstHtml = await fetchActivePage(1);
    const totalPages = Math.min(maxPageFromHtml(firstHtml), Math.max(1, options.maxPages ?? Number.MAX_SAFE_INTEGER));

    for (let page = 1; page <= totalPages; page++) {
      pages = page;
      const html = page === 1 ? firstHtml : await fetchActivePage(page);
      const projects = filterProjects(parseProjects(html), { since, until, onlyCurrentlyLive });
      projectsFound += projects.length;
      const stored = await storeProjects(projects, now);
      imported += stored.imported;
      snapshots += stored.snapshots;

      updateSyncState({
        message: `Imported Kicktraq page ${page}/${totalPages} (${imported.toLocaleString()} projects)...`,
        progress: Math.min(95, Math.floor((page / totalPages) * 95)),
        recordsImported: imported,
      });

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    await saveDB();
    const completedAt = new Date().toISOString();
    completeCrawlRun(crawlRunId, {
      status: 'completed',
      discovered_count: projectsFound,
      imported_count: imported,
      snapshot_count: snapshots,
      page_count: pages,
      message: `Kicktraq active import completed: ${imported.toLocaleString()} projects.`,
    });
    updateSyncState({
      status: 'completed',
      message: `Kicktraq active import completed: ${imported.toLocaleString()} projects.`,
      progress: 100,
      completedAt,
      recordsImported: imported,
    });
    if (logId) {
      await updateSyncLog(logId, { completed_at: completedAt, records_imported: imported, status: 'completed' });
    }
    return {
      pages,
      imported,
      snapshots,
      stoppedReason: options.maxPages && pages >= options.maxPages ? 'max_pages' : 'completed',
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const completedAt = new Date().toISOString();
    completeCrawlRun(crawlRunId, {
      status: 'error',
      discovered_count: projectsFound,
      imported_count: imported,
      snapshot_count: snapshots,
      page_count: pages,
      error_count: 1,
      message,
    });
    recordCrawlerError({
      source: 'kicktraq_active',
      job_type: 'active_projects',
      url: KICKTRAQ_ACTIVE_URL,
      message,
      context: { pages, maxPages: options.maxPages, since, until, onlyCurrentlyLive },
    });
    updateSyncState({ status: 'error', message: `Kicktraq active import failed: ${message}`, error: message, completedAt, progress: 0 });
    if (logId) await updateSyncLog(logId, { completed_at: completedAt, status: 'error', error_message: message });
    return { pages, imported, snapshots, stoppedReason: 'error', message };
  }
}
