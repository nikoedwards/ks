import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.BROWSER_WORKER_TOKEN || '').trim();
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_FETCH_TIMEOUT_MS || 60000);
const MAX_BODY_BYTES = Number(process.env.BROWSER_FETCH_MAX_BYTES || 5_000_000);
const STORAGE_STATE_PATH = process.env.BROWSER_STORAGE_STATE_PATH
  || path.join(os.tmpdir(), 'kicksonar-browser-worker-storage-state.json');
const DEBUG_SCREENSHOTS = !/^(0|false|no)$/i.test(process.env.BROWSER_DEBUG_SCREENSHOTS || '1');
const BLOCK_HEAVY_RESOURCES = /^(1|true|yes)$/i.test(process.env.BROWSER_BLOCK_HEAVY_RESOURCES || '0');
const CHALLENGE_WAIT_MS = Math.max(3000, Math.min(Number(process.env.BROWSER_CHALLENGE_WAIT_MS || 15_000), 60_000));

const ALLOWED_HOSTS = new Set([
  'www.kickstarter.com',
  'kickstarter.com',
  'www.kicktraq.com',
  'kicktraq.com',
]);

let browserPromise;

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

function launchBrowser() {
  const proxy = getProxyOptions();
  const promise = chromium.launch({
    headless: true,
    ...(proxy ? { proxy } : {}),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  }).then(browser => {
    browser.on('disconnected', () => {
      if (browserPromise === promise) browserPromise = null;
    });
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
  return {
    name: err instanceof Error ? err.name : 'Error',
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
  };
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

async function waitForChallengeResolution(page, response, label) {
  const headers = response?.headers?.() || {};
  const mitigated = String(headers['cf-mitigated'] || '').toLowerCase();
  const status = response?.status?.() ?? null;
  const initialLooksBlocked = status === 403 || mitigated === 'challenge';
  if (!initialLooksBlocked) return false;

  await page.waitForTimeout(CHALLENGE_WAIT_MS);
  await page.waitForLoadState('networkidle', { timeout: Math.min(CHALLENGE_WAIT_MS, 20_000) }).catch(() => {});
  const stillBlocked = await page.evaluate(() => {
    const text = (document.body?.innerText || document.documentElement?.textContent || '').replace(/\s+/g, ' ').trim();
    return /cf_chl|just a moment|enable javascript and cookies|cloudflare|forbidden|access denied/i.test(text);
  }).catch(() => true);
  return !stillBlocked;
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
    context = await newBrowserContext({
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 1200 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

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
    await page.goto(referer, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 45_000),
    });
    await page.waitForTimeout(Number(input.settleMs || 1000));
  } catch {
    // The warmup page is best-effort. The API request below may still work.
  }

  const response = await context.request.get(targetUrl, {
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

async function fetchWithBrowser(input) {
  const targetUrl = normalizeTarget(input.url);
  if (input.mode === 'project_detail_debug') {
    return fetchProjectDetailDebug(input);
  }
  const expect = input.expect === 'html' ? 'html' : 'json';
  const timeoutMs = Math.max(10_000, Math.min(Number(input.timeoutMs || DEFAULT_TIMEOUT), 180_000));
  const context = await newBrowserContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

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
        const result = await tryBrowserContextJson(context, page, targetUrl, timeoutMs, input);
        if (result.ok) {
          requestJsonResult = result;
          if (!isKickstarterProjectUrl(targetUrl)) {
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
    const response = await page.goto(navigationUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!response) {
      throw new Error('No browser response');
    }

    if (pageCrashed) throw new Error(`Page crashed while navigating to ${navigationUrl}`);
    await page.waitForTimeout(Number(input.settleMs || 1200));
    if (expect === 'json') {
      await scrollForLazyContent(page, input);
      await page.waitForTimeout(Number(input.settleMs || 1200));
    }

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    const finalUrl = page.url();
    let text = '';
    if (expect === 'html') {
      text = await response.text().catch(async () => {
        if (pageCrashed) return '';
        return page.content();
      });
      if (!text && !pageCrashed) text = await page.content();
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
        if (isKickstarterProjectUrl(targetUrl)) {
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

    return {
      ok: status >= 200 && status < 400,
      status,
      contentType,
      finalUrl,
      elapsedMs: Date.now() - startedAt,
      text,
    };
  } finally {
    await saveBrowserStorageState(context).catch(() => {});
    await context.close();
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
    });
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

  try {
    const body = await readJson(req);
    const result = await fetchWithBrowser(body);
    send(res, 200, result);
  } catch (err) {
    send(res, 500, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  });
});

server.listen(PORT, () => {
  console.log(`[browser-worker] listening on ${PORT}`);
});

process.on('SIGTERM', async () => {
  try {
    const browser = await browserPromise;
    await browser?.close();
  } finally {
    process.exit(0);
  }
});
