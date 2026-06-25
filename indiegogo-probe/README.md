# Indiegogo Enumeration Worker

Isolated Cloudflare-bypass worker that lets the Kicksonar main app enumerate
Indiegogo projects. It runs a headed Chrome (under Xvfb) via
[`puppeteer-real-browser`](https://www.npmjs.com/package/puppeteer-real-browser),
which auto-solves Cloudflare Turnstile and applies rebrowser anti-detection
patches. Once the search page is cleared, it runs in-page `fetch` calls against
Indiegogo's internal `searchProjectsForCards` API (reusing the cleared cookies)
and returns the raw paged project cards.

This service is intentionally separate from the main app: it shares no database
access or runtime code. The main app talks to it over HTTP only.

## Endpoints

- `GET /health` — liveness + load signals the main app's `workerGate` reads:
  `{ ok, role, cleared, activeFetches, queuedFetches, maxConcurrency }`.
- `POST /search` — run one enumeration query. Send `Authorization: Bearer <BROWSER_WORKER_TOKEN>` when a token is configured.

### `POST /search` body

All fields optional; defaults reproduce the public "all projects" search:

```json
{
  "pageIndex": 1,
  "sortType": 0,
  "projectPhaseSearchTypes": [],
  "projectCatalogCategories": [],
  "projectTags": [],
  "term": ""
}
```

Response:

```json
{
  "ok": true,
  "cleared": true,
  "pageIndex": 1,
  "total": 10000,
  "totalPages": 417,
  "pageSize": 24,
  "capped": true,
  "count": 24,
  "items": [ /* raw pagedItems cards: projectUrlName, backersCount, campaignGoal, ... */ ]
}
```

The single browser lane is serial by design (Turnstile clearance is flaky under
concurrency), so `maxConcurrency` is always 1.

## Railway Setup

Deploy **two** services from this directory (same image, different role) so live
discovery and the backlog sweep never share a browser lane:

```text
Root Directory: indiegogo-probe
Build: Dockerfile
```

Environment variables:

```text
BROWSER_WORKER_TOKEN=<generate-a-long-random-token>
INDIEGOGO_WORKER_ROLE=live   # or "bulk" on the second instance
INDIEGOGO_CLEAR_MS=90000
INDIEGOGO_CLEAR_TTL_MS=1200000
INDIEGOGO_SEARCH_TIMEOUT_MS=45000
```

Point the main app at them via `INDIEGOGO_LIVE_WORKER_URL` and
`INDIEGOGO_BULK_WORKER_URL` (comma-separated lists are supported for a fleet).

## Smoke test

```bash
curl https://<worker-url>/health
curl -X POST https://<worker-url>/search \
  -H "Authorization: Bearer <BROWSER_WORKER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"pageIndex":1,"sortType":1}'
```
