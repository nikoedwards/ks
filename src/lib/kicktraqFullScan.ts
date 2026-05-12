/**
 * kicktraqFullScan.ts
 *
 * One-time (or periodic) full scan of all Kicktraq category pages.
 * Since /archive/ is disabled, this is the only way to get broad coverage
 * beyond the main /projects/ active list.
 *
 * Strategy:
 *   1. Iterate every known category + subcategory URL
 *   2. For each category, paginate through all pages
 *   3. Deduplicate against existing DB records via slug matching
 *   4. Insert new projects; enrich existing ones
 *
 * Estimated scale: ~2800 active projects across all categories.
 * Runtime: ~15-30 min at 300ms/page delay.
 */

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

// ─── All Kicktraq category URLs ───────────────────────────────────────────────

export const KICKTRAQ_CATEGORIES: string[] = [
  // Art
  'art', 'art/ceramics', 'art/conceptual%20art', 'art/digital%20art',
  'art/illustration', 'art/installations', 'art/mixed%20media', 'art/painting',
  'art/performance%20art', 'art/public%20art', 'art/sculpture', 'art/textiles',
  'art/video%20art',
  // Comics
  'comics', 'comics/anthologies', 'comics/comic%20books', 'comics/events',
  'comics/graphic%20novels', 'comics/webcomics',
  // Crafts
  'crafts', 'crafts/candles', 'crafts/crochet', 'crafts/diy', 'crafts/embroidery',
  'crafts/glass', 'crafts/knitting', 'crafts/letterpress', 'crafts/pottery',
  'crafts/printing', 'crafts/quilts', 'crafts/stationery', 'crafts/taxidermy',
  'crafts/weaving', 'crafts/woodworking',
  // Dance
  'dance', 'dance/performances', 'dance/residencies', 'dance/spaces', 'dance/workshops',
  // Design
  'design', 'design/architecture', 'design/civic%20design', 'design/graphic%20design',
  'design/interactive%20design', 'design/product%20design', 'design/typography',
  // Fashion
  'fashion', 'fashion/accessories', 'fashion/apparel', 'fashion/couture',
  'fashion/footwear', 'fashion/jewelry', 'fashion/pet%20fashion', 'fashion/ready-to-wear',
  // Film & Video
  'film%20&%20video', 'film%20&%20video/action', 'film%20&%20video/animation',
  'film%20&%20video/comedy', 'film%20&%20video/documentary', 'film%20&%20video/drama',
  'film%20&%20video/experimental', 'film%20&%20video/family', 'film%20&%20video/festivals',
  'film%20&%20video/horror', 'film%20&%20video/movie%20theaters',
  'film%20&%20video/music%20videos', 'film%20&%20video/narrative%20film',
  'film%20&%20video/romance', 'film%20&%20video/science%20fiction',
  'film%20&%20video/shorts', 'film%20&%20video/television', 'film%20&%20video/thrillers',
  'film%20&%20video/webseries',
  // Food
  'food', 'food/bacon', 'food/community%20gardens', 'food/cookbooks', 'food/drinks',
  'food/events', "food/farmer's%20markets", 'food/farms', 'food/food%20trucks',
  'food/restaurants', 'food/small%20batch', 'food/spaces', 'food/vegan',
  // Games
  'games', 'games/gaming%20hardware', 'games/live%20games', 'games/mobile%20games',
  'games/playing%20cards', 'games/puzzles', 'games/tabletop%20games', 'games/toys',
  'games/video%20games',
  // Journalism
  'journalism', 'journalism/audio', 'journalism/fantasy', 'journalism/photo',
  'journalism/print', 'journalism/video',
  // Music
  'music', 'music/blues', 'music/chiptune', 'music/classical%20music',
  'music/country%20&%20folk', 'music/electronic%20music', 'music/faith',
  'music/hip-hop', 'music/indie%20rock', 'music/jazz', 'music/kids', 'music/latin',
  'music/metal', 'music/pop', 'music/punk', 'music/r&b', 'music/rock',
  'music/world%20music',
  // Photography
  'photography', 'photography/animals', 'photography/fine%20art', 'photography/nature',
  'photography/people', 'photography/photobooks', 'photography/places',
  // Publishing
  'publishing', 'publishing/academic', 'publishing/anthologies', 'publishing/art%20book',
  'publishing/art%20books', 'publishing/calendars', "publishing/children's%20books",
  'publishing/fiction', 'publishing/literary%20journals', 'publishing/literary%20spaces',
  'publishing/nonfiction', 'publishing/periodicals', 'publishing/poetry',
  'publishing/radio%20&%20podcasts', 'publishing/translations', 'publishing/young%20adult',
  'publishing/zines',
  // Social Practice
  'social%20practice',
  // Technology
  'technology', 'technology/3d%20printing', 'technology/apps',
  'technology/camera%20equipment', 'technology/diy%20electronics',
  'technology/fabrication%20tools', 'technology/flight', 'technology/gadgets',
  'technology/hardware', 'technology/makerspaces', 'technology/robots',
  'technology/software', 'technology/sound', 'technology/space',
  'technology/space%20exploration', 'technology/wearables', 'technology/web',
  // Theater
  'theater', 'theater/experimental', 'theater/festivals', 'theater/immersive',
  'theater/musical', 'theater/plays', 'theater/spaces',
];

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface FullScanResult {
  categoriesScanned: number;
  pagesScanned: number;
  projectsFound: number;
  imported: number;
  merged: number;
  stoppedReason: 'completed' | 'error' | 'aborted';
  message?: string;
}

export interface FullScanOptions {
  /** Delay between page requests in ms (default 350) */
  delayMs?: number;
  /** Max pages per category (default unlimited) */
  maxPagesPerCategory?: number;
  /** Only scan these category slugs (default: all) */
  categories?: string[];
  /** Resume from this category index (for restart) */
  resumeFromIndex?: number;
}

// ─── HTML helpers (shared with kicktraqActive) ────────────────────────────────

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&rarr;/g, '->').replace(/-&gt;/g, '->')
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
    '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', 'A': 'AUD', 'C': 'CAD',
  };
  return { amount, currency: currencySymbol ? currencyMap[currencySymbol] ?? currencySymbol : null };
}

function parseMoneySafe(raw: string | undefined): { amount: number; currency: string | null } {
  if (!raw) return { amount: 0, currency: null };
  const amount = parseFloat(raw.replace(/[^\d.-]/g, '')) || 0;
  let currency: string | null = null;
  if (/A\$/i.test(raw)) currency = 'AUD';
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
  return { launched_at: launchedAt, deadline };
}

function parseCategories(block: string): { category_parent: string | null; category_name: string | null } {
  const catMatch = block.match(/<div class="project-cat">([\s\S]*?)<\/div>/);
  if (!catMatch) return { category_parent: null, category_name: null };
  const cats = [...catMatch[1].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map(m => stripTags(m[1]));
  return { category_parent: cats[0] ?? null, category_name: cats[1] ?? cats[0] ?? null };
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
    name, blurb, creator_slug: creatorSlug, slug,
    category_parent, category_name,
    backers_count: backers,
    pledged: pledged.amount, goal: goal.amount,
    currency: pledged.currency ?? goal.currency,
    launched_at: dates.launched_at, deadline: dates.deadline,
    source_url: sourceUrl,
  };
}

function parseProjects(html: string): KicktraqListProject[] {
  const blocks = [...html.matchAll(/<div class="project(?:\s[^"]*)?">([\s\S]*?)(?=<div class="project(?:\s[^"]*)?">|<div class="ribbon|<hr noshade="noshade">)/g)];
  return blocks
    .map(match => parseProjectBlock(match[0]))
    .filter((p): p is KicktraqListProject => !!p);
}

function maxPageFromHtml(html: string): number {
  const pages = [...html.matchAll(/href="\?page=(\d+)"/g)].map(m => parseInt(m[1]) || 0);
  return Math.max(1, ...pages);
}

async function fetchCategoryPage(categorySlug: string, page: number): Promise<string> {
  const base = `https://www.kicktraq.com/categories/${categorySlug}/`;
  const url = page === 1 ? base : `${base}?page=${page}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kicksonar/0.1)' },
    signal: AbortSignal.timeout(25_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Kicktraq category HTTP ${res.status} for ${categorySlug} page ${page}`);
  return res.text();
}

// ─── Store helpers ────────────────────────────────────────────────────────────

function toProjectRow(project: KicktraqListProject, now: number): Record<string, unknown> {
  return {
    id: project.id,
    name: project.name,
    blurb: project.blurb,
    goal: project.currency === 'USD' ? project.goal : 0,
    pledged: project.pledged,
    usd_pledged: project.currency === 'USD' ? project.pledged : 0,
    state: 'live',
    country: null, country_name: null,
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
    source_url: project.source_url,
    slug: project.slug,
    data_source: 'kicktraq_active',
    first_seen_at: now, last_seen_at: now,
    webrobots_synced_at: null, ks_live_synced_at: null,
  };
}

async function storeProjectBatch(
  projects: KicktraqListProject[],
  now: number,
): Promise<{ imported: number; merged: number }> {
  const newProjects: KicktraqListProject[] = [];
  let merged = 0;

  for (const project of projects) {
    const canonicalId = getProjectIdBySlug(project.creator_slug, project.slug);
    if (canonicalId) {
      mergeKicktraqIntoProject(canonicalId, {
        backers_count: project.backers_count,
        pledged_usd: project.currency === 'USD' ? project.pledged : null,
        launched_at: project.launched_at,
        deadline: project.deadline,
        category_parent: project.category_parent,
        category_name: project.category_name,
      });
      insertSnapshot({
        project_id: canonicalId,
        captured_at: now,
        pledged_usd: project.currency === 'USD' ? project.pledged : 0,
        backers_count: project.backers_count,
        days_to_go: project.deadline ? Math.max(0, Math.round((project.deadline - now) / 86400)) : 0,
        comments_count: 0, updates_count: 0,
        state: 'live', source: 'kicktraq_active',
      });
      merged++;
    } else {
      newProjects.push(project);
    }
  }

  let imported = 0;
  if (newProjects.length) {
    const rows = newProjects.map(p => toProjectRow(p, now));
    imported = await upsertProjects(rows);
    for (const project of newProjects) {
      insertSnapshot({
        project_id: project.id,
        captured_at: now,
        pledged_usd: project.currency === 'USD' ? project.pledged : 0,
        backers_count: project.backers_count,
        days_to_go: project.deadline ? Math.max(0, Math.round((project.deadline - now) / 86400)) : 0,
        comments_count: 0, updates_count: 0,
        state: 'live', source: 'kicktraq_active',
      });
    }
  }

  return { imported, merged };
}

// ─── Abort signal (allows stopping mid-scan) ──────────────────────────────────

let _abortFullScan = false;
export function abortFullScan() { _abortFullScan = true; }

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runKicktraqFullScan(options: FullScanOptions = {}): Promise<FullScanResult> {
  _abortFullScan = false;
  const delayMs = options.delayMs ?? 350;
  const maxPagesPerCategory = options.maxPagesPerCategory ?? 999;
  const categoriesToScan = options.categories ?? KICKTRAQ_CATEGORIES;
  const resumeFrom = options.resumeFromIndex ?? 0;
  const startedAt = new Date().toISOString();
  const now = Math.floor(Date.now() / 1000);

  let categoriesScanned = 0;
  let pagesScanned = 0;
  let projectsFound = 0;
  let totalImported = 0;
  let totalMerged = 0;
  let logId: number | undefined;
  let crawlRunId: number | undefined;

  updateSyncState({
    status: 'running',
    message: `Starting Kicktraq full scan (${categoriesToScan.length} categories)...`,
    progress: 1,
    startedAt,
    completedAt: null,
    recordsImported: 0,
    error: null,
    lastUrl: 'https://www.kicktraq.com/categories/',
  });

  try {
    crawlRunId = startCrawlRun('kicktraq_full_scan', 'category_scan');
    logId = await insertSyncLog({
      url: `kicktraq_full_scan:categories=${categoriesToScan.length}:resumeFrom=${resumeFrom}`,
      started_at: startedAt,
      status: 'running',
    });

    for (let ci = resumeFrom; ci < categoriesToScan.length; ci++) {
      if (_abortFullScan) {
        const msg = `Scan aborted at category ${ci}/${categoriesToScan.length}`;
        completeCrawlRun(crawlRunId, {
          status: 'aborted',
          discovered_count: projectsFound,
          imported_count: totalImported + totalMerged,
          snapshot_count: totalImported + totalMerged,
          page_count: pagesScanned,
          message: msg,
        });
        await finalize(logId, totalImported + totalMerged, 'error', msg);
        return { categoriesScanned, pagesScanned, projectsFound, imported: totalImported, merged: totalMerged, stoppedReason: 'aborted', message: msg };
      }

      const catSlug = categoriesToScan[ci];
      const progress = Math.min(98, Math.floor((ci / categoriesToScan.length) * 95) + 1);

      updateSyncState({
        message: `Scanning category ${ci + 1}/${categoriesToScan.length}: ${catSlug} (${totalImported + totalMerged} total so far)`,
        progress,
        recordsImported: totalImported + totalMerged,
        lastUrl: `https://www.kicktraq.com/categories/${catSlug}/`,
      });

      try {
        const firstHtml = await fetchCategoryPage(catSlug, 1);
        const totalPages = Math.min(maxPageFromHtml(firstHtml), maxPagesPerCategory);

        for (let page = 1; page <= totalPages; page++) {
          const html = page === 1 ? firstHtml : await fetchCategoryPage(catSlug, page);
          const projects = parseProjects(html);
          projectsFound += projects.length;

          if (projects.length) {
            const { imported, merged } = await storeProjectBatch(projects, now);
            totalImported += imported;
            totalMerged += merged;
          }

          pagesScanned++;
          await new Promise(resolve => setTimeout(resolve, delayMs));

          if (_abortFullScan) break;
        }

        categoriesScanned++;
      } catch (catErr) {
        // Log category error but continue with next category
        console.warn(`[kicktraqFullScan] Error on category ${catSlug}:`, catErr);
        recordCrawlerError({
          source: 'kicktraq_full_scan',
          job_type: 'category_scan',
          url: `https://www.kicktraq.com/categories/${catSlug}/`,
          message: catErr instanceof Error ? catErr.message : String(catErr),
          context: { category: catSlug, categoryIndex: ci },
        });
      }

      // Checkpoint save every 20 categories
      if (categoriesScanned % 20 === 0) {
        await saveDB();
      }
    }

    await saveDB();
    const msg = `Full scan complete: ${categoriesScanned} categories, ${pagesScanned} pages, ${projectsFound} projects found, ${totalImported} new + ${totalMerged} merged`;
    completeCrawlRun(crawlRunId, {
      status: 'completed',
      discovered_count: projectsFound,
      imported_count: totalImported + totalMerged,
      snapshot_count: totalImported + totalMerged,
      page_count: pagesScanned,
      message: msg,
    });
    await finalize(logId, totalImported + totalMerged, 'completed', msg);
    return { categoriesScanned, pagesScanned, projectsFound, imported: totalImported, merged: totalMerged, stoppedReason: 'completed', message: msg };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    completeCrawlRun(crawlRunId, {
      status: 'error',
      discovered_count: projectsFound,
      imported_count: totalImported + totalMerged,
      snapshot_count: totalImported + totalMerged,
      page_count: pagesScanned,
      error_count: 1,
      message,
    });
    recordCrawlerError({
      source: 'kicktraq_full_scan',
      job_type: 'category_scan',
      message,
      context: { categoriesScanned, pagesScanned, projectsFound },
    });
    await finalize(logId, totalImported + totalMerged, 'error', message);
    return { categoriesScanned, pagesScanned, projectsFound, imported: totalImported, merged: totalMerged, stoppedReason: 'error', message };
  }
}

async function finalize(logId: number | undefined, records: number, status: string, message: string) {
  const completedAt = new Date().toISOString();
  updateSyncState({
    status: status as 'completed' | 'error',
    message,
    progress: status === 'completed' ? 100 : 0,
    completedAt,
    recordsImported: records,
  });
  if (logId) {
    await updateSyncLog(logId, {
      completed_at: completedAt,
      records_imported: records,
      status,
      error_message: status !== 'completed' ? message : undefined,
    });
  }
}
