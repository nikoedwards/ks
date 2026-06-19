import http from 'node:http';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.PROBE_TOKEN || '').trim();
const TARGET_URL = process.env.PROBE_TARGET_URL || 'https://www.indiegogo.com/en/projects/search';
const ACTIVE_API_URL = process.env.PROBE_ACTIVE_API_URL || 'https://www.indiegogo.com/api/public/projects/getActiveCrowdfundingProjects';
const DISCOVER_API_URL = process.env.PROBE_DISCOVER_API_URL || 'https://www.indiegogo.com/private_api/discover';
const CLEAR_MAX_MS = clampNumber(process.env.PROBE_CLEAR_MS, 15_000, 180_000, 90_000);
const SCROLLS = clampNumber(process.env.PROBE_SCROLLS, 0, 12, 3);
const RUN_ON_BOOT = /^(1|true|yes)$/i.test(process.env.PROBE_RUN_ON_BOOT || '0');
const SAMPLE_LIMIT = clampNumber(process.env.PROBE_SAMPLE_LIMIT, 1, 50, 12);
const ENDPOINT_LIMIT = clampNumber(process.env.PROBE_ENDPOINT_LIMIT, 5, 100, 40);
const RESPONSE_PREVIEW_CHARS = clampNumber(process.env.PROBE_RESPONSE_PREVIEW_CHARS, 0, 2000, 500);

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--disable-features=IsolateOrigins,site-per-process',
];

let running = false;
let report = baseReport('idle');

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function baseReport(status) {
  return {
    ok: status !== 'error',
    status,
    running,
    targetUrl: TARGET_URL,
    startedAt: null,
    finishedAt: null,
    config: {
      clearMs: CLEAR_MAX_MS,
      scrolls: SCROLLS,
      sampleLimit: SAMPLE_LIMIT,
      endpointLimit: ENDPOINT_LIMIT,
    },
    cleared: false,
    blocked: null,
    pageTitle: null,
    finalUrl: null,
    projectSource: null,
    searchPageProjectCount: 0,
    projectCount: 0,
    sampleProjects: [],
    dataAccess: {
      ok: false,
      projectCount: 0,
      sources: [],
    },
    networkEndpoints: [],
    jsonProjectHints: [],
    errors: [],
  };
}

function isBlockedText(text, url = '') {
  const haystack = `${text || ''}\n${url || ''}`;
  return /just a moment|cf_chl|enable javascript and cookies|attention required|access denied|cloudflare|__cf_chl/i.test(haystack);
}

function compactText(value, limit = 500) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
}

function authed(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN}` || req.headers['x-probe-token'] === TOKEN;
}

function endpointInteresting(url, contentType) {
  return (
    /json|graphql|api|project|campaign|search|discover/i.test(url) ||
    /json|graphql/i.test(contentType || '')
  );
}

function summarizeJsonProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const lower = new Set(keys.map((key) => key.toLowerCase()));
  const hasName = lower.has('title') || lower.has('name') || lower.has('projectname') || lower.has('project_name');
  const hasUrl = lower.has('url') || lower.has('href') || lower.has('projecthomeurl') || lower.has('clickthrough_url');
  const hasProjectSignal =
    lower.has('projectid') ||
    lower.has('project_id') ||
    lower.has('projecturlname') ||
    lower.has('fundsgathered') ||
    lower.has('funds_raised_amount') ||
    lower.has('campaigngoal');
  if (!hasName || (!hasUrl && !hasProjectSignal)) return null;
  return {
    title: value.title || value.name || value.projectName || value.project_name || null,
    url: value.url || value.href || value.projectHomeUrl || value.clickthrough_url || null,
    image: value.image || value.imageUrl || value.projectImageUrl || value.image_url || null,
    category: value.category || value.categoryName || value.category_name || null,
    amount: value.fundsGathered ?? value.funds_raised_amount ?? value.pledged ?? null,
    currency: value.currencyShortName || value.currency || null,
  };
}

function collectProjectHints(value, out = [], seen = new Set(), depth = 0) {
  if (!value || typeof value !== 'object' || depth > 6 || out.length >= SAMPLE_LIMIT) return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectProjectHints(item, out, seen, depth + 1);
    return out;
  }
  const summary = summarizeJsonProject(value);
  if (summary) out.push(summary);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectProjectHints(child, out, seen, depth + 1);
    if (out.length >= SAMPLE_LIMIT) break;
  }
  return out;
}

function stableEndpointKey(item) {
  return `${item.method || 'GET'} ${item.status || 0} ${item.url}`;
}

function normalizeIndiegogoProject(project, source) {
  if (!project || typeof project !== 'object') return null;
  const title = project.projectName || project.title || project.name || project.project_name || null;
  const href = project.projectHomeUrl || project.url || project.href || project.clickthrough_url || null;
  const slug = project.projectUrlName || project.project_url_name || null;
  const normalizedHref = href
    ? String(href)
    : slug
      ? `https://www.indiegogo.com/projects/${slug}`
      : null;
  if (!title && !normalizedHref) return null;
  return {
    source,
    title,
    href: normalizedHref,
    image: project.projectImageUrl || project.image_url || project.imageUrl || project.image || null,
    category: project.category || project.categoryName || project.category_name || null,
    currency: project.currencyShortName || project.currency || null,
    amount: project.fundsGathered ?? project.funds_raised_amount ?? project.pledged ?? null,
    goal: project.campaignGoal ?? project.goal ?? null,
    startDate: project.campaignStartDate || project.open_date || null,
    endDate: project.campaignEndDate || project.close_date || null,
    text: compactText(project.shortDescription || project.tagline || project.description || '', 700),
  };
}

function normalizeProjectArray(value, source) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.projects)
      ? value.projects
      : Array.isArray(value?.response?.projects)
        ? value.response.projects
        : Array.isArray(value?.data)
          ? value.data
          : [];
  const projects = rows
    .map((project) => normalizeIndiegogoProject(project, source))
    .filter(Boolean);
  return projects;
}

function discoverPayload() {
  return {
    category_main: null,
    category_top_level: null,
    page_num: 1,
    per_page: SAMPLE_LIMIT,
    project_timing: 'all',
    project_type: 'campaign',
    q: '',
    sort: 'trending',
    tags: [],
  };
}

async function probeJsonEndpointFromNode({ label, url, method = 'GET', body = null }) {
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://www.indiegogo.com',
        Referer: TARGET_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      body: body ? JSON.stringify(body) : null,
    });
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    let parsed = null;
    if (/json/i.test(contentType)) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    const projects = parsed ? normalizeProjectArray(parsed, label) : [];
    return {
      source: label,
      transport: 'node_fetch',
      ok: res.ok && projects.length > 0,
      status: res.status,
      contentType,
      projectCount: projects.length,
      sampleProjects: projects.slice(0, SAMPLE_LIMIT),
      bodyPreview: compactText(text, RESPONSE_PREVIEW_CHARS),
    };
  } catch (err) {
    return {
      source: label,
      transport: 'node_fetch',
      ok: false,
      status: null,
      contentType: null,
      projectCount: 0,
      sampleProjects: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeJsonEndpointFromBrowser(page, { label, url, method = 'GET', body = null }) {
  try {
    return await page.evaluate(
      async ({ label: innerLabel, url: innerUrl, method: innerMethod, body: innerBody, limit, previewChars, targetUrl }) => {
        const clean = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
        const normalize = (project) => {
          if (!project || typeof project !== 'object') return null;
          const title = project.projectName || project.title || project.name || project.project_name || null;
          const href = project.projectHomeUrl || project.url || project.href || project.clickthrough_url || null;
          const slug = project.projectUrlName || project.project_url_name || null;
          const normalizedHref = href ? String(href) : slug ? `https://www.indiegogo.com/projects/${slug}` : null;
          if (!title && !normalizedHref) return null;
          return {
            source: innerLabel,
            title,
            href: normalizedHref,
            image: project.projectImageUrl || project.image_url || project.imageUrl || project.image || null,
            category: project.category || project.categoryName || project.category_name || null,
            currency: project.currencyShortName || project.currency || null,
            amount: project.fundsGathered ?? project.funds_raised_amount ?? project.pledged ?? null,
            goal: project.campaignGoal ?? project.goal ?? null,
            startDate: project.campaignStartDate || project.open_date || null,
            endDate: project.campaignEndDate || project.close_date || null,
            text: clean(project.shortDescription || project.tagline || project.description || '', 700),
          };
        };
        const normalizeRows = (value) => {
          const rows = Array.isArray(value)
            ? value
            : Array.isArray(value?.projects)
              ? value.projects
              : Array.isArray(value?.response?.projects)
                ? value.response.projects
                : Array.isArray(value?.data)
                  ? value.data
                  : [];
          return rows.map(normalize).filter(Boolean);
        };
        const res = await fetch(innerUrl, {
          method: innerMethod,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: targetUrl,
          },
          body: innerBody ? JSON.stringify(innerBody) : null,
        });
        const contentType = res.headers.get('content-type') || '';
        const text = await res.text();
        let parsed = null;
        if (/json/i.test(contentType)) {
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
        }
        const projects = parsed ? normalizeRows(parsed) : [];
        return {
          source: innerLabel,
          transport: 'browser_fetch',
          ok: res.ok && projects.length > 0,
          status: res.status,
          contentType,
          projectCount: projects.length,
          sampleProjects: projects.slice(0, limit),
          bodyPreview: clean(text, previewChars),
        };
      },
      {
        label,
        url,
        method,
        body,
        limit: SAMPLE_LIMIT,
        previewChars: RESPONSE_PREVIEW_CHARS,
        targetUrl: TARGET_URL,
      },
    );
  } catch (err) {
    return {
      source: label,
      transport: 'browser_fetch',
      ok: false,
      status: null,
      contentType: null,
      projectCount: 0,
      sampleProjects: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeDataAccess(page) {
  const checks = [
    await probeJsonEndpointFromBrowser(page, { label: 'active_api', url: ACTIVE_API_URL }),
    await probeJsonEndpointFromNode({ label: 'active_api', url: ACTIVE_API_URL }),
    await probeJsonEndpointFromBrowser(page, { label: 'discover_api', url: DISCOVER_API_URL, method: 'POST', body: discoverPayload() }),
    await probeJsonEndpointFromNode({ label: 'discover_api', url: DISCOVER_API_URL, method: 'POST', body: discoverPayload() }),
  ];
  const best = checks.find((check) => check.ok) || null;
  return {
    ok: Boolean(best),
    projectCount: best?.projectCount ?? 0,
    bestSource: best ? `${best.source}:${best.transport}` : null,
    sampleProjects: best?.sampleProjects ?? [],
    sources: checks,
  };
}

async function waitForCloudflareClear(page, url, maxMs) {
  const start = Date.now();
  let lastBlocked = true;
  let lastTitle = null;
  let lastUrl = url;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(maxMs, 60_000) });
  } catch (err) {
    report.errors.push({ stage: 'goto', message: err instanceof Error ? err.message : String(err) });
  }

  while (Date.now() - start < maxMs) {
    const state = await page
      .evaluate(() => ({
        title: document.title,
        url: location.href,
        bodyText: (document.body?.innerText || '').slice(0, 5000),
        projectLinks: document.querySelectorAll('a[href*="/projects/"]').length,
      }))
      .catch(() => null);

    if (state) {
      lastTitle = state.title;
      lastUrl = state.url;
      lastBlocked = isBlockedText(`${state.title}\n${state.bodyText}`, state.url);
      if (!lastBlocked && state.projectLinks > 0) {
        return { cleared: true, blocked: false, title: state.title, url: state.url };
      }
      if (!lastBlocked && !/__cf_chl/i.test(state.url)) {
        return { cleared: true, blocked: false, title: state.title, url: state.url };
      }
    }

    await page.waitForTimeout(1000);
  }

  return { cleared: false, blocked: lastBlocked, title: lastTitle, url: lastUrl };
}

async function extractProjects(page) {
  return page.evaluate((limit) => {
    const clean = (value, max = 500) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const toAbsolute = (href) => {
      try {
        return new URL(href, location.origin).href.split('#')[0];
      } catch {
        return null;
      }
    };
    const anchors = Array.from(document.querySelectorAll('a[href*="/projects/"]'));
    const seen = new Set();
    const projects = [];

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute('href') || '';
      if (!rawHref || /\/projects\/search(?:[/?#]|$)/.test(rawHref)) continue;
      const href = toAbsolute(rawHref);
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const card =
        anchor.closest('article') ||
        anchor.closest('li') ||
        anchor.closest('[class*="project" i]') ||
        anchor.closest('[class*="card" i]') ||
        anchor.closest('[data-testid]') ||
        anchor;

      const titleNode =
        card.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="name" i]') ||
        anchor.querySelector('h1,h2,h3,h4,[class*="title" i],[class*="name" i]') ||
        anchor;
      const imageNode = card.querySelector('img');
      const text = clean(card.innerText || anchor.innerText, 700);
      const title = clean(titleNode?.innerText || anchor.getAttribute('aria-label') || text, 220);
      if (!title && !text) continue;

      projects.push({
        title,
        href,
        image: imageNode?.currentSrc || imageNode?.src || imageNode?.getAttribute('data-src') || null,
        text,
      });
      if (projects.length >= limit) break;
    }
    return projects;
  }, SAMPLE_LIMIT);
}

async function runProbe() {
  if (running) return report;
  running = true;
  report = baseReport('running');
  report.running = true;
  report.startedAt = new Date().toISOString();
  const endpoints = [];
  const endpointKeys = new Set();
  let browser = null;

  try {
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: LAUNCH_ARGS,
    });
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(60_000);

    page.on('response', async (response) => {
      try {
        const url = response.url();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';
        if (!endpointInteresting(url, contentType)) return;
        const item = {
          url,
          status: response.status(),
          contentType,
          bodyPreview: null,
          projectHints: [],
        };
        if (/json|graphql/i.test(contentType) && RESPONSE_PREVIEW_CHARS > 0) {
          const text = await response.text().catch(() => '');
          item.bodyPreview = compactText(text, RESPONSE_PREVIEW_CHARS);
          try {
            const parsed = JSON.parse(text);
            item.projectHints = collectProjectHints(parsed);
          } catch {
            item.projectHints = [];
          }
        }
        const key = stableEndpointKey(item);
        if (endpointKeys.has(key)) return;
        endpointKeys.add(key);
        endpoints.push(item);
      } catch {
        // Response bodies can be consumed or unavailable; ignore probe-only misses.
      }
    });

    const clearResult = await waitForCloudflareClear(page, TARGET_URL, CLEAR_MAX_MS);
    report.cleared = clearResult.cleared;
    report.blocked = clearResult.blocked;
    report.pageTitle = clearResult.title || (await page.title().catch(() => null));
    report.finalUrl = clearResult.url || (await page.url().catch(() => null));

    if (clearResult.cleared) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(1500);
      for (let i = 0; i < SCROLLS; i++) {
        await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9))).catch(() => {});
        await page.waitForTimeout(1500);
      }
      report.sampleProjects = await extractProjects(page).catch((err) => {
        report.errors.push({ stage: 'extractProjects', message: err instanceof Error ? err.message : String(err) });
        return [];
      });
      report.searchPageProjectCount = report.sampleProjects.length;
      report.projectCount = report.sampleProjects.length;
      if (report.sampleProjects.length > 0) report.projectSource = 'search_page_dom';
    }

    report.dataAccess = await probeDataAccess(page);
    if (report.projectCount === 0 && report.dataAccess.ok) {
      report.projectSource = report.dataAccess.bestSource;
      report.projectCount = report.dataAccess.projectCount;
      report.sampleProjects = report.dataAccess.sampleProjects;
    }

    report.networkEndpoints = endpoints.slice(0, ENDPOINT_LIMIT);
    report.jsonProjectHints = endpoints.flatMap((item) => item.projectHints || []).slice(0, SAMPLE_LIMIT);
    report.status = 'done';
    report.ok = true;
  } catch (err) {
    report.status = 'error';
    report.ok = false;
    report.errors.push({ stage: 'runProbe', message: err instanceof Error ? err.message : String(err) });
  } finally {
    await browser?.close().catch(() => {});
    report.finishedAt = new Date().toISOString();
    report.running = false;
    running = false;
  }

  return report;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, status: report.status, running });
  }

  if (req.method === 'GET' && url.pathname === '/report') {
    return json(res, 200, report);
  }

  if (req.method === 'POST' && url.pathname === '/run') {
    if (!authed(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
    if (running) return json(res, 409, { ok: false, error: 'already running', status: report.status });
    runProbe().catch((err) => {
      report.status = 'error';
      report.ok = false;
      report.running = false;
      report.finishedAt = new Date().toISOString();
      report.errors.push({ stage: 'runProbe.unhandled', message: err instanceof Error ? err.message : String(err) });
      running = false;
    });
    return json(res, 202, { ok: true, message: 'Indiegogo search probe started; poll /report.' });
  }

  return json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[indiegogo-probe] listening on ${PORT}`);
  if (RUN_ON_BOOT) {
    setTimeout(() => runProbe().catch((err) => console.error('[indiegogo-probe] boot run failed:', err)), 1000);
  }
});
