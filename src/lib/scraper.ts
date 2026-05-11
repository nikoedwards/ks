import {
  insertSnapshot,
  insertRewardSnapshots,
  insertTextIfChanged,
  insertComment,
  markFetched,
  type RewardSnapshot,
} from './db';

// ─── KS JSON API types ────────────────────────────────────────────────────────

interface KSReward {
  id: number;
  title?: string;
  description?: string;
  minimum: number | string;
  backers_count: number;
  limit?: number | null;
  limited?: boolean;
  remaining?: number | null;
}

interface KSProject {
  id: number;
  name: string;
  blurb?: string;
  state: string;
  slug?: string;
  pledged: number | string;
  usd_pledged?: string | number;
  converted_pledged_amount?: number;
  goal: number | string;
  backers_count: number;
  comments_count?: number;
  updates_count?: number;
  deadline?: number;
  rewards?: KSReward[];
  creator?: { name?: string; slug?: string };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function extractCreatorSlug(sourceUrl: string): string | null {
  const m = sourceUrl.match(/kickstarter\.com\/projects\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function extractProjectSlug(sourceUrl: string): string | null {
  const m = sourceUrl.match(/kickstarter\.com\/projects\/[^/?#]+\/([^/?#]+)/);
  return m ? m[1] : null;
}

export function buildKSJsonUrl(sourceUrl: string): string | null {
  if (!sourceUrl?.startsWith('https://www.kickstarter.com/projects/')) return null;
  return sourceUrl.endsWith('.json') ? sourceUrl : sourceUrl.replace(/\/$/, '') + '.json';
}

function parseNum(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  return typeof v === 'number' ? v : parseFloat(v) || 0;
}

function daysToGo(deadline: number | undefined): number {
  if (!deadline) return 0;
  return Math.max(0, Math.round((deadline * 1000 - Date.now()) / 86_400_000));
}

// ─── KS JSON scraper ─────────────────────────────────────────────────────────

export async function scrapeKSJson(jsonUrl: string): Promise<KSProject | null> {
  try {
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KicksOnar/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as KSProject | { project: KSProject };
    return 'project' in data ? data.project : data;
  } catch {
    return null;
  }
}

export interface ScrapeOptions {
  track_rewards?: number;
  track_comments?: number;
  track_text_diff?: number;
}

export async function scrapeAndStore(projectId: string, jsonUrl: string, opts: ScrapeOptions = {}): Promise<boolean> {
  const p = await scrapeKSJson(jsonUrl);
  if (!p) return false;

  const now = Math.floor(Date.now() / 1000);
  const pledgedUsd = parseNum(p.usd_pledged ?? p.converted_pledged_amount ?? p.pledged);

  // Basic snapshot
  insertSnapshot({
    project_id: projectId,
    captured_at: now,
    pledged_usd: pledgedUsd,
    backers_count: p.backers_count ?? 0,
    days_to_go: daysToGo(p.deadline),
    comments_count: p.comments_count ?? 0,
    updates_count: p.updates_count ?? 0,
    state: p.state ?? 'unknown',
  });

  // Rewards snapshot
  if (opts.track_rewards && p.rewards?.length) {
    const rewards: RewardSnapshot[] = p.rewards.map(r => ({
      reward_id: String(r.id),
      title: r.title ?? '',
      description: r.description ?? '',
      amount_usd: parseNum(r.minimum),
      backers_count: r.backers_count ?? 0,
      limit_count: r.limit ?? null,
      is_limited: r.limited ? 1 : 0,
    }));
    insertRewardSnapshots(projectId, now, rewards);
  }

  // Text diff tracking
  if (opts.track_text_diff) {
    if (p.name) insertTextIfChanged(projectId, now, 'name', p.name);
    if (p.blurb) insertTextIfChanged(projectId, now, 'blurb', p.blurb);
  }

  markFetched(projectId);
  return true;
}

// ─── Kicktraq HTML scraper ────────────────────────────────────────────────────

export interface KicktraqDay {
  date: string;
  pledged_usd: number;
  backers: number;
  comments?: number;
}

interface DailyChartJson {
  // Shape 1: { dates: [...], pledged: [...], backers: [...], comments: [...] }
  dates?: string[];
  pledged?: number[];
  backers?: number[];
  comments?: number[];
  // Shape 2: { data: { dates, pledged, backers, comments } }
  data?: {
    dates?: string[];
    pledged?: number[];
    backers?: number[];
    comments?: number[];
  };
  // Shape 3: Google Charts DataTable rows
  rows?: Array<[string, number, number, number?]>;
  // Shape 4: { chart_data: { pledged, backers, comments, start_date } }
  chart_data?: {
    pledged?: number[];
    backers?: number[];
    comments?: number[];
    start_date?: string;
  };
}

function parseDailyChartJson(json: DailyChartJson): KicktraqDay[] | null {
  const days: KicktraqDay[] = [];

  // Shape 1 & 2: dates array + parallel arrays
  const src = json.data ?? json;
  const dates = (src as DailyChartJson).dates;
  const pledged = (src as DailyChartJson).pledged;
  const backers = (src as DailyChartJson).backers;
  const comments = (src as DailyChartJson).comments;

  if (dates?.length && pledged?.length) {
    for (let i = 0; i < dates.length; i++) {
      days.push({
        date: normalizeDate(dates[i]),
        pledged_usd: pledged[i] ?? 0,
        backers: backers?.[i] ?? 0,
        comments: comments?.[i],
      });
    }
    return days.length ? days : null;
  }

  // Shape 3: rows array
  if (json.rows?.length) {
    for (const row of json.rows) {
      days.push({
        date: normalizeDate(row[0]),
        pledged_usd: row[1] ?? 0,
        backers: row[2] ?? 0,
        comments: row[3],
      });
    }
    return days.length ? days : null;
  }

  // Shape 4: chart_data with start_date
  if (json.chart_data?.pledged?.length && json.chart_data?.start_date) {
    const start = new Date(json.chart_data.start_date);
    const p = json.chart_data.pledged;
    const b = json.chart_data.backers ?? [];
    const c = json.chart_data.comments ?? [];
    for (let i = 0; i < p.length; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({
        date: d.toISOString().slice(0, 10),
        pledged_usd: p[i] ?? 0,
        backers: b[i] ?? 0,
        comments: c[i],
      });
    }
    return days.length ? days : null;
  }

  return null;
}

export async function scrapeKicktraq(creatorSlug: string, projectSlug: string): Promise<KicktraqDay[]> {
  const { days } = await scrapeKicktraqDebug(creatorSlug, projectSlug);
  return days;
}

export interface KicktraqDebugInfo {
  pageUrl: string;
  pageStatus: number | null;
  pageLength: number;
  cookieCount: number;
  jsonStatus: number | null;
  jsonBody: string;
  jsonParsed: boolean;
  jsonDays: number;
  htmlPatterns: string[];
  htmlDays: number;
}

export async function scrapeKicktraqDebug(creatorSlug: string, projectSlug: string): Promise<{ days: KicktraqDay[]; debug: KicktraqDebugInfo }> {
  const pageUrl = `https://www.kicktraq.com/projects/${creatorSlug}/${projectSlug}/`;
  const jsonUrl = `${pageUrl}dailychart.json`;

  const debug: KicktraqDebugInfo = {
    pageUrl,
    pageStatus: null,
    pageLength: 0,
    cookieCount: 0,
    jsonStatus: null,
    jsonBody: '',
    jsonParsed: false,
    jsonDays: 0,
    htmlPatterns: [],
    htmlDays: 0,
  };

  // Step 1: fetch main page
  let html = '';
  let cookieStr = '';
  try {
    const pageRes = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    debug.pageStatus = pageRes.status;
    if (pageRes.status === 404) return { days: [], debug };
    if (!pageRes.ok) return { days: [], debug };

    html = await pageRes.text();
    debug.pageLength = html.length;

    const setCookie = pageRes.headers.getSetCookie?.() ?? [];
    cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
    debug.cookieCount = setCookie.length;

    // Check what patterns exist in HTML
    const patterns: Record<string, RegExp> = {
      addRows: /addRows\s*\(\s*\[/,
      pledgeData: /var\s+pledgeData/,
      backerData: /var\s+backerData/,
      commentData: /var\s+commentData/,
      startDate: /var\s+startDate/,
      chart_data: /"chart_data"/,
      dailychart: /dailychart/,
      googleViz: /google\.visualization/,
    };
    for (const [name, re] of Object.entries(patterns)) {
      if (re.test(html)) debug.htmlPatterns.push(name);
    }

    // Capture the context around 'dailychart' to understand how it's called
    const dcIdx = html.indexOf('dailychart');
    if (dcIdx >= 0) {
      debug.htmlPatterns.push('CONTEXT:' + html.slice(Math.max(0, dcIdx - 100), dcIdx + 300).replace(/\s+/g, ' '));
    }

    // Capture all script tag contents for analysis
    const scriptMatches = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const sm of scriptMatches) {
      const c = sm[1].trim();
      if (c.length > 30 && (c.includes('chart') || c.includes('pledge') || c.includes('backer') || c.includes('daily'))) {
        debug.htmlPatterns.push('SCRIPT:' + c.slice(0, 400).replace(/\s+/g, ' '));
      }
    }
  } catch (e) {
    debug.pageStatus = -1;
    debug.jsonBody = String(e);
    return { days: [], debug };
  }

  // Step 2: try dailychart.json with session cookie
  try {
    const jsonRes = await fetch(jsonUrl, {
      headers: {
        'Referer': pageUrl,
        'Origin': 'https://www.kicktraq.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        ...(cookieStr ? { 'Cookie': cookieStr } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    debug.jsonStatus = jsonRes.status;
    const text = await jsonRes.text();
    debug.jsonBody = text.slice(0, 600); // more context

    if (jsonRes.ok && text && !text.trim().startsWith('<') && !text.includes('invalid request')) {
      try {
        const json = JSON.parse(text);
        debug.jsonParsed = true;
        const days = parseDailyChartJson(json);
        debug.jsonDays = days?.length ?? 0;
        if (days?.length) return { days, debug };
      } catch { /* fall through */ }
    }
  } catch (e) {
    debug.jsonStatus = -1;
    debug.jsonBody = String(e);
  }

  // Step 3: HTML fallback
  const htmlDays = parseKicktraqHtml(html);
  debug.htmlDays = htmlDays.length;
  return { days: htmlDays, debug };
}

function parseKicktraqHtml(html: string): KicktraqDay[] {
  // Kicktraq embeds Google Charts DataTable rows: ['Jan 15, 2023',100,5,...]
  // Try multiple patterns
  const days: KicktraqDay[] = [];

  // Pattern 1: addRows with date + pledged + backers [+ comments]
  const rowsMatch = html.match(/addRows\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (rowsMatch) {
    const entries = rowsMatch[1].matchAll(/\[\s*['"]([^'"]+)['"]\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?/g);
    for (const m of entries) {
      days.push({
        date: normalizeDate(m[1]),
        pledged_usd: parseFloat(m[2]),
        backers: parseInt(m[3]),
        comments: m[4] ? parseInt(m[4]) : undefined,
      });
    }
    if (days.length) return days;
  }

  // Pattern 2: JavaScript arrays pledgeData / backerData / commentData + startDate
  const pledgeMatch = html.match(/var\s+(?:pledge|pledged?)Data\s*=\s*\[([^\]]+)\]/);
  const backerMatch = html.match(/var\s+(?:backer|backers?)Data\s*=\s*\[([^\]]+)\]/);
  const commentMatch = html.match(/var\s+(?:comment|comments?)Data\s*=\s*\[([^\]]+)\]/);
  const startMatch = html.match(/var\s+startDate\s*=\s*['"]([^'"]+)['"]/);

  if (pledgeMatch && startMatch) {
    const pledged = pledgeMatch[1].split(',').map(s => parseFloat(s.trim()) || 0);
    const backers = backerMatch ? backerMatch[1].split(',').map(s => parseInt(s.trim()) || 0) : [];
    const comments = commentMatch ? commentMatch[1].split(',').map(s => parseInt(s.trim()) || 0) : [];
    const start = new Date(startMatch[1]);
    for (let i = 0; i < pledged.length; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({
        date: d.toISOString().slice(0, 10),
        pledged_usd: pledged[i],
        backers: backers[i] ?? 0,
        comments: comments[i],
      });
    }
    if (days.length) return days;
  }

  // Pattern 3: JSON object with chart_data
  const chartMatch = html.match(/"chart_data"\s*:\s*\{([\s\S]*?)\}/);
  if (chartMatch) {
    const pledgedArr = chartMatch[1].match(/"pledged"\s*:\s*\[([^\]]+)\]/);
    const backersArr = chartMatch[1].match(/"backers"\s*:\s*\[([^\]]+)\]/);
    const commentsArr = chartMatch[1].match(/"comments"\s*:\s*\[([^\]]+)\]/);
    const startDateM = html.match(/"start_date"\s*:\s*"([^"]+)"/);
    if (pledgedArr && startDateM) {
      const pledged = pledgedArr[1].split(',').map(Number);
      const backerVals = backersArr ? backersArr[1].split(',').map(Number) : [];
      const commentVals = commentsArr ? commentsArr[1].split(',').map(Number) : [];
      const start = new Date(startDateM[1]);
      for (let i = 0; i < pledged.length; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        days.push({
          date: d.toISOString().slice(0, 10),
          pledged_usd: pledged[i],
          backers: backerVals[i] ?? 0,
          comments: commentVals[i],
        });
      }
    }
  }

  return days;
}

function normalizeDate(raw: string): string {
  // "Jan 15, 2023" → "2023-01-15"
  try {
    return new Date(raw).toISOString().slice(0, 10);
  } catch {
    return raw;
  }
}

export function storeKicktraqDays(projectId: string, days: KicktraqDay[]) {
  for (const d of days) {
    const capturedAt = Math.floor(new Date(d.date + 'T12:00:00Z').getTime() / 1000);
    insertSnapshot({
      project_id: projectId,
      captured_at: capturedAt,
      pledged_usd: d.pledged_usd,
      backers_count: d.backers,
      days_to_go: 0,
      comments_count: d.comments ?? 0,
      updates_count: 0,
      state: 'historical',
      source: 'kicktraq',
    });
  }
}
