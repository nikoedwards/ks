import http from 'node:http';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const TOKEN = (process.env.BROWSER_WORKER_TOKEN || '').trim();
const DEFAULT_TIMEOUT = Number(process.env.BROWSER_FETCH_TIMEOUT_MS || 60000);
const MAX_BODY_BYTES = Number(process.env.BROWSER_FETCH_MAX_BYTES || 5_000_000);

const ALLOWED_HOSTS = new Set([
  'www.kickstarter.com',
  'kickstarter.com',
  'www.kicktraq.com',
  'kicktraq.com',
]);

let browserPromise;

function launchBrowser() {
  const promise = chromium.launch({
    headless: true,
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
      return await browser.newContext(options);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/browser has been closed|Target page, context or browser has been closed|Browser closed|disconnected/i.test(message)) {
        throw err;
      }
      browserPromise = null;
      if (attempt === 0) continue;
    }
  }
  throw lastError;
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
    if (['image', 'media', 'font'].includes(resourceType)) {
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
    body: findBestProject(parsed) || parsed,
  };
}

async function fetchWithBrowser(input) {
  const targetUrl = normalizeTarget(input.url);
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
  await installResourceGuards(page);
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
        body = await page.evaluate(() => {
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
        const settledPayloads = await Promise.allSettled(jsonResponsePromises);
        const responsePayloads = settledPayloads
          .filter(result => result.status === 'fulfilled' && result.value)
          .map(result => result.value);
        const responseProject = findBestProject(responsePayloads);
        if (responseProject && (!body || projectScore(responseProject) > projectScore(body))) {
          body = responseProject;
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
        renderedDetails = await extractRenderedDetails(page);
      } catch {
        renderedDetails = null;
      }
      const requestProject = findBestProject(requestJsonResult?.body);
      const pageProject = mergeRenderedDetails(findBestProject(body) || body, renderedDetails);
      const requestProjectWithRenderedDetails = mergeRenderedDetails(requestProject, renderedDetails);
      if (requestProjectWithRenderedDetails && (!pageProject || projectScore(requestProjectWithRenderedDetails) > projectScore(pageProject))) {
        body = requestProjectWithRenderedDetails;
      } else {
        body = pageProject;
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
    await context.close();
  }
}

async function handle(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, service: 'kicksonar-browser-worker' });
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
