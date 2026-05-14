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
  const startedAt = Date.now();
  try {
    const response = await page.goto(targetUrl, {
      waitUntil: expect === 'json' ? 'domcontentloaded' : 'networkidle',
      timeout: timeoutMs,
    });
    if (!response) {
      throw new Error('No browser response');
    }

    await page.waitForTimeout(Number(input.settleMs || 1200));

    const status = response.status();
    const contentType = response.headers()['content-type'] || '';
    const finalUrl = page.url();
    let text = await page.evaluate(() => document.body?.innerText || document.documentElement?.textContent || '');
    if (!text && expect === 'html') {
      text = await page.content();
    }
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
      text = text.slice(0, MAX_BODY_BYTES);
    }

    if (expect === 'json') {
      const parsed = JSON.parse(text);
      return {
        ok: status >= 200 && status < 400,
        status,
        contentType,
        finalUrl,
        elapsedMs: Date.now() - startedAt,
        body: parsed,
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
