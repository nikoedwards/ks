# Kicksonar — Session Context

Last updated: 2026-05-08 (tracking + scraping + project detail redesign)

## Project

**Kicksonar** — Kickstarter crowdfunding data analytics platform.
- Stack: Next.js 15 App Router, TypeScript, better-sqlite3, Tailwind CSS, Recharts
- Data source: webrobots.io Kickstarter Datasets (monthly CSV)
- Deployed: Railway (Dockerfile, volume at /app/data, env DATA_DIR=/app/data)
- GitHub: https://github.com/nikoedwards/ks
- Brand color: Kickstarter green #05CE78

## Architecture

- `/` → Landing page (no sidebar, Social Blade inspired, Kickstarter green hero)
- `/(app)/` → All dashboard pages (sidebar layout via route group)
- `/dashboard` → Current data overview (moved from former `/`)
- Auth: session-based (Node.js crypto + SQLite sessions table, httpOnly cookie `ks_session`)
- No extra npm packages needed for auth

## Completed features

- Landing page (`/`): Hero with Kickstarter green, platform stats, 3 feature cards, nav with auth state, footer
- Auth system: register + login + logout + me APIs; username+password, SHA-256 hash, 30-day sessions in SQLite
- LoginModal: center modal with tabs (Sign In / Create Account), used everywhere via AuthContext
- AuthContext (`src/contexts/AuthContext.tsx`): React context + provider; `showLogin(onSuccess?)` for gating
- Sidebar: Logo → `/` (landing); Favorites link (heart icon, red); user avatar / login button at bottom
- Favorites: `/favorites` page; heart button on projects list + detail; `/api/favorites` CRUD
- Login gates:
  - Projects: period buttons, filter dropdowns, sort headers, pagination all require login (first page free)
  - Analysis: period filter buttons require login
  - Predict: Analyze button requires login
- Dashboard: KPIs, pie chart, bar/line charts (at `/dashboard`)
- Project list: search, filter, paginated; login-gated filters; CSV export; row badges; heart button
- Analysis page: merged Categories + Trends + Countries with tab nav + unified time-range filter
- Project detail page at `/projects/[id]`: funding progress, stats, simulated curve, links, heart/save button
- About page at `/about`
- DataSource component: dynamic data range from /api/meta
- i18n (CN/EN): full-site with `auth`, `favorites`, `landing` namespaces added; default EN; EN switcher first
- /predict page: SSE streaming AI scoring + methodology section (4 cards)

## Tracking & scraping system

- **Polling frequency**: Normal projects every 4h, favorited/high-priority every 1h
- **On-demand scraping**: "Sync Now" button on detail page triggers immediate KS JSON fetch
- **Kicktraq import**: "Import from Kicktraq" button pulls historical daily data for old projects
- **Background scheduler**: `src/lib/tracker.ts` — singleton setInterval, starts 10s after server boot, checks every 5min which projects are due
- **Scraper**: `src/lib/scraper.ts` — KS `.json` endpoint + Kicktraq HTML parser (multiple regex patterns for chart data)
- **Comments**: count tracked in snapshots; text scraping toggle exists but HTML fetch not yet implemented (count from main JSON only)
- **Screenshots**: not yet implemented (Puppeteer deferred to later phase)

## Project detail page (Social Blade style)

- Dark hero header (gray-900) with stats bar + funding progress + tab nav
- **Tabs**: Overview | Funding Curve | Rewards | Text Changes | Similar Projects
- Overview: grade card + stats + timeline + daily snapshot table + tracking settings panel
- Funding Curve: AreaChart (pledged) + LineChart (backers/comments/updates), time range selector
- Rewards: per-tier cards with backer count + fill progress bar (limited tiers)
- Text Changes: diff view (strikethrough old, new below), grouped by field (name/blurb)
- Similar Projects: scored by category (40) + goal range (30) + backer count (20) + state (10)
- Track button: toggles tracking, shows pulse animation when active
- Sync Now button: immediate KS scrape
- Import Kicktraq button: pulls historical daily data

## Known issues / pending

- Old `/categories`, `/trends`, `/countries` routes remain as standalone pages (not in sidebar, but not deleted)
- Project links only work after RESYNC (old data has category URLs in source_url)
- Comment text scraping not yet implemented (only count tracked)
- Screenshot capture not yet implemented (Puppeteer deferred)

## DB tables

- `projects` — main data (webrobots monthly)
- `sync_logs` — sync history
- `users` (id, username, email, password_hash, created_at)
- `sessions` (token, user_id, expires_at)
- `favorites` (user_id, project_id, created_at)
- `tracking_settings` (project_id PK, is_tracking, track_rewards, track_comments, analyze_comments, track_text_diff, priority 1/2, last_fetched, next_fetch)
- `project_snapshots` (project_id, captured_at, pledged_usd, backers_count, days_to_go, comments_count, updates_count, state, source ks/kicktraq)
- `reward_snapshots` (project_id, captured_at, reward_id, title, description, amount_usd, backers_count, limit_count, is_limited)
- `project_text_history` (project_id, captured_at, field, content) — only stores when content changes
- `project_comments` (project_id, comment_id, author, content, posted_at)

## Key files

- src/lib/scraper.ts — KS JSON + Kicktraq HTML scrapers; `scrapeAndStore()`, `scrapeKicktraq()`, `storeKicktraqDays()`
- src/lib/tracker.ts — singleton polling scheduler; `initTracker()` (idempotent, call from any API route)
- src/app/api/track/route.ts — GET list / POST start tracking
- src/app/api/track/[id]/route.ts — GET settings / PATCH update / DELETE stop / POST scrape now
- src/app/api/snapshots/[id]/route.ts — GET snapshots + rewards + text history
- src/app/api/kicktraq/[id]/route.ts — POST import Kicktraq historical data
- src/app/page.tsx — landing page
- src/app/(app)/layout.tsx — dashboard layout (sidebar)
- src/app/(app)/dashboard/page.tsx — data overview
- src/app/(app)/projects/page.tsx — project list with gates + heart
- src/app/(app)/projects/[id]/page.tsx — project detail with heart button
- src/app/(app)/analysis/page.tsx — merged analysis with gates
- src/app/(app)/predict/page.tsx — predict with login gate on analyze
- src/app/(app)/favorites/page.tsx — favorites list
- src/app/api/auth/{login,logout,register,me}/route.ts — auth endpoints
- src/app/api/favorites/route.ts + [id]/route.ts — favorites CRUD
- src/contexts/AuthContext.tsx — React auth context + AuthProvider
- src/components/LoginModal.tsx — login/register modal
- src/components/Sidebar.tsx — nav + avatar + favorites link
- src/lib/auth.ts — server-side auth: hash, session, favorites DB ops
- src/lib/db.ts — main DB with users/sessions/favorites tables
- src/lib/i18n.ts — translations incl. auth/favorites/landing namespaces
