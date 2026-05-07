# Kicksonar — Session Context

Last updated: 2026-05-07 (commit e17ce8d)

## Project

**Kicksonar** — Kickstarter crowdfunding data analytics platform.
- Stack: Next.js 15 App Router, TypeScript, better-sqlite3, Tailwind CSS, Recharts
- Data source: webrobots.io Kickstarter Datasets (monthly CSV)
- Deployed: Railway (Dockerfile, volume at /app/data, env DATA_DIR=/app/data)
- GitHub: https://github.com/nikoedwards/ks
- Brand color: Kickstarter green #05CE78

## Completed features

- Dashboard: KPIs, pie chart, bar/line charts
- Project list: search, filter by state/category/country/time period, paginated
- Category/Trend/Country analysis pages
- Project detail page at /projects/[id]: funding progress, stats, simulated curve, links
- About page at /about
- Sidebar: Kicksonar branding, sonar SVG logo, About + GitHub footer links
- DataSource component: dynamic date range from /api/meta
- sync.ts: parses urls.web.project from raw CSV for real project URLs
- /api/meta: returns earliestDate, latestDate, lastSyncDate
- /api/projects/[id]: single project by ID
- Bilingual README.md

## Known issues / pending

- Project links (ExternalLink icon) only work after a RESYNC since old data has category URLs in source_url, not project URLs. After resync, source_url will contain the full https://www.kickstarter.com/projects/creator/slug URL.
- Project detail page shows a simulated funding curve (no real time-series data). Real daily data would require building a separate scraper beyond webrobots.io.
- The /about page is a static page (no 'use client' needed).

## Key files

- src/lib/db.ts — all DB queries, getMeta(), getProjectById()
- src/lib/sync.ts — CSV sync, parses urls.web.project for source_url
- src/app/projects/[id]/page.tsx — project detail page
- src/app/about/page.tsx — about page
- src/app/api/meta/route.ts — meta endpoint
- src/components/Sidebar.tsx — navigation with Kicksonar branding
- src/components/DataSource.tsx — dynamic data source footer
- public/logo.svg — sonar SVG logo
- public/favicon.svg — SVG favicon
