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

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    });
  }
  return browserPromise;
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

function projectScore(project) {
  let score = 10;
  if (Array.isArray(project.rewards) && project.rewards.length) score += 40 + project.rewards.length;
  if (Array.isArray(project.collaborators) && project.collaborators.length) score += 30 + project.collaborators.length;
  if (Array.isArray(project.project_collaborators) && project.project_collaborators.length) score += 30 + project.project_collaborators.length;
  if (project.blurb) score += 2;
  if (project.photo) score += 2;
  return score;
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

async function tryBrowserContextJson(context, page, targetUrl, timeoutMs, input) {
  const referer = input.referer || pageUrlForJson(targetUrl);
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
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1200 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const page = await context.newPage();
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
          return {
            ...result,
            elapsedMs: Date.now() - startedAt,
          };
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

    const response = await page.goto(targetUrl, {
      waitUntil: 'load',
      timeout: timeoutMs,
    });
    if (!response) {
      throw new Error('No browser response');
    }

    await page.waitForTimeout(Number(input.settleMs || 1200));

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    const finalUrl = page.url();
    let text = expect === 'html'
      ? await page.content()
      : await page.evaluate(() => document.body?.innerText || document.documentElement?.textContent || '');
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      text = text.slice(0, MAX_BODY_BYTES);
    }

    if (expect === 'json') {
      let body;
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
