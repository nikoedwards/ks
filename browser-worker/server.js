import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth evasions so Cloudflare's bot management can't trivially flag
// headless chromium (`navigator.webdriver`, WebGL renderer, missing chrome
// runtime, audio context fingerprint, etc.). The user has confirmed real
// Chrome opens kickstarter.com immediately; we want our headless browser to
// look the same to Cloudflare.
const STEALTH_ENABLED = !/^(0|false|no)$/i.test(process.env.BROWSER_STEALTH_ENABLED || '1');
let stealthPluginInstance = null;
if (STEALTH_ENABLED) {
  stealthPluginInstance = StealthPlugin();
  // The `chrome.runtime` evasion can interfere with some sites and Cloudflare's
  // challenge JS expects a real value; default-on is fine, but expose a kill
  // switch via env in case we need to disable specific evasions later.
  const disabled = (process.env.BROWSER_STEALTH_DISABLE_EVASIONS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const ev of disabled) stealthPluginInstance.enabledEvasions.delete(ev);
  chromium.use(stealthPluginInstance);
}

function stealthDiagnostics() {
  if (!STEALTH_ENABLED) return { enabled: false, evasions: [] };
  let evasions = [];
  try {
    if (stealthPluginInstance?.enabledEvasions instanceof Set) {
      evasions = Array.from(stealthPluginInstance.enabledEvasions);
    } else if (Array.isArray(stealthPluginInstance?.enabledEvasions)) {
      evasions = [...stealthPluginInstance.enabledEvasions];
    }
  } catch { /* ignore */ }
  let pluginCount = 0;
  try {
    const list = chromium?.plugins?.list;
    if (Array.isArray(list)) pluginCount = list.length;
    else if (typeof list === 'function') pluginCount = list().length;
  } catch { /* ignore */ }
  return { enabled: true, evasions, pluginCount };
}

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.BROWSER_WORKER_TOKEN || '').trim();
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_FETCH_TIMEOUT_MS || 60000);
const MAX_BODY_BYTES = Number(process.env.BROWSER_FETCH_MAX_BYTES || 5_000_000);
const STORAGE_STATE_PATH = process.env.BROWSER_STORAGE_STATE_PATH
  || path.join(os.tmpdir(), 'kicksonar-browser-worker-storage-state.json');
const DEBUG_SCREENSHOTS = !/^(0|false|no)$/i.test(process.env.BROWSER_DEBUG_SCREENSHOTS || '1');
const BLOCK_HEAVY_RESOURCES = /^(1|true|yes)$/i.test(process.env.BROWSER_BLOCK_HEAVY_RESOURCES || '0');
// Default 45s — Cloudflare managed challenge solves in 3-10s for well-faked
// browsers, but a cold first hit can take longer. Cap at 120s so we don't
// hang requests forever. Override via BROWSER_CHALLENGE_WAIT_MS.
const CHALLENGE_WAIT_MS = Math.max(3000, Math.min(Number(process.env.BROWSER_CHALLENGE_WAIT_MS || 45_000), 120_000));
const OXYLABS_USER_AGENT_TYPE = (process.env.OXYLABS_USER_AGENT_TYPE
  || process.env.BROWSER_OXYLABS_USER_AGENT_TYPE
  || '').trim();
const IGNORE_HTTPS_ERRORS = /^(1|true|yes)$/i.test(process.env.BROWSER_PROXY_IGNORE_HTTPS_ERRORS || '')
  || /^(1|true|yes)$/i.test(process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS || '');

const ALLOWED_HOSTS = new Set([
  'www.kickstarter.com',
  'kickstarter.com',
  'www.kicktraq.com',
  'kicktraq.com',
]);

let browserPromise;
let lastLaunchError = null;
const launchHistory = [];
const requestHistory = [];
let nextRequestId = 1;

function recordLaunchOutcome(entry) {
  launchHistory.push(entry);
  while (launchHistory.length > 20) launchHistory.shift();
}

function recordRequestOutcome(entry) {
  requestHistory.push(entry);
  while (requestHistory.length > 30) requestHistory.shift();
}

function trackRequestStart(input) {
  const id = nextRequestId++;
  const entry = {
    id,
    startedAt: new Date().toISOString(),
    url: typeof input?.url === 'string' ? input.url.slice(0, 240) : null,
    expect: input?.expect ?? 'json',
    mode: input?.mode ?? null,
    basicOnly: Boolean(input?.basicOnly),
    steps: [],
    ok: null,
    status: null,
    durationMs: null,
    error: null,
  };
  recordRequestOutcome(entry);
  return {
    id,
    step(label, info = {}) {
      entry.steps.push({ at: new Date().toISOString(), label, ...info });
      if (entry.steps.length > 60) entry.steps.shift();
      console.log(`[fetch#${id}] ${label}${info && Object.keys(info).length ? ' ' + JSON.stringify(info).slice(0, 400) : ''}`);
    },
    finish(result) {
      entry.ok = result.ok ?? null;
      entry.status = result.status ?? null;
      entry.finalUrl = result.finalUrl ?? null;
      entry.durationMs = result.durationMs ?? null;
      entry.error = result.error ?? null;
      console.log(`[fetch#${id}] done ok=${entry.ok} status=${entry.status} durationMs=${entry.durationMs}${entry.error ? ' error=' + JSON.stringify(entry.error).slice(0, 200) : ''}`);
    },
  };
}

function getProxyOptions() {
  const rawServer = (process.env.BROWSER_PROXY_URL
    || process.env.BROWSER_PROXY_SERVER
    || process.env.PLAYWRIGHT_PROXY_SERVER
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || '').trim();
  if (!rawServer) return null;

  let server = rawServer;
  let username = (process.env.BROWSER_PROXY_USERNAME || process.env.PLAYWRIGHT_PROXY_USERNAME || '').trim();
  let password = (process.env.BROWSER_PROXY_PASSWORD || process.env.PLAYWRIGHT_PROXY_PASSWORD || '').trim();
  try {
    const parsed = new URL(rawServer);
    if (parsed.username && !username) username = decodeURIComponent(parsed.username);
    if (parsed.password && !password) password = decodeURIComponent(parsed.password);
    parsed.username = '';
    parsed.password = '';
    server = parsed.toString();
  } catch {
    // Playwright also accepts host:port style values.
  }

  const proxy = { server };
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  const bypass = (process.env.BROWSER_PROXY_BYPASS || process.env.PLAYWRIGHT_PROXY_BYPASS || '').trim();
  if (bypass) proxy.bypass = bypass;
  return proxy;
}

function contextOptions(base = {}) {
  const headers = {
    ...(base.extraHTTPHeaders || {}),
    ...(OXYLABS_USER_AGENT_TYPE ? { 'x-oxylabs-user-agent-type': OXYLABS_USER_AGENT_TYPE } : {}),
  };
  return {
    ...base,
    ignoreHTTPSErrors: Boolean(base.ignoreHTTPSErrors || IGNORE_HTTPS_ERRORS),
    extraHTTPHeaders: headers,
  };
}

// `--headless=new` is Chrome's modern headless mode (Chrome 109+) — it uses
// the same browser binary as headed Chrome, which makes Cloudflare's managed
// challenge significantly more likely to clear. The legacy mode used by
// Playwright's default `headless: true` is detectable via subtle differences
// in CDP / GPU / font enumeration. Toggle with `BROWSER_HEADLESS_MODE` env:
//   "new"   → --headless=new (default; recommended)
//   "old"   → --headless (legacy; matches previous behavior)
//   "false" → headed mode (will fail in Docker without xvfb)
const HEADLESS_MODE = (process.env.BROWSER_HEADLESS_MODE || 'new').toLowerCase();
const USE_HEADED = HEADLESS_MODE === 'false' || HEADLESS_MODE === '0' || HEADLESS_MODE === 'no';
const USE_NEW_HEADLESS = !USE_HEADED && HEADLESS_MODE !== 'old';

// Use a real browser channel (e.g. "chrome") instead of the bundled Chromium.
// Real Chrome has a cleaner TLS/JA3 fingerprint, which (together with headful
// + Xvfb) clears Cloudflare far more reliably on datacenter IPs. Empty string
// = use the bundled Chromium. Requires the channel binary to be installed in
// the image (the Dockerfile installs google-chrome-stable).
const CHROME_CHANNEL = (process.env.BROWSER_CHROME_CHANNEL || '').trim();

const CHROMIUM_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  // Avoid the GPU-disabled fingerprint when running headless.
  '--use-gl=swiftshader',
  '--enable-webgl',
  // Slight realism nudges that real Chrome ships with.
  '--disable-features=IsolateOrigins,site-per-process,SitePerProcess',
];
if (USE_NEW_HEADLESS) CHROMIUM_LAUNCH_ARGS.push('--headless=new');

const LAUNCH_MAX_ATTEMPTS = Math.max(1, Math.min(Number(process.env.BROWSER_LAUNCH_MAX_ATTEMPTS || 3), 5));

// `spawn E2BIG` means argv + envp exceeded the kernel's ARG_MAX when launching
// chromium. Playwright passes the *entire* process environment to the browser
// child by default; on Railway that env block can be very large (injected
// service vars, build metadata, etc.). We curate a minimal env containing only
// what chromium / Playwright actually need, which keeps us well under ARG_MAX
// and eliminates E2BIG. Disable via BROWSER_CURATE_LAUNCH_ENV=0 if it ever
// breaks something.
const CURATE_LAUNCH_ENV = !/^(0|false|no)$/i.test(process.env.BROWSER_CURATE_LAUNCH_ENV || '1');
const LAUNCH_ENV_ALLOW = new Set([
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'TMP', 'TEMP',
  'DISPLAY', 'XAUTHORITY', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE',
  'PLAYWRIGHT_BROWSERS_PATH', 'NODE_ENV',
]);

function curatedLaunchEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (LAUNCH_ENV_ALLOW.has(key) || /^(PLAYWRIGHT_|CHROMIUM_|GOOGLE_)/.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

// Errors that mean the container is in an unrecoverable resource state — once
// these start, every subsequent chromium spawn fails the same way. The only
// real recovery is a fresh container, so we self-heal by exiting and letting
// Railway restart us. (Observed in prod: EAGAIN, then E2BIG, wedged for hours.)
function isUnrecoverableSpawnError(err) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /\bspawn\b/.test(msg) && /\b(E2BIG|EAGAIN|ENOMEM|EMFILE|ENFILE)\b/.test(msg);
}

const EXIT_ON_LAUNCH_FAILURE = !/^(0|false|no)$/i.test(process.env.BROWSER_EXIT_ON_LAUNCH_FAILURE || '1');
let exitScheduled = false;
function scheduleSelfHealExit(reason) {
  if (exitScheduled) return;
  exitScheduled = true;
  console.error(`[browser-worker] self-heal: unrecoverable launch state (${reason}); exiting for a clean restart.`);
  // Delay briefly so the in-flight HTTP 500 response can flush to the caller.
  setTimeout(() => process.exit(1), 1500);
}

async function attemptLaunch(label = 'launch') {
  const proxy = getProxyOptions();
  const startedAt = Date.now();
  try {
    const browser = await chromium.launch({
      // Headful real Chrome under Xvfb is the default (BROWSER_HEADLESS_MODE=false
      // + BROWSER_CHROME_CHANNEL=chrome, set in the Dockerfile). For headless
      // modes, --headless=new in CHROMIUM_LAUNCH_ARGS keeps the modern binary
      // behavior. Xvfb (via `xvfb-run` in npm start) gives headful a display.
      headless: !USE_HEADED,
      ...(CHROME_CHANNEL ? { channel: CHROME_CHANNEL } : {}),
      ...(proxy ? { proxy } : {}),
      ...(CURATE_LAUNCH_ENV ? { env: curatedLaunchEnv() } : {}),
      args: CHROMIUM_LAUNCH_ARGS,
    });
    const outcome = {
      label,
      ok: true,
      hasProxy: Boolean(proxy),
      elapsedMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    };
    recordLaunchOutcome(outcome);
    lastLaunchError = null;
    return browser;
  } catch (err) {
    const outcome = {
      label,
      ok: false,
      hasProxy: Boolean(proxy),
      elapsedMs: Date.now() - startedAt,
      at: new Date().toISOString(),
      error: safeError(err),
    };
    recordLaunchOutcome(outcome);
    lastLaunchError = outcome;
    throw err;
  }
}

async function launchWithRetries(maxAttempts = LAUNCH_MAX_ATTEMPTS) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await attemptLaunch(`launch_attempt_${attempt}`);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        const backoff = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  // All attempts failed. If this is a resource-exhaustion spawn error, the
  // container is wedged — exit so the platform restarts a clean one.
  if (EXIT_ON_LAUNCH_FAILURE && isUnrecoverableSpawnError(lastErr)) {
    scheduleSelfHealExit(lastErr instanceof Error ? lastErr.message.split('\n')[0] : 'spawn error');
  }
  throw lastErr;
}

function launchBrowser() {
  const promise = launchWithRetries().then(browser => {
    browser.on('disconnected', () => {
      if (browserPromise === promise) browserPromise = null;
    });
    requestsSinceLaunch = 0;
    return browser;
  }).catch(err => {
    if (browserPromise === promise) browserPromise = null;
    throw err;
  });
  browserPromise = promise;
  return promise;
}

async function getBrowser() {
  const browser = await (browserPromise || launchBrowser());
  if (typeof browser.isConnected === 'function' && !browser.isConnected()) {
    if (browserPromise) browserPromise = null;
    return getBrowser();
  }
  return browser;
}

// Periodic browser recycling: chromium's per-process resources (file
// descriptors, shared memory, zombie subprocess slots) accumulate over many
// context create/close cycles. Without recycling, after a few hundred
// requests `spawn chrome-headless-shell EAGAIN` starts firing because the
// kernel runs out of PIDs / memory. Recycling every N requests closes the
// browser entirely, freeing those resources, and the next request relaunches.
const BROWSER_RECYCLE_AFTER_REQUESTS = Math.max(10, Math.min(Number(process.env.BROWSER_RECYCLE_AFTER_REQUESTS || 60), 500));
let requestsSinceLaunch = 0;

async function onRequestComplete() {
  requestsSinceLaunch++;
  if (requestsSinceLaunch >= BROWSER_RECYCLE_AFTER_REQUESTS) {
    const stale = browserPromise;
    browserPromise = null;
    requestsSinceLaunch = 0;
    try {
      const b = stale ? await stale : null;
      if (b && typeof b.close === 'function') await b.close();
    } catch { /* ignore */ }
  }
}

async function newBrowserContext(options) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const browser = await getBrowser();
      const contextOptions = { ...options };
      if (fs.existsSync(STORAGE_STATE_PATH)) {
        contextOptions.storageState = STORAGE_STATE_PATH;
      }
      return await browser.newContext(contextOptions);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (/storage state|ENOENT|Unexpected token|JSON/i.test(message) && fs.existsSync(STORAGE_STATE_PATH)) {
        await fs.promises.unlink(STORAGE_STATE_PATH).catch(() => {});
        if (attempt === 0) continue;
      }
      if (!/browser has been closed|Target page, context or browser has been closed|Browser closed|disconnected/i.test(message)) {
        throw err;
      }
      browserPromise = null;
      if (attempt === 0) continue;
    }
  }
  throw lastError;
}

async function saveBrowserStorageState(context, diagnostics = null) {
  try {
    await fs.promises.mkdir(path.dirname(STORAGE_STATE_PATH), { recursive: true });
    await context.storageState({ path: STORAGE_STATE_PATH });
    if (diagnostics) diagnostics.storageStateSaved = true;
  } catch (err) {
    if (diagnostics) diagnostics.storageStateError = safeError(err);
  }
}

async function storageStateInfo() {
  try {
    const stat = await fs.promises.stat(STORAGE_STATE_PATH);
    return {
      path: STORAGE_STATE_PATH,
      exists: true,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch {
    return {
      path: STORAGE_STATE_PATH,
      exists: false,
    };
  }
}

function send(res, status, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 128_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function assertAuthorized(req) {
  if (!TOKEN) return true;
  const auth = req.headers.authorization || '';
  const headerToken = req.headers['x-worker-token'] || '';
  return auth === `Bearer ${TOKEN}` || headerToken === TOKEN;
}

function normalizeTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('url is required');
  }
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') {
    throw new Error('Only https URLs are allowed');
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Host is not allowed: ${url.hostname}`);
  }
  return url.toString();
}

function pageUrlForJson(targetUrl) {
  const url = new URL(targetUrl);
  url.searchParams.delete('format');
  url.hash = '';
  if (url.pathname.endsWith('.json')) {
    url.pathname = url.pathname.replace(/\.json$/, '');
  }
  if (url.pathname === '/discover/advanced') {
    url.search = '';
  }
  return url.toString();
}

function projectSectionUrl(targetUrl, section) {
  const url = new URL(targetUrl);
  const match = url.pathname.match(/^\/projects\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;
  url.hostname = 'www.kickstarter.com';
  url.search = '';
  url.hash = '';
  url.pathname = `/projects/${match[1]}/${match[2].replace(/\.json$/, '')}/${section}`;
  return url.toString();
}

function isKickstarterProjectUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return /(^|\.)kickstarter\.com$/i.test(url.hostname)
      && url.pathname.startsWith('/projects/');
  } catch {
    return false;
  }
}

function navigationUrlForTarget(targetUrl, expect) {
  return expect === 'json' && isKickstarterProjectUrl(targetUrl)
    ? pageUrlForJson(targetUrl)
    : targetUrl;
}

function contentTypeFromHeaders(headers) {
  return headers['content-type'] || headers['Content-Type'] || '';
}

function diagnosticHeaders(headers = {}) {
  const keep = [
    'server',
    'date',
    'content-type',
    'cf-ray',
    'cf-cache-status',
    'x-frame-options',
    'x-request-id',
    'location',
    'set-cookie',
  ];
  const normalized = {};
  for (const key of keep) {
    const value = headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()];
    if (!value) continue;
    normalized[key] = key === 'set-cookie' ? String(value).slice(0, 240) : value;
  }
  return normalized;
}

function isObject(value) {
  return typeof value === 'object' && value !== null;
}

function isProject(value) {
  return isObject(value)
    && (value.id !== undefined || typeof value.name === 'string')
    && ('pledged' in value || 'backers_count' in value || 'state' in value || 'goal' in value);
}

function looksLikeReward(value) {
  return isObject(value)
    && ('minimum' in value || 'amount' in value || 'pledge_amount' in value || 'backers_count' in value || 'reward_id' in value);
}

function looksLikeCollaborator(value) {
  return isObject(value)
    && ('role' in value || 'avatar' in value || 'photo' in value || 'user' in value || 'profile_url' in value);
}

function detailArray(source, keys, predicate) {
  if (!isObject(source)) return null;
  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value) && value.some(predicate)) return value;
  }
  return null;
}

function mergeProjectDetails(project, source) {
  const merged = { ...project };
  const rewards = detailArray(source, ['rewards', 'reward_tiers', 'available_rewards'], looksLikeReward);
  const collaborators = detailArray(source, ['collaborators', 'project_collaborators', 'team_members', 'project_team'], looksLikeCollaborator);
  if ((!Array.isArray(merged.rewards) || !merged.rewards.length) && rewards) merged.rewards = rewards;
  if ((!Array.isArray(merged.collaborators) || !merged.collaborators.length) && collaborators) merged.collaborators = collaborators;
  return merged;
}

function mergeRenderedDetails(project, details) {
  if (!project || !details) return project;
  return mergeProjectDetails(project, details);
}

function mergeDetailObjects(...detailObjects) {
  const merged = { rewards: [], collaborators: [] };
  for (const details of detailObjects) {
    if (!details) continue;
    if (Array.isArray(details.rewards)) merged.rewards.push(...details.rewards);
    if (Array.isArray(details.collaborators)) merged.collaborators.push(...details.collaborators);
  }
  const unique = (rows, keyFn) => {
    const seen = new Set();
    return rows.filter(row => {
      const key = keyFn(row);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  merged.rewards = unique(merged.rewards, row => String(row.id || row.reward_id || `${row.minimum}-${row.title}`));
  merged.collaborators = unique(merged.collaborators, row => String(row.id || row.slug || row.name || '').toLowerCase());
  merged.renderedRewardCount = merged.rewards.length;
  merged.renderedCollaboratorCount = merged.collaborators.length;
  return merged;
}

function projectScore(project) {
  let score = 10;
  if (Array.isArray(project.rewards) && project.rewards.length) score += 40 + project.rewards.length;
  if (Array.isArray(project.collaborators) && project.collaborators.length) score += 30 + project.collaborators.length;
  if (Array.isArray(project.project_collaborators) && project.project_collaborators.length) score += 30 + project.project_collaborators.length;
  if (project.blurb) score += 2;
  if (project.photo) score += 2;
  return score;
}

function hasProjectDetails(project) {
  return Boolean(
    (Array.isArray(project.rewards) && project.rewards.length)
    || (Array.isArray(project.collaborators) && project.collaborators.length)
    || (Array.isArray(project.project_collaborators) && project.project_collaborators.length),
  );
}

function safeError(err) {
  if (!err) return { name: 'Unknown', message: 'Unknown error' };
  const info = {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
  };
  if (err && typeof err === 'object') {
    if (err.code) info.code = String(err.code);
    if (err.cause) info.cause = err.cause instanceof Error ? err.cause.message : String(err.cause);
  }
  return info;
}

function countDetails(project) {
  if (!project || !isObject(project)) return { rewards: 0, collaborators: 0 };
  return {
    rewards: Array.isArray(project.rewards) ? project.rewards.length : 0,
    collaborators: Math.max(
      Array.isArray(project.collaborators) ? project.collaborators.length : 0,
      Array.isArray(project.project_collaborators) ? project.project_collaborators.length : 0,
    ),
  };
}

function findBestProject(root) {
  let best = null;
  let bestScore = -1;
  const seen = new Set();
  const queue = [{ value: root, parent: null }];
  for (let index = 0; index < queue.length && index < 2500; index++) {
    const item = queue[index];
    if (!isObject(item.value) || seen.has(item.value)) continue;
    seen.add(item.value);
    if (isProject(item.value)) {
      const candidate = mergeProjectDetails(item.value, item.parent || item.value);
      const score = projectScore(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    for (const child of Object.values(item.value)) {
      if (isObject(child)) queue.push({ value: child, parent: item.value });
    }
  }
  return best;
}

async function extractRenderedDetails(page) {
  return page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const uniqueBy = (rows, keyFn) => {
      const seen = new Set();
      return rows.filter(row => {
        const key = keyFn(row);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const parseMoney = text => {
      const match = text.match(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)\s*([\d,]+(?:\.\d+)?)/i);
      return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
    };
    const parseCount = (text, patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return Number(match[1].replace(/,/g, '')) || 0;
      }
      return 0;
    };
    const rewardSelectors = [
      '[data-reward-id]',
      '[id^="reward-"]',
      '[class*="reward" i]',
      '[class*="pledge" i]',
      'li:has([href*="#reward"])',
    ];
    const rewardNodes = Array.from(document.querySelectorAll(rewardSelectors.join(',')))
      .filter(node => clean(node.textContent).length > 20);
    const rewards = uniqueBy(rewardNodes.map((node, index) => {
      const text = clean(node.textContent);
      const title = clean(node.querySelector('h2,h3,h4,strong,[class*="title" i]')?.textContent)
        || text.split(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)/)[0].slice(0, 80).trim();
      const amount = parseMoney(text);
      const backers = parseCount(text, [/([\d,]+)\s+backers?/i, /backers?\s+([\d,]+)/i]);
      const remaining = parseCount(text, [/([\d,]+)\s+(?:left|remaining)/i]);
      const id = node.getAttribute('data-reward-id')
        || node.id?.replace(/^reward-/, '')
        || `${amount}-${title || index}`;
      return {
        id,
        title,
        description: text.slice(0, 600),
        minimum: amount,
        backers_count: backers,
        limit: remaining || null,
        limited: /limited|left|remaining/i.test(text),
      };
    }).filter(row => row.minimum > 0 || row.backers_count > 0 || row.title), row => String(row.id));

    const collaboratorSections = Array.from(document.querySelectorAll('section,aside,div'))
      .filter(node => /collaborators?|team|creator/i.test(clean(node.querySelector('h1,h2,h3,h4')?.textContent || node.getAttribute('aria-label') || '')));
    const collaboratorScope = collaboratorSections.length ? collaboratorSections : [document.body];
    const collaboratorLinks = collaboratorScope.flatMap(scope => Array.from(scope.querySelectorAll('a[href*="/profile/"]')));
    const collaborators = uniqueBy(collaboratorLinks.map((link, index) => {
      const href = link.href || link.getAttribute('href') || '';
      const name = clean(link.textContent || link.getAttribute('aria-label') || '');
      if (!name || name.length > 120) return null;
      const parentText = clean(link.closest('li,article,div')?.textContent || '');
      const image = link.querySelector('img') || link.closest('li,article,div')?.querySelector('img');
      const slug = href.match(/\/profile\/([^/?#]+)/)?.[1];
      return {
        id: slug || `${name}-${index}`,
        name,
        slug,
        role: /collaborator/i.test(parentText) ? 'Collaborator' : /creator/i.test(parentText) ? 'Creator' : null,
        avatar: image?.src ? { small: image.src, thumb: image.src } : undefined,
        urls: { web: { user: href } },
      };
    }).filter(Boolean), row => row.slug || row.name.toLowerCase());

    return { rewards, collaborators, renderedRewardCount: rewards.length, renderedCollaboratorCount: collaborators.length };
  });
}

async function extractProjectFromPage(page) {
  return page.evaluate(() => {
    const isObject = value => typeof value === 'object' && value !== null;
    const isProject = value => isObject(value)
      && (value.id !== undefined || typeof value.name === 'string')
      && ('pledged' in value || 'backers_count' in value || 'state' in value || 'goal' in value);
    const looksLikeReward = value => isObject(value)
      && ('minimum' in value || 'amount' in value || 'pledge_amount' in value || 'backers_count' in value || 'reward_id' in value);
    const looksLikeCollaborator = value => isObject(value)
      && ('role' in value || 'avatar' in value || 'photo' in value || 'user' in value || 'profile_url' in value);
    const detailArray = (source, keys, predicate) => {
      if (!isObject(source)) return null;
      for (const key of keys) {
        const value = source[key];
        if (Array.isArray(value) && value.some(predicate)) return value;
      }
      return null;
    };
    const mergeProjectDetails = (project, source) => {
      const merged = { ...project };
      const rewards = detailArray(source, ['rewards', 'reward_tiers', 'available_rewards'], looksLikeReward);
      const collaborators = detailArray(source, ['collaborators', 'project_collaborators', 'team_members', 'project_team'], looksLikeCollaborator);
      if ((!Array.isArray(merged.rewards) || !merged.rewards.length) && rewards) merged.rewards = rewards;
      if ((!Array.isArray(merged.collaborators) || !merged.collaborators.length) && collaborators) merged.collaborators = collaborators;
      return merged;
    };
    const scoreProject = project => {
      let score = 10;
      if (Array.isArray(project.rewards) && project.rewards.length) score += 40 + project.rewards.length;
      if (Array.isArray(project.collaborators) && project.collaborators.length) score += 30 + project.collaborators.length;
      if (Array.isArray(project.project_collaborators) && project.project_collaborators.length) score += 30 + project.project_collaborators.length;
      if (project.blurb) score += 2;
      if (project.photo) score += 2;
      return score;
    };
    const findBest = root => {
      let best = null;
      let bestScore = -1;
      const seen = new Set();
      const queue = [{ value: root, parent: null }];
      for (let index = 0; index < queue.length && index < 2500; index++) {
        const item = queue[index];
        if (!isObject(item.value) || seen.has(item.value)) continue;
        seen.add(item.value);
        if (isProject(item.value)) {
          const candidate = mergeProjectDetails(item.value, item.parent || item.value);
          const score = scoreProject(candidate);
          if (score > bestScore) {
            best = candidate;
            bestScore = score;
          }
        }
        for (const child of Object.values(item.value)) {
          if (isObject(child)) queue.push({ value: child, parent: item.value });
        }
      }
      return best;
    };
    const roots = [];
    for (const el of document.querySelectorAll('script[type="application/json"], #__NEXT_DATA__')) {
      if (!el.textContent?.trim()) continue;
      try {
        roots.push(JSON.parse(el.textContent));
      } catch {
        // Ignore non-project JSON scripts.
      }
    }
    return findBest(roots);
  });
}

async function collectPageDiagnostics(page, response, startedAt, label) {
  const pageInfo = await page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 20 && rect.height > 16 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const parseMoney = text => {
      const match = clean(text).match(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)\s*([\d,]+(?:\.\d+)?)/i);
      return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
    };
    const summarizeNode = item => ({
      tag: item.node.tagName.toLowerCase(),
      text: item.text.slice(0, 360),
      rect: {
        left: Math.round(item.rect.left),
        top: Math.round(item.rect.top),
        width: Math.round(item.rect.width),
        height: Math.round(item.rect.height),
      },
    });
    const allCandidateNodes = Array.from(document.querySelectorAll('article,section,li,div,a,button,[data-reward-id],[class*="reward" i],[class*="pledge" i],[class*="collaborator" i],[href*="/profile/"]'))
      .map(node => ({ node, text: clean(node.textContent), rect: node.getBoundingClientRect() }))
      .filter(item => item.text && visible(item.node));
    const bodyText = clean(document.body?.innerText || document.documentElement?.textContent || '');
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .map(node => clean(node.textContent))
      .filter(Boolean)
      .slice(0, 30);
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .find(node => /^available rewards$/i.test(clean(node.textContent)));
    const headingRect = heading?.getBoundingClientRect();
    const leftLimit = Math.max(420, Math.min(560, window.innerWidth * 0.36));
    const rewardTextCandidates = allCandidateNodes
      .filter(item => /backers?|pledge|estimated delivery|ships to|item included|available rewards/i.test(item.text));
    const rewardNavCandidates = allCandidateNodes
      .filter(item => item.rect.left < leftLimit
        && (!headingRect || item.rect.top > headingRect.bottom - 8)
        && item.rect.height >= 28
        && item.rect.height <= 160
        && item.rect.width >= 160
        && item.rect.width <= leftLimit + 80
        && parseMoney(item.text) > 0
        && /item included|items included|reward|special|bundle|pledge/i.test(item.text));
    const collaboratorTextCandidates = allCandidateNodes
      .filter(item => /collaborators?|team member|campaign management|premier partner|full campaign|kickbooster|expert/i.test(item.text));
    return {
      title: document.title || null,
      finalUrl: location.href,
      bodyTextLength: bodyText.length,
      bodyPreview: bodyText.slice(0, 1200),
      hasCloudflareText: /cf_chl|just a moment|enable javascript and cookies|cloudflare/i.test(bodyText),
      hasNextData: Boolean(document.querySelector('#__NEXT_DATA__')),
      jsonScriptCount: document.querySelectorAll('script[type="application/json"], #__NEXT_DATA__').length,
      hasAvailableRewardsText: /available rewards/i.test(bodyText),
      hasBackersText: /backers?/i.test(bodyText),
      hasCollaboratorsText: /collaborators?/i.test(bodyText),
      headings,
      diagnosticCandidates: {
        rewardDomNodeCount: document.querySelectorAll('[data-reward-id],[id*="reward" i],[class*="reward" i],[class*="pledge" i]').length,
        rewardTextCandidateCount: rewardTextCandidates.length,
        availableRewardNavCandidateCount: rewardNavCandidates.length,
        rewardTextPreviews: rewardTextCandidates.slice(0, 6).map(summarizeNode),
        availableRewardNavPreviews: rewardNavCandidates.slice(0, 8).map(summarizeNode),
        collaboratorDomNodeCount: document.querySelectorAll('[class*="collaborator" i],[class*="creator" i],[href*="/profile/"]').length,
        collaboratorTextCandidateCount: collaboratorTextCandidates.length,
        collaboratorTextPreviews: collaboratorTextCandidates.slice(0, 8).map(summarizeNode),
      },
    };
  }).catch(err => ({ error: safeError(err) }));
  const shouldCaptureScreenshot = DEBUG_SCREENSHOTS
    && (!response || response.status() >= 400 || pageInfo.hasCloudflareText || pageInfo.bodyTextLength < 200);
  const screenshot = shouldCaptureScreenshot
    ? await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false })
      .then(buffer => `data:image/jpeg;base64,${buffer.toString('base64')}`)
      .catch(err => ({ error: safeError(err) }))
    : null;
  const cookies = await page.context().cookies('https://www.kickstarter.com')
    .then(rows => rows.map(row => ({
      name: row.name,
      domain: row.domain,
      expires: row.expires,
      httpOnly: row.httpOnly,
      secure: row.secure,
      sameSite: row.sameSite,
    })).slice(0, 20))
    .catch(() => []);

  return {
    label,
    ok: response ? response.status() < 400 : false,
    status: response?.status() ?? null,
    contentType: response ? contentTypeFromHeaders(response.headers()) : '',
    responseHeaders: response ? diagnosticHeaders(response.headers()) : {},
    elapsedMs: Date.now() - startedAt,
    cookieCount: cookies.length,
    cookies,
    screenshot,
    ...pageInfo,
  };
}

async function extractRewardPageDetails(page) {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(500);

  const parseCurrentReward = async () => page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 40 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const parseMoney = text => {
      const match = text.match(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)\s*([\d,]+(?:\.\d+)?)/i);
      return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
    };
    const parseCount = (text, patterns) => {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return Number(match[1].replace(/,/g, '')) || 0;
      }
      return 0;
    };
    const candidates = Array.from(document.querySelectorAll('article,section,div,[data-reward-id],[class*="reward" i],[class*="pledge" i]'))
      .map(node => ({ node, text: clean(node.textContent), rect: node.getBoundingClientRect() }))
      .filter(item => visible(item.node)
        && /backers?/i.test(item.text)
        && /pledge|estimated delivery|ships to|item included/i.test(item.text)
        && item.rect.width > 260
        && item.rect.height > 160
        && item.rect.width * item.rect.height < window.innerWidth * window.innerHeight * 0.8);
    candidates.sort((a, b) => {
      const score = item => (/pledge/i.test(item.text) ? 20 : 0)
        + (/estimated delivery/i.test(item.text) ? 10 : 0)
        + (/ships to/i.test(item.text) ? 5 : 0)
        - Math.abs(item.rect.left - window.innerWidth * 0.45) / 100;
      return score(b) - score(a);
    });
    const best = candidates[0];
    if (!best) return null;

    const node = best.node;
    const text = best.text;
    const title = clean(node.querySelector('h1,h2,h3,h4,strong,[class*="title" i]')?.textContent)
      || clean(text.split(/Backers?/i)[0].split(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)\s*[\d,]+/).filter(Boolean).pop() || '').slice(0, 100);
    const amount = parseMoney(clean(node.querySelector('button,[href*="checkout"],[class*="pledge" i]')?.textContent || '')) || parseMoney(text);
    const backers = parseCount(text, [/Backers?\s*([\d,]+)/i, /([\d,]+)\s+backers?/i]);
    const remaining = parseCount(text, [/([\d,]+)\s+(?:left|remaining)/i]);
    const id = node.getAttribute('data-reward-id') || `${amount}-${title}`;
    return {
      id,
      title,
      description: text.slice(0, 900),
      minimum: amount,
      backers_count: backers,
      limit: remaining || null,
      limited: /limited|left|remaining/i.test(text),
    };
  });

  const seeds = await page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 40 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const parseMoney = text => {
      const match = text.match(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)\s*([\d,]+(?:\.\d+)?)/i);
      return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
    };
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .find(node => /^available rewards$/i.test(clean(node.textContent)));
    const headingRect = heading?.getBoundingClientRect();
    const leftLimit = Math.max(420, Math.min(560, window.innerWidth * 0.36));
    const candidates = Array.from(document.querySelectorAll('a,button,[role="button"],li,div,[data-reward-id]'))
      .map(node => {
        const rect = node.getBoundingClientRect();
        const text = clean(node.textContent);
        return { node, rect, text };
      })
      .filter(item => visible(item.node)
        && item.rect.left < leftLimit
        && (!headingRect || item.rect.top > headingRect.bottom - 8)
        && item.rect.height >= 28
        && item.rect.height <= 140
        && item.rect.width >= 180
        && item.rect.width <= leftLimit
        && parseMoney(item.text) > 0
        && /item included|items included|reward|special|bundle|pledge/i.test(item.text));
    candidates.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    const seen = new Set();
    return candidates.map(item => {
      const amount = parseMoney(item.text);
      const title = clean(item.text.split(/(?:US\$|HK\$|CA\$|A\$|\$|£|€)/)[0]).slice(0, 100);
      const key = `${amount}-${title.toLowerCase()}`;
      if (!title || seen.has(key)) return null;
      seen.add(key);
      return {
        x: item.rect.left + Math.min(item.rect.width / 2, 180),
        y: item.rect.top + Math.min(item.rect.height / 2, 48),
        title,
        minimum: amount,
        id: key,
      };
    }).filter(Boolean).slice(0, 60);
  });

  const rewards = [];
  const first = await parseCurrentReward();
  if (first) rewards.push(first);

  for (const seed of seeds) {
    try {
      await page.mouse.click(seed.x, seed.y);
      await page.waitForTimeout(450);
      const current = await parseCurrentReward();
      rewards.push({
        ...seed,
        ...(current || {}),
        title: current?.title || seed.title,
        minimum: current?.minimum || seed.minimum,
      });
    } catch {
      rewards.push(seed);
    }
  }

  const seen = new Set();
  const uniqueRewards = rewards.filter(row => {
    const key = String(row.id || `${row.minimum}-${row.title}`).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return row.title || row.minimum > 0 || row.backers_count > 0;
  });
  return { rewards: uniqueRewards, collaborators: [], renderedRewardCount: uniqueRewards.length, renderedCollaboratorCount: 0 };
}

async function extractCreatorPageDetails(page) {
  const collaborators = await page.evaluate(() => {
    const clean = value => (value || '').replace(/\s+/g, ' ').trim();
    const visible = node => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      return rect.width > 80 && rect.height > 35 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4'))
      .find(node => /^collaborators$/i.test(clean(node.textContent)));
    if (!heading) return [];
    const headingRect = heading.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll('a,article,li,section,div'))
      .map(node => ({ node, text: clean(node.textContent), rect: node.getBoundingClientRect() }))
      .filter(item => visible(item.node)
        && item.rect.top > headingRect.bottom - 10
        && item.rect.left >= headingRect.left - 60
        && item.rect.width >= 220
        && item.rect.height >= 55
        && item.rect.height <= 180
        && !/^collaborators$/i.test(item.text)
        && /(collaborator|team member|campaign management|premier partner|full campaign|expert)/i.test(item.text));
    candidates.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height));
    const seen = new Set();
    return candidates.map((item, index) => {
      const lines = Array.from(new Set(item.text.split(/\n| {2,}/).map(clean).filter(Boolean)));
      const compactLines = lines.length > 1 ? lines : item.text.split(/(?<=Management|Collaborator|Member|Partner)\s+/).map(clean).filter(Boolean);
      const first = compactLines[0] || '';
      const second = compactLines[1] || '';
      const third = compactLines[2] || '';
      const firstLooksRole = /(collaborator|team member|campaign management|premier partner|full campaign|expert)/i.test(first);
      const name = firstLooksRole && second ? second : first;
      const roleParts = firstLooksRole ? [first, third].filter(Boolean) : [second].filter(Boolean);
      const role = roleParts.join(' - ') || null;
      if (!name || /^collaborators$/i.test(name)) return null;
      const link = item.node.matches('a[href]') ? item.node : item.node.querySelector('a[href]');
      const href = link?.href || link?.getAttribute('href') || '';
      const image = item.node.querySelector('img');
      const slug = href.match(/\/profile\/([^/?#]+)/)?.[1];
      const key = String(slug || name).toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: slug || `${name}-${index}`,
        name,
        slug,
        role,
        avatar: image?.src ? { small: image.src, thumb: image.src } : undefined,
        urls: href ? { web: { user: href } } : undefined,
      };
    }).filter(Boolean);
  });
  return { rewards: [], collaborators, renderedRewardCount: 0, renderedCollaboratorCount: collaborators.length };
}

async function extractProjectTabDetails(page, targetUrl, timeoutMs, input) {
  const details = [];
  const rewardsUrl = projectSectionUrl(targetUrl, 'rewards');
  const creatorUrl = projectSectionUrl(targetUrl, 'creator');
  if (rewardsUrl) {
    try {
      await page.goto(rewardsUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 60_000) });
      await page.waitForTimeout(Number(input.settleMs || 1200));
      details.push(await extractRewardPageDetails(page));
    } catch {
      // Best effort. The main service records missing details if none are found.
    }
  }
  if (creatorUrl) {
    try {
      await page.goto(creatorUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 60_000) });
      await page.waitForTimeout(Number(input.settleMs || 1200));
      details.push(await extractCreatorPageDetails(page));
    } catch {
      // Best effort. The main service records missing details if none are found.
    }
  }
  return mergeDetailObjects(...details);
}

async function warmupKickstarterSession(page, campaignUrl, diagnostics, pageTimeoutMs, settleMs) {
  const urls = [
    'https://www.kickstarter.com/',
    campaignUrl,
  ];

  for (const [index, url] of urls.entries()) {
    const label = index === 0 ? 'warmup_home_page' : 'warmup_campaign_page';
    const startedAt = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
      const challengeCleared = await waitForChallengeResolution(page, response, label);
      await page.waitForTimeout(settleMs);
      const pageDiagnostics = await collectPageDiagnostics(page, response, startedAt, label);
      diagnostics.steps.push({
        ...pageDiagnostics,
        challengeCleared,
        ok: pageDiagnostics.ok && !pageDiagnostics.hasCloudflareText,
      });
      if (!pageDiagnostics.ok || pageDiagnostics.hasCloudflareText) {
        return false;
      }
    } catch (err) {
      const pageDiagnostics = await collectPageDiagnostics(page, null, startedAt, label).catch(() => null);
      const error = safeError(err);
      diagnostics.steps.push({
        label,
        ok: false,
        elapsedMs: Date.now() - startedAt,
        ...(pageDiagnostics ?? {}),
        error,
      });
      diagnostics.errors.push({ label, error });
      return false;
    }
  }

  return true;
}

async function waitForChallengeResolution(page, response, _label) {
  const headers = response?.headers?.() || {};
  const mitigated = String(headers['cf-mitigated'] || '').toLowerCase();
  const status = response?.status?.() ?? null;
  const initialLooksBlocked = status === 403 || mitigated === 'challenge';
  if (!initialLooksBlocked) return false;

  // Poll for resolution: Cloudflare's managed challenge JS resolves by either
  // (a) navigating the page to a URL without `__cf_chl_rt_tk`, or
  // (b) re-rendering the original document. We watch BOTH the URL and the
  // visible body text, with a tighter polling interval, so we exit as soon as
  // CF has actually let us through (often 3-10s with --headless=new) rather
  // than always sleeping the full max wait.
  const deadline = Date.now() + CHALLENGE_WAIT_MS;
  let cleared = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const url = page.url();
    const onChallengeUrl = /__cf_chl_(?:rt_)?tk=/.test(url);
    const stillBlocked = await page.evaluate(() => {
      const text = (document.body?.innerText || document.documentElement?.textContent || '').slice(0, 4000);
      return /cf_chl|just a moment|enable javascript and cookies|access denied|forbidden/i.test(text);
    }).catch(() => true);
    if (!onChallengeUrl && !stillBlocked) {
      cleared = true;
      break;
    }
  }

  // Give any post-challenge XHRs a moment to land.
  if (cleared) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
  return cleared;
}

async function newWorkerPage(context, pageTimeoutMs, diagnostics) {
  const page = await context.newPage();
  if (BLOCK_HEAVY_RESOURCES) await installResourceGuards(page);
  page.setDefaultTimeout(pageTimeoutMs);
  page.setDefaultNavigationTimeout(pageTimeoutMs);
  page.on('crash', () => {
    diagnostics.errors.push({ label: 'page_crash', error: 'Playwright page crashed.' });
  });
  return page;
}

async function fetchProjectDetailDebug(input) {
  const targetUrl = normalizeTarget(input.url);
  if (!isKickstarterProjectUrl(targetUrl)) {
    return { ok: false, status: 400, error: 'project_detail_debug only supports Kickstarter project URLs.' };
  }

  const timeoutMs = Math.max(10_000, Math.min(Number(input.timeoutMs || DEFAULT_TIMEOUT), 180_000));
  const pageTimeoutMs = Math.max(12_000, Math.min(Number(input.pageTimeoutMs || 45_000), 60_000));
  const settleMs = Number(input.settleMs || 1200);
  const startedAt = Date.now();
  const campaignUrl = pageUrlForJson(targetUrl);
  const rewardsUrl = projectSectionUrl(targetUrl, 'rewards');
  const creatorUrl = projectSectionUrl(targetUrl, 'creator');
  const diagnostics = {
    mode: 'project_detail_debug',
    targetUrl,
    campaignUrl,
    rewardsUrl,
    creatorUrl,
    timeoutMs,
    pageTimeoutMs,
    storageState: null,
    steps: [],
    errors: [],
  };

  let context = null;
  try {
    diagnostics.storageState = await storageStateInfo();
    context = await newBrowserContext(contextOptions({
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      // Let the stealth plugin's user-agent-override evasion handle UA spoofing
      // (it rewrites HeadlessChrome → Chrome while keeping the real version).
      // Manually setting Chrome/125 conflicts with stealth's logic and creates
      // a UA-vs-other-signal mismatch that CF can detect.
      viewport: { width: 1440, height: 1200 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }));

    const page = await newWorkerPage(context, pageTimeoutMs, diagnostics);

    await warmupKickstarterSession(page, campaignUrl, diagnostics, pageTimeoutMs, settleMs);

    const jsonPayloads = [];
    page.on('response', response => {
      if (jsonPayloads.length >= 80) return;
      const url = response.url();
      if (!/kickstarter\.com/i.test(url)) return;
      const contentType = contentTypeFromHeaders(response.headers()).toLowerCase();
      if (!contentType.includes('json') && !url.includes('/graphql') && !url.includes('.json')) return;
      jsonPayloads.push(
        response.text()
          .then(text => JSON.parse(text))
          .catch(() => null),
      );
    });

    let requestProject = null;
    try {
      const requestResult = await tryBrowserContextJson(context, page, targetUrl, Math.min(timeoutMs, 45_000), {
        ...input,
        referer: campaignUrl,
      });
      requestProject = findBestProject(requestResult.body);
      diagnostics.steps.push({
        label: 'context_request_json',
        ok: Boolean(requestResult.ok && requestProject),
        status: requestResult.status,
        contentType: requestResult.contentType,
        finalUrl: requestResult.finalUrl,
        detailCounts: countDetails(requestProject),
        error: requestResult.error,
      });
    } catch (err) {
      diagnostics.steps.push({ label: 'context_request_json', ok: false, error: safeError(err) });
    }

    const visit = async (label, url, afterLoad) => {
      if (!url) {
        diagnostics.steps.push({ label, ok: false, error: 'URL could not be derived.' });
        return null;
      }
      const stepStartedAt = Date.now();
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
        const challengeCleared = await waitForChallengeResolution(page, response, label);
        await page.waitForTimeout(settleMs);
        const detail = afterLoad ? await afterLoad() : null;
        const pageDiagnostics = await collectPageDiagnostics(page, response, stepStartedAt, label);
        diagnostics.steps.push({
          ...pageDiagnostics,
          challengeCleared,
          ok: pageDiagnostics.ok && !pageDiagnostics.hasCloudflareText,
          detailCounts: detail ? {
            rewards: Array.isArray(detail.rewards) ? detail.rewards.length : 0,
            collaborators: Array.isArray(detail.collaborators) ? detail.collaborators.length : 0,
          } : undefined,
        });
        return detail;
      } catch (err) {
        const pageDiagnostics = await collectPageDiagnostics(page, null, stepStartedAt, label).catch(() => null);
        const error = safeError(err);
        diagnostics.steps.push({
          label,
          ok: false,
          elapsedMs: Date.now() - stepStartedAt,
          ...(pageDiagnostics ?? {}),
          error,
        });
        diagnostics.errors.push({ label, error });
        return null;
      }
    };

    const campaignProject = await visit('campaign_page', campaignUrl, async () => {
      await scrollForLazyContent(page, { ...input, scrollSteps: Math.min(Number(input.scrollSteps || 6), 8) });
      const scriptProject = await extractProjectFromPage(page).catch(() => null);
      const renderedDetails = await extractRenderedDetails(page).catch(() => null);
      return mergeRenderedDetails(scriptProject, renderedDetails) || scriptProject;
    });

    const rewardDetails = await visit('rewards_page', rewardsUrl, async () => {
      await scrollForLazyContent(page, { ...input, scrollSteps: Math.min(Number(input.scrollSteps || 8), 10) });
      return extractRewardPageDetails(page);
    });

    const creatorPage = await newWorkerPage(context, pageTimeoutMs, diagnostics);
    const creatorDetails = await (async () => {
      try {
        const tempVisit = async () => {
          const stepStartedAt = Date.now();
          try {
            const response = await creatorPage.goto(creatorUrl, { waitUntil: 'domcontentloaded', timeout: pageTimeoutMs });
            const challengeCleared = await waitForChallengeResolution(creatorPage, response, 'creator_page');
            await creatorPage.waitForTimeout(settleMs);
            await scrollForLazyContent(creatorPage, { ...input, scrollSteps: Math.min(Number(input.scrollSteps || 5), 8) });
            const detail = await extractCreatorPageDetails(creatorPage);
            const pageDiagnostics = await collectPageDiagnostics(creatorPage, response, stepStartedAt, 'creator_page');
            diagnostics.steps.push({
              ...pageDiagnostics,
              challengeCleared,
              ok: pageDiagnostics.ok && !pageDiagnostics.hasCloudflareText,
              detailCounts: {
                rewards: Array.isArray(detail.rewards) ? detail.rewards.length : 0,
                collaborators: Array.isArray(detail.collaborators) ? detail.collaborators.length : 0,
              },
            });
            return detail;
          } catch (err) {
            const pageDiagnostics = await collectPageDiagnostics(creatorPage, null, stepStartedAt, 'creator_page').catch(() => null);
            const error = safeError(err);
            diagnostics.steps.push({
              label: 'creator_page',
              ok: false,
              elapsedMs: Date.now() - stepStartedAt,
              ...(pageDiagnostics ?? {}),
              error,
            });
            diagnostics.errors.push({ label: 'creator_page', error });
            return null;
          }
        };
        return await tempVisit();
      } finally {
        await creatorPage.close().catch(() => {});
      }
    })();

    const settledPayloads = await Promise.allSettled(jsonPayloads);
    const responsePayloads = settledPayloads
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value);
    const responseProject = findBestProject(responsePayloads);
    const renderedDetails = mergeDetailObjects(rewardDetails, creatorDetails);
    const candidates = [requestProject, responseProject, campaignProject].filter(Boolean);
    let body = candidates.sort((a, b) => projectScore(b) - projectScore(a))[0] || null;
    body = mergeRenderedDetails(body, renderedDetails) || body;

    const detailCounts = countDetails(body);
    return {
      ok: Boolean(body),
      status: diagnostics.steps.find(step => step.label === 'campaign_page')?.status ?? 0,
      contentType: diagnostics.steps.find(step => step.label === 'campaign_page')?.contentType ?? '',
      finalUrl: diagnostics.steps.find(step => step.label === 'campaign_page')?.finalUrl ?? campaignUrl,
      elapsedMs: Date.now() - startedAt,
      body,
      diagnostics: {
        ...diagnostics,
        jsonPayloadCount: responsePayloads.length,
        detailCounts,
        hasRewards: detailCounts.rewards > 0,
        hasCollaborators: detailCounts.collaborators > 0,
      },
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
      diagnostics: {
        ...diagnostics,
        errors: [...diagnostics.errors, { label: 'fatal', error: safeError(err) }],
      },
    };
  } finally {
    if (context) await saveBrowserStorageState(context, diagnostics).catch(() => {});
    await context?.close().catch(() => {});
  }
}

async function scrollForLazyContent(page, input) {
  const steps = Math.max(1, Math.min(Number(input.scrollSteps || 8), 20));
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.max(600, Math.floor(window.innerHeight * 0.85))));
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

async function installResourceGuards(page) {
  await page.route('**/*', route => {
    const request = route.request();
    const resourceType = request.resourceType();
    const url = request.url();
    if (BLOCK_HEAVY_RESOURCES && ['image', 'media', 'font'].includes(resourceType)) {
      route.abort().catch(() => {});
      return;
    }
    if (/google-analytics|googletagmanager|doubleclick|facebook|segment|sentry|hotjar|intercom/i.test(url)) {
      route.abort().catch(() => {});
      return;
    }
    route.continue().catch(() => {});
  });
}

async function tryBrowserContextJson(context, page, targetUrl, timeoutMs, input) {
  const referer = input.referer || navigationUrlForTarget(targetUrl, 'json');
  try {
    const warmupResponse = await page.goto(referer, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 45_000),
    });
    await waitForChallengeResolution(page, warmupResponse, 'context_request_warmup');
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {});
    await page.waitForTimeout(Number(input.settleMs || 1000));
    await saveBrowserStorageState(context).catch(() => {});
  } catch {
    // The warmup page is best-effort. The API request below may still work.
  }

  const requestJson = () => context.request.get(targetUrl, {
    timeout: timeoutMs,
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': referer,
      'X-Requested-With': 'XMLHttpRequest',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  let response = await requestJson();
  if (response.status() === 403) {
    await page.waitForTimeout(CHALLENGE_WAIT_MS);
    await saveBrowserStorageState(context).catch(() => {});
    response = await requestJson();
  }
  let text = await response.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    text = text.slice(0, MAX_BODY_BYTES);
  }
  if (!response.ok()) {
    return {
      ok: false,
      status: response.status(),
      contentType: contentTypeFromHeaders(response.headers()),
      finalUrl: targetUrl,
      text,
    };
  }
  const parsed = JSON.parse(text);
  return {
    ok: true,
    status: response.status(),
    contentType: contentTypeFromHeaders(response.headers()),
    finalUrl: targetUrl,
    body: isKickstarterProjectUrl(targetUrl) ? findBestProject(parsed) || parsed : parsed,
  };
}

async function fetchWithBrowser(input, tracker = null) {
  const step = (label, info) => tracker?.step?.(label, info);
  const targetUrl = normalizeTarget(input.url);
  step('normalized_target', { targetUrl });
  if (input.mode === 'project_detail_debug') {
    return fetchProjectDetailDebug(input);
  }
  const expect = input.expect === 'html' ? 'html' : 'json';
  const timeoutMs = Math.max(10_000, Math.min(Number(input.timeoutMs || DEFAULT_TIMEOUT), 180_000));
  step('context_creating', { timeoutMs, expect });
  const context = await newBrowserContext(contextOptions({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    // UA handled by stealth's user-agent-override evasion; see launch site above.
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
  step('context_created');

  const page = await context.newPage();
  if (BLOCK_HEAVY_RESOURCES) await installResourceGuards(page);
  let pageCrashed = false;
  page.on('crash', () => {
    pageCrashed = true;
  });
  let requestJsonResult = null;
  const jsonResponsePromises = [];
  page.on('response', response => {
    if (expect !== 'json' || jsonResponsePromises.length >= 50) return;
    const url = response.url();
    if (!/kickstarter\.com/i.test(url)) return;
    const contentType = contentTypeFromHeaders(response.headers()).toLowerCase();
    if (!contentType.includes('json') && !url.includes('/graphql') && !url.includes('.json')) return;
    jsonResponsePromises.push(
      response.text()
        .then(text => JSON.parse(text))
        .catch(() => null),
    );
  });
  const startedAt = Date.now();
  try {
    let requestFallback = null;
    if (expect === 'json') {
      try {
        step('try_browser_context_json:start');
        const result = await tryBrowserContextJson(context, page, targetUrl, timeoutMs, input);
        step('try_browser_context_json:done', { ok: result.ok, status: result.status, finalUrl: result.finalUrl });
        if (result.ok) {
          requestJsonResult = result;
          if (!isKickstarterProjectUrl(targetUrl)) {
            return {
              ...result,
              elapsedMs: Date.now() - startedAt,
            };
          }
          if (input.basicOnly) {
            return {
              ...result,
              elapsedMs: Date.now() - startedAt,
            };
          }
          if (isObject(result.body) && isProject(result.body) && hasProjectDetails(result.body)) {
            return {
              ...result,
              elapsedMs: Date.now() - startedAt,
            };
          }
        }
        requestFallback = result;
      } catch (err) {
        requestFallback = {
          ok: false,
          status: 0,
          contentType: '',
          finalUrl: targetUrl,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const navigationUrl = navigationUrlForTarget(targetUrl, expect);
    step('page_goto:start', { navigationUrl });
    const response = await page.goto(navigationUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    step('page_goto:done', { status: response?.status?.() ?? null, finalUrl: page.url() });
    if (!response) {
      throw new Error('No browser response');
    }

    if (pageCrashed) throw new Error(`Page crashed while navigating to ${navigationUrl}`);
    step('waitForChallengeResolution:start');
    const challengeCleared = await waitForChallengeResolution(page, response, 'generic_fetch_navigation');
    step('waitForChallengeResolution:done', { challengeCleared });
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 20_000) }).catch(() => {});
    await saveBrowserStorageState(context).catch(() => {});
    await page.waitForTimeout(Number(input.settleMs || 1200));
    step('post_goto_settle_done');

    // If CF challenge cleared during the page.goto pass, the browser context
    // now holds a valid cf_clearance cookie. The earlier context.request.get
    // (in tryBrowserContextJson) ran before that cookie existed, so its 403
    // doesn't mean the endpoint is unreachable — retry through the same
    // context now that we're authenticated.
    if (expect === 'json' && challengeCleared && (!requestJsonResult || !requestJsonResult.ok)) {
      step('post_challenge_json_retry:start');
      try {
        const retry = await context.request.get(targetUrl, {
          timeout: Math.min(timeoutMs, 30_000),
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': page.url(),
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
          },
        });
        step('post_challenge_json_retry:done', { status: retry.status(), ok: retry.ok() });
        if (retry.ok()) {
          const retryText = await retry.text();
          const sizedText = Buffer.byteLength(retryText) > MAX_BODY_BYTES
            ? retryText.slice(0, MAX_BODY_BYTES) : retryText;
          try {
            const parsed = JSON.parse(sizedText);
            return {
              ok: true,
              status: retry.status(),
              contentType: contentTypeFromHeaders(retry.headers()),
              finalUrl: targetUrl,
              body: isKickstarterProjectUrl(targetUrl) ? findBestProject(parsed) || parsed : parsed,
              elapsedMs: Date.now() - startedAt,
            };
          } catch { /* fall through to page extraction below */ }
        }
      } catch (err) {
        step('post_challenge_json_retry:error', { error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (expect === 'json') {
      await scrollForLazyContent(page, input);
      await page.waitForTimeout(Number(input.settleMs || 1200));
    }

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    const finalUrl = page.url();
    let text = '';
    if (expect === 'html') {
      // After Cloudflare clears via in-page JS, the original navigation response
      // is still the 403 challenge body — the real content now lives in the DOM.
      // Prefer the live DOM so callers (and the warm-up check) see real content.
      const live = pageCrashed ? '' : await page.content().catch(() => '');
      const raw = await response.text().catch(() => '');
      text = live && live.length >= raw.length ? live : (raw || live);
    } else {
      if (pageCrashed) throw new Error(`Page crashed before extracting text from ${navigationUrl}`);
      text = await page.evaluate(() => document.body?.innerText || document.documentElement?.textContent || '');
    }
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      text = text.slice(0, MAX_BODY_BYTES);
    }

    if (expect === 'json') {
      let body;
      let renderedDetails = null;
      try {
        body = JSON.parse(text);
      } catch {
        // KS redirects .json URLs to the HTML project page in a browser context.
        // Extract embedded project data from Next.js and other JSON script tags.
        body = isKickstarterProjectUrl(targetUrl) ? await page.evaluate(() => {
          const isObject = value => typeof value === 'object' && value !== null;
          const isProject = value => isObject(value)
            && (value.id !== undefined || typeof value.name === 'string')
            && ('pledged' in value || 'backers_count' in value || 'state' in value || 'goal' in value);
          const looksLikeReward = value => isObject(value)
            && ('minimum' in value || 'amount' in value || 'pledge_amount' in value || 'backers_count' in value || 'reward_id' in value);
          const looksLikeCollaborator = value => isObject(value)
            && ('role' in value || 'avatar' in value || 'photo' in value || 'user' in value || 'profile_url' in value);
          const detailArray = (source, keys, predicate) => {
            if (!isObject(source)) return null;
            for (const key of keys) {
              const value = source[key];
              if (Array.isArray(value) && value.some(predicate)) return value;
            }
            return null;
          };
          const mergeProjectDetails = (project, source) => {
            const merged = { ...project };
            const rewards = detailArray(source, ['rewards', 'reward_tiers', 'available_rewards'], looksLikeReward);
            const collaborators = detailArray(source, ['collaborators', 'project_collaborators', 'team_members', 'project_team'], looksLikeCollaborator);
            if ((!Array.isArray(merged.rewards) || !merged.rewards.length) && rewards) merged.rewards = rewards;
            if ((!Array.isArray(merged.collaborators) || !merged.collaborators.length) && collaborators) merged.collaborators = collaborators;
            return merged;
          };
          const scoreProject = project => {
            let score = 10;
            if (Array.isArray(project.rewards) && project.rewards.length) score += 40 + project.rewards.length;
            if (Array.isArray(project.collaborators) && project.collaborators.length) score += 30 + project.collaborators.length;
            if (Array.isArray(project.project_collaborators) && project.project_collaborators.length) score += 30 + project.project_collaborators.length;
            if (project.blurb) score += 2;
            if (project.photo) score += 2;
            return score;
          };
          const findBest = root => {
            let best = null;
            let bestScore = -1;
            const seen = new Set();
            const queue = [{ value: root, parent: null }];
            for (let index = 0; index < queue.length && index < 2500; index++) {
              const item = queue[index];
              if (!isObject(item.value) || seen.has(item.value)) continue;
              seen.add(item.value);
              if (isProject(item.value)) {
                const candidate = mergeProjectDetails(item.value, item.parent || item.value);
                const score = scoreProject(candidate);
                if (score > bestScore) {
                  best = candidate;
                  bestScore = score;
                }
              }
              for (const child of Object.values(item.value)) {
                if (isObject(child)) queue.push({ value: child, parent: item.value });
              }
            }
            return best;
          };
          const roots = [];
          for (const el of document.querySelectorAll('script[type="application/json"], #__NEXT_DATA__')) {
            if (!el.textContent?.trim()) continue;
            try {
              roots.push(JSON.parse(el.textContent));
            } catch {
              // Ignore non-project JSON scripts.
            }
          }
          return findBest(roots);
        }) : null;
        const settledPayloads = await Promise.allSettled(jsonResponsePromises);
        const responsePayloads = settledPayloads
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => result.value);
        if (isKickstarterProjectUrl(targetUrl)) {
          const responseProject = findBestProject(responsePayloads);
          if (responseProject && (!body || projectScore(responseProject) > projectScore(body))) {
            body = responseProject;
          }
        } else {
          const discoverPayload = responsePayloads.find(payload => isObject(payload) && Array.isArray(payload.projects));
          if (discoverPayload) body = discoverPayload;
        }
        if (!body) {
          const statusDetail = status >= 400 ? `HTTP ${status}` : 'response is not JSON';
          const requestDetail = requestFallback
            ? `; browser request fallback status=${requestFallback.status} error=${requestFallback.error || ''}`
            : '';
          throw new Error(`Could not extract JSON: ${statusDetail} and no __NEXT_DATA__ project found${requestDetail}`);
        }
      }
      try {
        if (isKickstarterProjectUrl(targetUrl) && !input.basicOnly) {
          renderedDetails = await extractRenderedDetails(page);
          renderedDetails = mergeDetailObjects(
            renderedDetails,
            await extractProjectTabDetails(page, targetUrl, timeoutMs, input),
          );
        }
      } catch {
        renderedDetails = null;
      }
      if (isKickstarterProjectUrl(targetUrl)) {
        const requestProject = findBestProject(requestJsonResult?.body);
        const pageProject = mergeRenderedDetails(findBestProject(body) || body, renderedDetails);
        const requestProjectWithRenderedDetails = mergeRenderedDetails(requestProject, renderedDetails);
        if (requestProjectWithRenderedDetails && (!pageProject || projectScore(requestProjectWithRenderedDetails) > projectScore(pageProject))) {
          body = requestProjectWithRenderedDetails;
        } else {
          body = pageProject;
        }
      }
      return {
        ok: status >= 200 && status < 400,
        status,
        contentType,
        finalUrl,
        elapsedMs: Date.now() - startedAt,
        body,
      };
    }

    // For HTML, the original navigation status is often a stale 403 from the CF
    // challenge even after it clears. Base success on whether the delivered
    // content still looks like a challenge, not the initial status code.
    const htmlBlocked = /just a moment|cf_chl|enable javascript and cookies|attention required/i.test(text);
    return {
      ok: !htmlBlocked && text.length > 0,
      status,
      blocked: htmlBlocked,
      contentType,
      finalUrl,
      elapsedMs: Date.now() - startedAt,
      text,
    };
  } finally {
    await saveBrowserStorageState(context).catch(() => {});
    await context.close().catch(() => {});
    await onRequestComplete().catch(() => {});
  }
}

async function probeBrowserConnection() {
  if (!browserPromise) {
    return { initialized: false, connected: null, version: null };
  }
  try {
    const browser = await browserPromise;
    return {
      initialized: true,
      connected: browser.isConnected?.() ?? null,
      version: typeof browser.version === 'function' ? browser.version() : null,
    };
  } catch (err) {
    return { initialized: false, connected: false, version: null, error: safeError(err) };
  }
}

function workerEnvSummary() {
  const memory = process.memoryUsage();
  const proxy = getProxyOptions();
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSec: Math.round(process.uptime()),
    memoryMB: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
      external: Math.round(memory.external / 1024 / 1024),
    },
    proxy: {
      configured: Boolean(proxy),
      server: proxy?.server ?? null,
      hasUsername: Boolean(proxy?.username),
      hasPassword: Boolean(proxy?.password),
      bypass: proxy?.bypass ?? null,
    },
    flags: {
      debugScreenshots: DEBUG_SCREENSHOTS,
      blockHeavyResources: BLOCK_HEAVY_RESOURCES,
      ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS,
      headed: USE_HEADED,
      headlessMode: HEADLESS_MODE,
      chromeChannel: CHROME_CHANNEL || null,
      challengeWaitMs: CHALLENGE_WAIT_MS,
      oxylabsUserAgentType: OXYLABS_USER_AGENT_TYPE || null,
      launchMaxAttempts: LAUNCH_MAX_ATTEMPTS,
      tokenConfigured: Boolean(TOKEN),
      playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
      recycleAfterRequests: BROWSER_RECYCLE_AFTER_REQUESTS,
      requestsSinceLaunch,
      curateLaunchEnv: CURATE_LAUNCH_ENV,
      exitOnLaunchFailure: EXIT_ON_LAUNCH_FAILURE,
      maxConcurrency: MAX_CONCURRENCY,
      activeFetches,
      queuedFetches: fetchWaiters.length,
    },
    launchEnv: {
      // Helps confirm the E2BIG fix: how much smaller the curated env is vs the
      // full process env (E2BIG is driven by total argv+envp byte size).
      fullVarCount: Object.keys(process.env).length,
      fullApproxBytes: Object.entries(process.env).reduce((n, [k, v]) => n + k.length + String(v ?? '').length + 2, 0),
      curatedVarCount: CURATE_LAUNCH_ENV ? Object.keys(curatedLaunchEnv()).length : null,
      curatedApproxBytes: CURATE_LAUNCH_ENV
        ? Object.entries(curatedLaunchEnv()).reduce((n, [k, v]) => n + k.length + String(v ?? '').length + 2, 0)
        : null,
    },
    lastLaunchError,
    launchHistory: launchHistory.slice(-10),
  };
}

async function runDiagnostics({ skipLaunch = false, fetchUrl = null } = {}) {
  const startedAt = Date.now();
  const runningBrowser = await probeBrowserConnection();

  const launchTest = { attempted: false, skipped: skipLaunch, ok: false, elapsedMs: null, error: null, browserVersion: null };
  if (!skipLaunch) {
    launchTest.attempted = true;
    const lt = Date.now();
    let testBrowser = null;
    try {
      testBrowser = await attemptLaunch('diag_launch_test');
      launchTest.ok = true;
      launchTest.browserVersion = typeof testBrowser.version === 'function' ? testBrowser.version() : null;
    } catch (err) {
      launchTest.error = safeError(err);
    } finally {
      launchTest.elapsedMs = Date.now() - lt;
      if (testBrowser) {
        await testBrowser.close().catch(() => {});
      }
    }
  }

  let fetchTest = null;
  if (fetchUrl) {
    let context = null;
    const ft = { attempted: true, url: fetchUrl, ok: false, status: null, elapsedMs: null, error: null, contentTypePreview: null, bodyPreview: null };
    const fts = Date.now();
    try {
      context = await newBrowserContext(contextOptions({
        locale: 'en-US',
        timezoneId: 'America/Los_Angeles',
        // UA handled by stealth plugin.
      }));
      const response = await context.request.get(fetchUrl, {
        timeout: Math.max(10_000, Math.min(Number(process.env.BROWSER_DIAG_FETCH_TIMEOUT_MS || 25_000), 60_000)),
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      ft.ok = response.ok();
      ft.status = response.status();
      const headers = response.headers();
      ft.contentTypePreview = (headers['content-type'] || '').slice(0, 120);
      const text = await response.text();
      ft.bodyPreview = text.slice(0, 240);
    } catch (err) {
      ft.error = safeError(err);
    } finally {
      ft.elapsedMs = Date.now() - fts;
      await context?.close?.().catch(() => {});
      fetchTest = ft;
    }
  }

  return {
    ok: skipLaunch ? true : launchTest.ok,
    service: 'kicksonar-browser-worker',
    now: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    runningBrowser,
    launchTest,
    fetchTest,
    stealth: stealthDiagnostics(),
    warmup: warmupState,
    storageState: await storageStateInfo(),
    env: workerEnvSummary(),
  };
}

// Concurrency gate for /fetch. The worker has a SINGLE chromium browser; in a
// resource-constrained container, running many contexts concurrently piles up
// memory, starves the Node event loop (so even /health times out at Railway's
// 5s edge limit → HTTP 000), and makes Cloudflare clearance flaky from
// contention. Serializing /fetch (default 1) keeps the worker responsive and
// CF clearance reliable. Extra requests queue briefly, then 503 so callers
// back off instead of dogpiling.
const MAX_CONCURRENCY = Math.max(1, Math.min(Number(process.env.BROWSER_MAX_CONCURRENCY || 1), 4));
const MAX_QUEUE = Math.max(0, Math.min(Number(process.env.BROWSER_MAX_QUEUE || 6), 50));
const FETCH_QUEUE_WAIT_MS = Math.max(1000, Math.min(Number(process.env.BROWSER_QUEUE_WAIT_MS || 120_000), 300_000));
let activeFetches = 0;
const fetchWaiters = [];

function acquireFetchSlot() {
  return new Promise((resolve, reject) => {
    if (activeFetches < MAX_CONCURRENCY) {
      activeFetches++;
      resolve();
      return;
    }
    if (fetchWaiters.length >= MAX_QUEUE) {
      const e = new Error(`Worker busy: fetch queue full (active=${activeFetches}, queued=${fetchWaiters.length})`);
      e.code = 'QUEUE_FULL';
      reject(e);
      return;
    }
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const idx = fetchWaiters.indexOf(waiter);
      if (idx >= 0) fetchWaiters.splice(idx, 1);
      const e = new Error('Worker busy: queued fetch timed out waiting for a slot');
      e.code = 'QUEUE_TIMEOUT';
      reject(e);
    }, FETCH_QUEUE_WAIT_MS);
    fetchWaiters.push(waiter);
  });
}

function releaseFetchSlot() {
  const next = fetchWaiters.shift();
  if (next) {
    if (next.timer) clearTimeout(next.timer);
    next.resolve(); // hand the slot off without changing activeFetches
  } else {
    activeFetches = Math.max(0, activeFetches - 1);
  }
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    let browserConnected = null;
    try {
      const browser = browserPromise ? await browserPromise : null;
      browserConnected = browser ? browser.isConnected() : null;
    } catch {
      browserConnected = false;
    }
    send(res, 200, {
      ok: true,
      service: 'kicksonar-browser-worker',
      browserConnected,
      hasProxy: Boolean(getProxyOptions()),
      proxyServer: getProxyOptions()?.server || null,
      storageState: await storageStateInfo(),
      debugScreenshots: DEBUG_SCREENSHOTS,
      blockHeavyResources: BLOCK_HEAVY_RESOURCES,
      ignoreHTTPSErrors: IGNORE_HTTPS_ERRORS,
      oxylabsUserAgentType: OXYLABS_USER_AGENT_TYPE || null,
      activeFetches,
      queuedFetches: fetchWaiters.length,
      maxConcurrency: MAX_CONCURRENCY,
      warmup: warmupState,
      lastLaunchError,
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/requests' || req.url.startsWith('/requests?'))) {
    if (!assertAuthorized(req)) {
      send(res, 401, { error: 'Unauthorized' });
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 10), 30));
    send(res, 200, {
      ok: true,
      service: 'kicksonar-browser-worker',
      now: new Date().toISOString(),
      total: requestHistory.length,
      requests: requestHistory.slice(-limit).reverse(),
    });
    return;
  }

  if (req.method === 'GET' && (req.url === '/diag' || req.url.startsWith('/diag?'))) {
    if (!assertAuthorized(req)) {
      send(res, 401, { error: 'Unauthorized' });
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const skipLaunch = url.searchParams.get('skipLaunch') === '1';
    const fetchUrl = url.searchParams.get('fetchUrl');
    try {
      const result = await runDiagnostics({ skipLaunch, fetchUrl });
      send(res, result.ok ? 200 : 503, result);
    } catch (err) {
      send(res, 500, {
        ok: false,
        service: 'kicksonar-browser-worker',
        error: safeError(err),
        env: workerEnvSummary(),
      });
    }
    return;
  }

  if (req.method !== 'POST' || req.url !== '/fetch') {
    send(res, 404, { error: 'Not found' });
    return;
  }

  if (!assertAuthorized(req)) {
    send(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Read the body before queueing so a malformed request fails fast.
  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    send(res, 400, { ok: false, error: `Invalid JSON body: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Acquire a concurrency slot (serialized by default). Reject fast with 503 if
  // the worker is saturated, so the caller backs off instead of piling on.
  try {
    await acquireFetchSlot();
  } catch (err) {
    const retryable = err && (err.code === 'QUEUE_FULL' || err.code === 'QUEUE_TIMEOUT');
    res.setHeader('Retry-After', '30');
    send(res, retryable ? 503 : 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: err?.code ?? null,
      active: activeFetches,
      queued: fetchWaiters.length,
    });
    return;
  }

  let tracker = null;
  const startedAt = Date.now();
  try {
    tracker = trackRequestStart(body);
    tracker.step('fetch_start', { hasProxy: Boolean(getProxyOptions()), active: activeFetches, queued: fetchWaiters.length });
    const result = await fetchWithBrowser(body, tracker);
    tracker.finish({
      ok: result.ok ?? false,
      status: result.status ?? null,
      finalUrl: result.finalUrl ?? null,
      durationMs: Date.now() - startedAt,
    });
    send(res, 200, result);
  } catch (err) {
    const errorInfo = safeError(err);
    if (tracker) {
      tracker.finish({
        ok: false,
        durationMs: Date.now() - startedAt,
        error: errorInfo,
      });
    }
    send(res, 500, {
      ok: false,
      error: errorInfo.message,
      errorDetails: {
        ...errorInfo,
        proxyConfigured: Boolean(getProxyOptions()),
        proxyServer: getProxyOptions()?.server ?? null,
        browserInitialized: Boolean(browserPromise),
        lastLaunchError,
      },
    });
  } finally {
    releaseFetchSlot();
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  });
});

// Startup self-warm: clear Cloudflare's challenge once at boot so cf_clearance
// is persisted into storageState before real traffic arrives. This runs
// IN-PROCESS (not through Railway's edge proxy), so it isn't subject to the
// ~100s edge connection timeout that makes a *cold* external /fetch fail with
// HTTP 000. After warm-up, external callers hit the fast (~6s) warm path and
// stay comfortably under the edge limit. Re-runs on every boot, including the
// self-heal restarts. Disable with BROWSER_WARMUP_ON_START=0.
const WARMUP_ON_START = !/^(0|false|no)$/i.test(process.env.BROWSER_WARMUP_ON_START || '1');
// cf_clearance is a per-DOMAIN cookie, so warming via the lightest kickstarter
// page primes it for the (harder) discover JSON endpoint too. The homepage /
// a project HTML page clears CF far more reliably than discover?format=json,
// which CF treats more aggressively. Warm via HTML, reap the cookie for JSON.
const WARMUP_URL = (process.env.BROWSER_WARMUP_URL || 'https://www.kickstarter.com/').trim();

let warmupState = { attempted: false, ok: false, attempts: 0, lastError: null, lastAt: null, elapsedMs: null };

async function warmUpChallenge() {
  if (!WARMUP_ON_START) return;
  const maxAttempts = Math.max(1, Math.min(Number(process.env.BROWSER_WARMUP_MAX_ATTEMPTS || 3), 5));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    warmupState.attempted = true;
    warmupState.attempts = attempt;
    warmupState.lastAt = new Date().toISOString();
    const startedAt = Date.now();
    let slotHeld = false;
    try {
      await acquireFetchSlot();
      slotHeld = true;
      // expect:'html' — we just need the navigation to clear CF and persist
      // cf_clearance into storageState; we don't care about the body.
      const result = await fetchWithBrowser({ url: WARMUP_URL, expect: 'html', timeoutMs: 170_000, settleMs: 1500 });
      warmupState.elapsedMs = Date.now() - startedAt;
      if (result?.ok) {
        warmupState.ok = true;
        warmupState.lastError = null;
        console.log(`[browser-worker] warm-up OK in ${warmupState.elapsedMs}ms (attempt ${attempt}); cf_clearance primed.`);
        return;
      }
      warmupState.lastError = result?.error ? String(result.error).slice(0, 200) : `status=${result?.status ?? 'unknown'}`;
      console.warn(`[browser-worker] warm-up attempt ${attempt} did not clear (${warmupState.lastError}).`);
    } catch (err) {
      warmupState.elapsedMs = Date.now() - startedAt;
      warmupState.lastError = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console.warn(`[browser-worker] warm-up attempt ${attempt} threw: ${warmupState.lastError}`);
      if (isUnrecoverableSpawnError(err)) return; // self-heal exit already scheduled
    } finally {
      if (slotHeld) releaseFetchSlot();
    }
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 3000));
  }
}

server.listen(PORT, () => {
  console.log(`[browser-worker] listening on ${PORT}`);
  // Kick off warm-up after the server is accepting connections so /health stays
  // responsive during the (potentially slow) first cold challenge.
  setTimeout(() => { warmUpChallenge().catch(() => {}); }, 500);
});

process.on('SIGTERM', async () => {
  try {
    const browser = await browserPromise;
    await browser?.close();
  } finally {
    process.exit(0);
  }
});
