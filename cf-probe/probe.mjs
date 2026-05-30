// Cloudflare feasibility probe (throwaway).
//
// Runs on Railway to answer ONE question: with no paid proxy, can we clear
// Cloudflare on a datacenter IP — and if so, what data can we pull?
//
// It compares two FREE configurations head-to-head over a set of live KS
// projects and reports, per strategy: CF clear rate, basic stats, rewards
// (captured GraphQL), and creator info.
//
//   A) chrome-headful   : real Google Chrome, headful under Xvfb + stealth
//   B) chromium-headless: bundled Chromium --headless=new + stealth (control;
//                         mirrors the current production worker)
//
// Endpoints:
//   GET  /health  -> liveness
//   GET  /report  -> latest run results (JSON)
//   POST /run      -> trigger a fresh run (Authorization: Bearer <PROBE_TOKEN>)

import http from 'node:http';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.PROBE_TOKEN || '').trim();
const COUNT = Math.max(1, Math.min(Number(process.env.PROBE_COUNT || 20), 60));
const CLEAR_MAX_MS = Math.max(15000, Math.min(Number(process.env.PROBE_CLEAR_MS || 60000), 120000));
const STRATEGY_FILTER = (process.env.PROBE_STRATEGY || 'both').toLowerCase();
const RUN_ON_BOOT = !/^(0|false|no)$/i.test(process.env.PROBE_RUN_ON_BOOT || '1');

// Static fallback list (used only if dynamic discovery fails). These will go
// stale; discovery is preferred.
const FALLBACK_PROJECTS = [
  'https://www.kickstarter.com/projects/woollemothprevention/woolle-odorless-non-toxic-moth-protection-for-wool',
];

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-blink-features=AutomationControlled',
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--disable-features=IsolateOrigins,site-per-process',
];

const STRATEGIES = {
  'chrome-headful': {
    label: 'real Google Chrome, headful under Xvfb + stealth',
    launch: { channel: 'chrome', headless: false, args: LAUNCH_ARGS },
  },
  'chromium-headless': {
    label: 'bundled Chromium --headless=new + stealth (control)',
    launch: { headless: true, args: [...LAUNCH_ARGS, '--headless=new'] },
  },
};

let report = { status: 'idle', startedAt: null, finishedAt: null, strategies: [] };
let running = false;

const isBlockedText = (t) => /just a moment|cf_chl|enable javascript and cookies|attention required|access denied/i.test(t || '');

// Navigate to url and poll until Cloudflare lets us through (or timeout).
async function clearAt(page, url, maxMs = CLEAR_MAX_MS) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch {
      /* retry */
    }
    const deadline = Math.min(start + maxMs, Date.now() + 20000);
    while (Date.now() < deadline) {
      const blocked = await page
        .evaluate(() => {
          const t = (document.body?.innerText || '').slice(0, 4000);
          return /just a moment|cf_chl|enable javascript and cookies|attention required|access denied/i.test(t);
        })
        .catch(() => true);
      if (!blocked && !/__cf_chl/.test(page.url())) return true;
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
  }
  return false;
}

// Walk an arbitrary JSON value looking for a rewards collection.
function countRewardsFromGraph(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return 0;
  }
  let best = 0;
  const seen = new Set();
  const queue = [data];
  for (let i = 0; i < queue.length && i < 5000; i++) {
    const v = queue[i];
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    // RewardsTab shape: { rewards: { nodes: [...] } }
    if (v.rewards && Array.isArray(v.rewards.nodes)) best = Math.max(best, v.rewards.nodes.length);
    if (Array.isArray(v.nodes) && v.nodes.some((n) => n && typeof n === 'object' && ('backersCount' in n || 'amount' in n))) {
      best = Math.max(best, v.nodes.length);
    }
    for (const child of Object.values(v)) {
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return best;
}

async function probeProject(page, projectUrl) {
  const t0 = Date.now();
  const out = { url: projectUrl, cleared: false, basic: false, rewards: 0, creator: null, ms: 0, error: null };
  try {
    out.cleared = await clearAt(page, projectUrl);
    if (!out.cleared) {
      out.ms = Date.now() - t0;
      return out;
    }

    // Basic live stats via in-page fetch (uses the browser's own TLS + cookies).
    try {
      const stats = await page.evaluate(async (u) => {
        const r = await fetch(`${u}/stats.json?v=1`, { headers: { accept: 'application/json' } });
        if (!r.ok) return null;
        return r.json();
      }, projectUrl);
      const p = stats?.project || stats;
      if (p && (p.backers_count != null || p.pledged != null)) out.basic = true;
    } catch {
      /* ignore */
    }

    // Rewards: capture the React app's RewardsTab GraphQL response.
    const bodies = [];
    const onResp = async (resp) => {
      try {
        if (!/graphql/i.test(resp.url())) return;
        const t = await resp.text();
        if (/RewardsTab|"rewards"|backersCount/.test(t)) bodies.push(t);
      } catch {
        /* ignore */
      }
    };
    page.on('response', onResp);
    if (await clearAt(page, `${projectUrl}/rewards`)) {
      const dl = Date.now() + 18000;
      while (Date.now() < dl && bodies.length === 0) await page.waitForTimeout(1000);
      await page.waitForTimeout(1500);
    }
    page.off('response', onResp);
    out.rewards = bodies.reduce((m, b) => Math.max(m, countRewardsFromGraph(b)), 0);

    // Creator: navigate the creator tab and wait for it to actually render.
    if (await clearAt(page, `${projectUrl}/creator`)) {
      const dl = Date.now() + 22000;
      let ready = false;
      while (Date.now() < dl) {
        ready = await page
          .evaluate(() => /\d[\d,]*\s+(created|backed)\s+projects?/i.test(document.body?.innerText || ''))
          .catch(() => false);
        if (ready) break;
        await page.waitForTimeout(1000);
      }
      out.creator = ready;
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message.slice(0, 200) : String(err);
  }
  out.ms = Date.now() - t0;
  return out;
}

// Use a cleared page to discover fresh live project URLs.
async function discoverProjects(page, count) {
  try {
    const data = await page.evaluate(async () => {
      const r = await fetch('https://www.kickstarter.com/discover/advanced?sort=newest&format=json&page=1', {
        headers: { accept: 'application/json' },
      });
      if (!r.ok) return null;
      return r.json();
    });
    const rows = Array.isArray(data?.projects) ? data.projects : [];
    const urls = rows
      .map((p) => p?.urls?.web?.project || (p?.creator?.slug && p?.slug ? `https://www.kickstarter.com/projects/${p.creator.slug}/${p.slug}` : null))
      .filter(Boolean)
      .map((u) => u.split('?')[0]);
    return [...new Set(urls)].slice(0, count);
  } catch {
    return [];
  }
}

async function runStrategy(key, projects) {
  const cfg = STRATEGIES[key];
  const result = { strategy: key, label: cfg.label, warmCleared: false, projects: [], summary: null, launchError: null };
  let browser = null;
  try {
    browser = await chromium.launch(cfg.launch);
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);

    result.warmCleared = await clearAt(page, 'https://www.kickstarter.com/');
    for (const url of projects) {
      const r = await probeProject(page, url);
      result.projects.push(r);
      console.log(`[${key}] ${r.cleared ? 'CLEARED' : 'BLOCKED '} basic=${r.basic} rewards=${r.rewards} creator=${r.creator} ${r.ms}ms ${url}`);
    }
  } catch (err) {
    result.launchError = err instanceof Error ? err.message.slice(0, 300) : String(err);
    console.error(`[${key}] launch/run error:`, result.launchError);
  } finally {
    await browser?.close().catch(() => {});
  }
  result.summary = summarize(result.projects);
  return result;
}

function summarize(rows) {
  const n = rows.length || 1;
  const cleared = rows.filter((r) => r.cleared).length;
  const basic = rows.filter((r) => r.basic).length;
  const rewardsAny = rows.filter((r) => r.rewards > 0).length;
  const creator = rows.filter((r) => r.creator === true).length;
  const avgMs = Math.round(rows.reduce((s, r) => s + (r.ms || 0), 0) / n);
  const pct = (x) => `${Math.round((x / n) * 100)}%`;
  return {
    total: rows.length,
    cleared,
    clearedPct: pct(cleared),
    basic,
    basicPct: pct(basic),
    rewardsAny,
    rewardsAnyPct: pct(rewardsAny),
    creator,
    creatorPct: pct(creator),
    avgMs,
  };
}

async function runAll() {
  if (running) return report;
  running = true;
  report = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, count: COUNT, strategies: [] };
  console.log(`\n=== CF probe starting: ${COUNT} projects, strategy=${STRATEGY_FILTER} ===`);

  // Discover a fresh project list (or use env override / fallback).
  let projects = (process.env.PROBE_PROJECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let discoverCleared = null;
  if (projects.length === 0) {
    let b = null;
    try {
      b = await chromium.launch(STRATEGIES['chrome-headful'].launch);
      const ctx = await b.newContext({ locale: 'en-US', timezoneId: 'America/Los_Angeles', viewport: { width: 1440, height: 1000 } });
      const pg = await ctx.newPage();
      discoverCleared = await clearAt(pg, 'https://www.kickstarter.com/');
      if (discoverCleared) projects = await discoverProjects(pg, COUNT);
    } catch (err) {
      console.error('[discover] error:', err instanceof Error ? err.message : err);
    } finally {
      await b?.close().catch(() => {});
    }
  }
  if (projects.length === 0) projects = FALLBACK_PROJECTS;
  report.discoverCleared = discoverCleared;
  report.projectCount = projects.length;
  console.log(`[discover] using ${projects.length} project(s) (discoverCleared=${discoverCleared})`);

  const keys = STRATEGY_FILTER === 'both' ? Object.keys(STRATEGIES) : Object.keys(STRATEGIES).filter((k) => k === STRATEGY_FILTER);
  for (const key of keys) {
    console.log(`\n--- strategy: ${key} (${STRATEGIES[key].label}) ---`);
    const res = await runStrategy(key, projects);
    report.strategies.push(res);
    console.log(`[${key}] summary:`, JSON.stringify(res.summary));
  }

  report.status = 'done';
  report.finishedAt = new Date().toISOString();
  running = false;
  console.log('\n=== CF probe done ===');
  console.log(JSON.stringify(report.strategies.map((s) => ({ strategy: s.strategy, ...s.summary })), null, 2));
  return report;
}

function authed(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  return auth === `Bearer ${TOKEN}` || req.headers['x-probe-token'] === TOKEN;
}

const server = http.createServer((req, res) => {
  const json = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/health') return json(200, { ok: true, running, status: report.status });
  if (req.method === 'GET' && req.url === '/report') return json(200, report);
  if (req.method === 'POST' && req.url === '/run') {
    if (!authed(req)) return json(401, { error: 'unauthorized' });
    if (running) return json(409, { error: 'already running', status: report.status });
    runAll().catch((err) => console.error('runAll error:', err));
    return json(202, { ok: true, message: 'probe started; poll /report' });
  }
  return json(404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[cf-probe] listening on ${PORT}`);
  if (RUN_ON_BOOT) setTimeout(() => runAll().catch((err) => console.error('boot run error:', err)), 1000);
});
