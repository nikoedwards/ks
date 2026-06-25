// Indiegogo Cloudflare-bypass enumeration worker.
//
// Productionized from the original probe. It keeps a warm, Cloudflare-cleared
// Chromium session (via puppeteer-real-browser, which auto-solves Turnstile and
// applies rebrowser patches) and exposes a tiny HTTP surface the main app calls:
//
//   POST /search  -> runs an in-page fetch against Indiegogo's internal
//                    searchProjectsForCards API (reusing the cleared cookies)
//                    and returns the raw paged cards + totals.
//   GET  /health  -> liveness + load signals the main app's workerGate reads
//                    (activeFetches / queuedFetches / maxConcurrency).
//
// The browser lane is serial by design (headed Chrome + Turnstile clearance gets
// flaky under concurrency). Two instances are deployed with different roles
// (live discovery vs. backlog sweep) so the two pipelines never share a lane.

import http from 'node:http';
import { connect } from 'puppeteer-real-browser';

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.BROWSER_WORKER_TOKEN || process.env.PROBE_TOKEN || '').trim();
const ROLE = (process.env.INDIEGOGO_WORKER_ROLE || 'live').trim();
const SEARCH_URL =
  process.env.INDIEGOGO_SEARCH_URL || 'https://www.indiegogo.com/en/projects/search?Source=Filtered';
const SEARCH_API =
  process.env.INDIEGOGO_SEARCH_API || 'https://www.indiegogo.com/api/projectSearch/searchProjectsForCards';
const CLEAR_MAX_MS = clampNumber(process.env.INDIEGOGO_CLEAR_MS, 15_000, 180_000, 90_000);
const SEARCH_TIMEOUT_MS = clampNumber(process.env.INDIEGOGO_SEARCH_TIMEOUT_MS, 5_000, 120_000, 45_000);
// How long a cleared session is trusted before we re-verify on the next search.
const CLEAR_TTL_MS = clampNumber(process.env.INDIEGOGO_CLEAR_TTL_MS, 60_000, 3_600_000, 20 * 60_000);
const MAX_CONCURRENCY = 1; // serial lane by design

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--start-maximized',
];

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function isBlockedText(t = '') {
  return /just a moment|attention required|enable javascript and cookies|cf[_-]?chl|__cf_chl/i.test(t);
}

// ── Browser session (lazy, single warm page) ──────────────────────────────────

let browser = null;
let page = null;
let clearedAt = 0;
let launching = null;

async function launchBrowser() {
  if (browser && page) return;
  if (launching) return launching;
  launching = (async () => {
    const conn = await connect({
      headless: false,
      turnstile: true,
      args: LAUNCH_ARGS,
      customConfig: {},
      connectOption: {},
      disableXvfb: true, // a virtual display is provided by xvfb-run in the container
    });
    browser = conn.browser;
    page = conn.page;
    page.setDefaultTimeout(SEARCH_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(Math.min(CLEAR_MAX_MS, 60_000));
    clearedAt = 0;
    browser.on?.('disconnected', () => {
      browser = null;
      page = null;
      clearedAt = 0;
    });
  })();
  try {
    await launching;
  } finally {
    launching = null;
  }
}

async function ensureCleared(force = false) {
  await launchBrowser();
  const fresh = clearedAt > 0 && Date.now() - clearedAt < CLEAR_TTL_MS;
  if (fresh && !force) return true;

  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: Math.min(CLEAR_MAX_MS, 60_000) }).catch(() => {});
  const start = Date.now();
  while (Date.now() - start < CLEAR_MAX_MS) {
    const state = await page
      .evaluate(() => ({
        title: document.title,
        links: document.querySelectorAll('a[href*="/projects/"]').length,
        bodyLen: (document.body?.innerText || '').length,
      }))
      .catch(() => null);
    if (state && !isBlockedText(state.title) && (state.links > 0 || state.bodyLen > 2000)) {
      clearedAt = Date.now();
      // brief settle so any post-clearance cookies land
      await new Promise(r => setTimeout(r, 1200));
      return true;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  clearedAt = 0;
  return false;
}

function buildSearchBody(params = {}) {
  return {
    creatorID: null,
    creatorName: null,
    sortType: Number(params.sortType ?? 0),
    term: typeof params.term === 'string' ? params.term : '',
    projectPhaseSearchTypes: Array.isArray(params.projectPhaseSearchTypes) ? params.projectPhaseSearchTypes : [],
    projectBenefits: Array.isArray(params.projectBenefits) ? params.projectBenefits : [],
    projectTags: Array.isArray(params.projectTags) ? params.projectTags : [],
    projectCatalogCategories: Array.isArray(params.projectCatalogCategories) ? params.projectCatalogCategories : [],
    playerAges: [],
    playerCounts: [],
    playTimes: [],
    creator: { creatorID: null, name: null },
    userCommunitySearchTypes: [],
    source: Number(params.source ?? 5),
    pageIndex: Math.max(1, Number(params.pageIndex ?? 1)),
  };
}

async function runSearchOnce(params) {
  const body = JSON.stringify(buildSearchBody(params));
  return page.evaluate(
    async (api, payload, timeoutMs) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payload,
          signal: ctrl.signal,
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        return { status: res.status, json, bytes: text.length, preview: json ? null : text.slice(0, 300) };
      } catch (e) {
        return { status: 0, json: null, bytes: 0, error: String((e && e.message) || e) };
      } finally {
        clearTimeout(timer);
      }
    },
    SEARCH_API,
    body,
    SEARCH_TIMEOUT_MS,
  );
}

async function search(params) {
  const cleared = await ensureCleared(false);
  if (!cleared) {
    return { ok: false, cleared: false, error: 'cloudflare_not_cleared' };
  }

  let result = await runSearchOnce(params);
  // A challenge slipped in (HTML body / 403) -> force a re-clear once and retry.
  if (!result.json || result.status === 403 || (result.preview && isBlockedText(result.preview))) {
    const recleared = await ensureCleared(true);
    if (!recleared) return { ok: false, cleared: false, error: 'cloudflare_not_cleared' };
    result = await runSearchOnce(params);
  }

  if (!result.json) {
    return { ok: false, cleared: true, status: result.status, error: result.error || 'non_json_response', preview: result.preview };
  }

  const projects = result.json.projects || {};
  const items = Array.isArray(projects.pagedItems) ? projects.pagedItems : [];
  return {
    ok: true,
    cleared: true,
    status: result.status,
    pageIndex: Number(buildSearchBody(params).pageIndex),
    total: Number(projects.totalItemCount ?? 0),
    totalPages: Number(projects.totalPageCount ?? 0),
    pageSize: Number(projects.pageSize ?? items.length),
    capped: Boolean(result.json.hasCappedResults),
    count: items.length,
    items,
  };
}

// ── Serial lane + load counters ───────────────────────────────────────────────

let activeFetches = 0;
let queuedFetches = 0;
let chain = Promise.resolve();

function runSerial(fn) {
  queuedFetches += 1;
  const job = chain.then(async () => {
    queuedFetches = Math.max(0, queuedFetches - 1);
    activeFetches += 1;
    try {
      return await fn();
    } finally {
      activeFetches = Math.max(0, activeFetches - 1);
    }
  });
  // keep the chain alive regardless of individual job outcome
  chain = job.then(() => undefined, () => undefined);
  return job;
}

// ── HTTP surface ──────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function authed(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN}` || req.headers['x-worker-token'] === TOKEN;
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      role: ROLE,
      cleared: clearedAt > 0 && Date.now() - clearedAt < CLEAR_TTL_MS,
      activeFetches,
      queuedFetches,
      maxConcurrency: MAX_CONCURRENCY,
    });
  }

  if (req.method === 'POST' && url.pathname === '/search') {
    if (!authed(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
    const params = await readBody(req);
    try {
      const result = await runSerial(() => search(params));
      return sendJson(res, result.ok ? 200 : 502, result);
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[indiegogo-worker] role=${ROLE} listening on ${PORT}`);
  // Warm the session in the background so the first /search is fast.
  ensureCleared(true).then(
    (ok) => console.log(`[indiegogo-worker] initial clearance: ${ok ? 'ok' : 'failed'}`),
    (err) => console.error('[indiegogo-worker] initial clearance error:', err),
  );
});
