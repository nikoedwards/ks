# KS Live Recovery — Progress Notes

> Snapshot taken 2026-05-29. Captures the diagnostic journey, every commit
> shipped during this session, current production state, and the
> outstanding follow-ups so this can be resumed from another machine.

## 1. The problem we were solving

KS Live had been silently broken for days:

- `/api/sync/live` runs ended in error: *"Kickstarter blocked the discover
  endpoint and the browser worker fallback failed"*.
- The browser-worker fallback was returning HTTP 500 (chromium launch
  errors) or eventually `fetch failed` (connection timeouts).
- `crawler_errors` was flooded with Cloudflare 403 / "Just a moment…"
  challenge pages.
- The end-user impact: zero new projects were entering the DB through
  KS Live, and individual project trackers were hammering the same
  blocked KS URLs every 15 minutes, accumulating thousands of failed
  attempts.

We confirmed empirically (curl from the user's residential IP through a
Singapore proxy *and* from Railway's IP) that **every** Kickstarter
endpoint — `/`, `/discover/advanced`, `/discover/advanced?format=json`,
`/robots.txt`, project HTML, project `.json` — returned
`Cf-Mitigated: challenge` headers. Cloudflare had clearly tightened bot
management.

Crucially, the user confirmed that **kickstarter.com loads instantly in
their real desktop Chrome** from the same network. So Cloudflare was
not IP-blocking us, it was fingerprinting the headless browser.

## 2. First-principles framing (per user request)

The user pushed back on previous patches and asked for a clean restart:

> 我们要做两个事情：
> 1. 从 Kickstarter 上获取最新的项目。
> 2. 怎么去把这些新项目爬取并入库。

That reframed the work into two independent goals:

1. **Discovery** — find newly-launched / currently-funding projects.
2. **Ingestion** — pull their full data into the DB.

Either goal can be served by either source (Kickstarter direct or
Kicktraq). The previous code mixed them, so when one source failed the
whole pipeline died. The fix below decouples them into a layered
orchestrator with graceful degradation.

## 3. Final architecture (after this session)

```
runKickstarterLiveSync (orchestrator)
   ├── runKicktraqActiveSync               ← primary, always runs, never CF-blocked
   │     ├── kicktraq.com/projects/        (multi-page list scrape)
   │     ├── parseProjectBlock              (Campaign Dates, funding, slugs)
   │     ├── filterProjects                  (drop empty/broken cards, accept ended)
   │     ├── inferProjectState               (live / successful / failed by deadline)
   │     ├── upsertProjects + insertSnapshot
   │     └── writes a `kicktraq_active:` sync_logs entry
   │
   └── runDirectKickstarterDiscover         ← optional enrich, gated by env
         (only if LIVE_DISCOVERY_KS_DIRECT=1)
         ├── fetchDiscoverViaBrowser
         │     POST → browser-worker /fetch (stealth chromium)
         │       └── playwright-extra + puppeteer-extra-plugin-stealth
         │             ├── 16 evasions (webdriver, chrome.runtime, webgl, …)
         │             ├── --headless=new launch args
         │             ├── --use-gl=swiftshader (real WebGL renderer)
         │             ├── waitForChallengeResolution: poll URL every 500ms
         │             │     up to BROWSER_CHALLENGE_WAIT_MS (default 45s)
         │             ├── post-clearance retry: re-issue API request once
         │             │     cf_clearance cookie is in the jar
         │             └── browser recycled every 60 requests (EAGAIN guard)
         └── writes a `ks_live:` sync_logs entry with full project data
              (image URLs, numeric IDs, comments_count, rewards, etc.)

tracker.scrapeDueProjects
   ├── getDueProjects (now selects consecutive_failures)
   ├── scrapeAndStore (per project)
   │     └── if SKIP_KS_DIRECT_SCRAPE=1 → goes straight to kicktraq summary
   ├── on success → markFetched resets consecutive_failures + sets normal interval
   └── on failure → recordScrapeFailure applies exponential backoff
         (30m → 2h → 6h → 24h, capped)
```

## 4. Diagnostic milestones

| Step | Finding |
|---|---|
| Verified worker `/diag` | chromium 148.0.7778.96 launches fine, but every KS URL returns 403 + `Cf-Mitigated: challenge` |
| Tested from user's IP | Same 403 → confirmed not an IP-block, it's bot fingerprinting |
| Tested kicktraq.com | Returns 200, parseable HTML — kicktraq is **not** CF-blocked |
| Re-read `runKicktraqActiveSync` | Already exists, already runs every cycle. Why was it returning 0 imports? |
| Fetched `kicktraq.com/projects/` page 1 | All 15 cards say *"time left: 0 days, 0 hours, 0 minutes (closing/closed)"*. Kicktraq's list page changed — now shows recently-ended projects, not currently-live ones |
| Traced filterProjects | `onlyCurrentlyLive=true` rejected every project with `deadline < now` → 0 imports |
| Added stealth playwright | First test: still 403, but with stealth enabled |
| Added `--headless=new` + smart wait | CF challenge **cleared**, but main service aborted at 60s |
| Bumped main→worker timeout to 180s | End-to-end discover JSON came back: HTTP 200, 12 sort=newest live projects |
| Left running overnight | Worker died with `spawn chromium EAGAIN` — kernel ran out of PIDs |
| Added 60-req browser recycle | Worker recovered, `lastLaunchError: null`, CF challenge through again |

## 5. Commits shipped this session

In order:

| Commit | Subject | What it does |
|---|---|---|
| `099b71e` | Diagnose browser-worker chromium launch failures | Adds /diag endpoint, launchHistory, structured launch errors |
| `d5b4d24` | Trace browser-worker /fetch requests step by step | Per-request step recorder, `/requests` endpoint for forensic |
| `a05e201` | Backoff individual project scrapes on consecutive failures | `tracking_settings.consecutive_failures` + exp backoff in `recordScrapeFailure` |
| `4e2948a` | Route KS Live through Kicktraq as the primary source | Refactors `runKickstarterLiveSync` into orchestrator; KS direct becomes opt-in via `LIVE_DISCOVERY_KS_DIRECT=1` |
| `30175b8` | Add `SKIP_KS_DIRECT_SCRAPE` env to short-circuit blocked paths | Tracker bypasses CF-blocked KS JSON/HTML when flag set |
| `312ba4b` | Fix kicktraqActive importing 0 projects | Drops the `onlyCurrentlyLive` deadline filter, computes per-project `state` from deadline + funding, drops placeholder cards. **0 → 73 imports per cycle** |
| `f2f443b` | browser-worker: integrate playwright-extra + stealth plugin | Adds `playwright-extra ^4.3.6` + `puppeteer-extra-plugin-stealth ^2.11.2`. 16 evasions active. Removes hard-coded Chrome/125 UA (lets stealth's user-agent-override handle it). `/diag` reports `stealth` block |
| `63d3f2b` | browser-worker: `--headless=new`, smarter challenge wait, post-clearance retry | New Chrome headless mode + `--use-gl=swiftshader`. `waitForChallengeResolution` polls URL change every 500ms up to 45s instead of fixed sleep. After challenge clears, re-issues original API request via the same context (now has cf_clearance). `BROWSER_HEADLESS_MODE` and `BROWSER_CHALLENGE_WAIT_MS` env knobs added |
| `1eff291` | Bump main→worker timeout for CF challenge headroom | `KICKSTARTER_BROWSER_TIMEOUT_MS` default 60s → 180s in `kickstarterLive.ts` and `scraper.ts` (per-project HTML fallback). Explicit `timeoutMs` + `settleMs` passed in body so worker's own budget matches outer abort |
| `31e13ef` | browser-worker: recycle chromium after N requests to avoid EAGAIN | `BROWSER_RECYCLE_AFTER_REQUESTS` (default 60). Closes browser singleton after the threshold; next /fetch relaunches. Wraps per-request `context.close()` in `.catch(() => {})` |

All pushed to `main` on `nikoedwards/ks`.

## 6. Production env vars (set on Railway)

Already configured by the user:

- `LIVE_DISCOVERY_KS_DIRECT=1` — enables the direct enrich step in the orchestrator
- `KICKSTARTER_BROWSER_FETCH_URL=https://inspiring-balance-production-511e.up.railway.app/fetch`
- `BROWSER_WORKER_TOKEN=ks_browser_8f9c2a7d4e6b91f3a0c5d8e2b7f4a9c6`

New knobs available (all have safe defaults, only set if tuning needed):

- `BROWSER_STEALTH_ENABLED` — default `1`, set `0` to disable stealth
- `BROWSER_STEALTH_DISABLE_EVASIONS=name1,name2` — disable specific evasions
- `BROWSER_HEADLESS_MODE` — default `new`, alternative `old` (legacy) or `false` (headed, needs xvfb)
- `BROWSER_CHALLENGE_WAIT_MS` — default `45000`, capped at `120000`
- `BROWSER_RECYCLE_AFTER_REQUESTS` — default `60`
- `KICKSTARTER_BROWSER_TIMEOUT_MS` — default `180000`, capped at `300000`
- `SKIP_KS_DIRECT_SCRAPE` — set `1` to keep tracker on kicktraq summary (now optional since stealth works)

## 7. Verification snapshot (last known-good run)

### Worker direct, cold cache, post-recycle (2026-05-28 ~23:25 UTC+8)

```
POST /fetch  → https://kickstarter.com/discover/advanced?sort=newest&page=1&format=json&state=live
HTTP 200 | 76s | 79036 bytes
projects parsed: 12
first: 62708933 | Wicked Night - Holy Knights | state=live | deadline=2026-06-27
```

### Orchestrator via /api/sync/live (2026-05-28 ~16:09 UTC+8, before timeout bump)

```
HTTP 200
discovered: 29 | insertedOrUpdated: 29 | snapshots: 29 | pages: 2
stoppedReason: no_more_projects
detail: "kicktraq imported 29, snapshots 29, pages 2 | direct=blocked: ... timeout"
```

→ kicktraq leg passing; direct enrich was timing out at 60s (fixed in `1eff291`,
not yet re-verified end-to-end through `/api/sync/live` after the timeout bump).

### sync_logs trend

- Before kicktraq fix: `kicktraq_active` rows all `records_imported=0`
- After `312ba4b`: 73 imports per cycle steady
- After `4e2948a` orchestrator with `LIVE_DISCOVERY_KS_DIRECT=1`: 29-73 kicktraq imports per cycle + `ks_live:` rows (initially errored, see follow-up)
- After `31e13ef` recycle: worker `/health` shows `browserConnected: true`, `lastLaunchError: null`

## 8. Outstanding follow-ups (for next session)

### Must do
- [ ] **Verify a tracker-fired `ks_live:` sync_logs entry completes with `status='completed'`** after `1eff291` (timeout fix) deployed. As of this snapshot, the most recent two `ks_live:` rows (`2134`, `2135`) errored because they fired before the timeout fix landed, then `EAGAIN` hit, then we recycled. Next tracker tick should produce a clean success.

### Should do
- [ ] Trigger an explicit `POST /api/sync/live { wait: true, maxPages: 2 }` and confirm `result.message` contains `direct=no_more_projects:` (not `direct=blocked:`). Took 480s budget in our test runs — make sure curl timeout matches.
- [ ] Inspect `crawler_errors` after a successful end-to-end run — should show very few CF-related rows from the last hour.
- [ ] Check that newly-imported projects via the direct path have richer fields (image `photo`, numeric `id`, `comments_count`) compared to kicktraq-only rows.

### Nice to have
- [ ] Add a Kicktraq `/hotlist/` parser as a complementary discovery source. The list page has a different layout (`<div class="listentry parent">`) and exposed 49 actually-funding projects with explicit "9 hours to go" countdowns when we tested. Useful for catching newly-launched projects that aren't yet on KS Discover sort=newest page 1.
- [ ] Consider persisting `storageState` to a Railway volume or S3 — currently it lives on `/tmp` which resets on container restart. We lose cf_clearance every redeploy and pay the 45-75s challenge tax again on the first call.
- [ ] Add a small wrapper around `chromium.launch` that detects the EAGAIN error code specifically and triggers an immediate recycle attempt instead of bubbling 500.
- [ ] The two stale `consecutive_failures` counters on `tracking_settings` (from before exp backoff was in place) are now wedged into the 24h backoff bucket. After the next successful tracker cycle, `markFetched` will reset them via the change in `a05e201`, but no harm in running a one-off `UPDATE tracking_settings SET consecutive_failures = 0, last_failure_at = NULL` to unblock them sooner.

## 9. Files changed at a glance

```
browser-worker/package.json   +2 deps (playwright-extra, puppeteer-extra-plugin-stealth)
browser-worker/server.js      ~+180 lines (stealth, headless=new, challenge wait, recycle, /diag stealth section)
src/lib/kickstarterLive.ts    orchestrator refactor + timeout bump
src/lib/scraper.ts            SKIP_KS_DIRECT_SCRAPE shortcut + timeout bump
src/lib/kicktraqActive.ts     filter + state inference
src/lib/tracker.ts            recordScrapeFailure integration
src/lib/db.ts                 +consecutive_failures, +last_failure_at, +recordScrapeFailure
src/app/api/sync/browser-test/route.ts   timeoutMs bumped 100s → 150s
```

## 10. How to resume

```bash
git pull
git log --oneline 099b71e..HEAD          # see the 10 fix commits in context
cat docs/ks-live-recovery.md             # this file
curl -s https://ks-production-fba1.up.railway.app/api/sync/status | jq '.history[] | select(.url|startswith("ks_live:"))'
curl -s -H "Authorization: Bearer $TOKEN" https://inspiring-balance-production-511e.up.railway.app/diag?skipLaunch=1 | jq .stealth
```

If `ks_live:` rows are still erroring, the most likely next suspects are:

1. Worker hit EAGAIN again before recycle threshold (lower
   `BROWSER_RECYCLE_AFTER_REQUESTS` to 30).
2. CF tightened further and 45s challenge wait isn't enough (bump
   `BROWSER_CHALLENGE_WAIT_MS` to 90000).
3. Railway container memory limit; check `/health` for
   `browserConnected: false` + `lastLaunchError`.
