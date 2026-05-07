# Kicksonar — Session Context

Last updated: 2026-05-08 (post-analysis-merge session)

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
- **Analysis page** at /analysis: merged Categories + Trends + Countries into one page with tab navigation (Categories / Trends / Countries) and a unified time-range filter (All Time, per-year 2019–2025, Custom date range)
- Project detail page at /projects/[id]: funding progress, stats, simulated curve, links
- About page at /about
- Sidebar: Kicksonar branding, sonar SVG logo, About + GitHub footer links
- DataSource component: dynamic date range from /api/meta
- sync.ts: parses urls.web.project from raw CSV for real project URLs
- /api/meta: returns earliestDate, latestDate, lastSyncDate
- /api/projects/[id]: single project by ID
- Bilingual README.md (English primary) + README.zh-CN.md (Chinese)
- **i18n (CN/EN)**: full-site language switch via src/lib/i18n.ts + src/hooks/useLanguage.ts; all pages translated including project detail + analysis + predict methodology; inline pill switcher in Sidebar footer (EN first)
- **Default language**: EN (new users get English; localStorage persists preference)
- **Column sort**: click goal/pledged/funding rate/backers/launched headers to toggle ASC/DESC; arrow indicators; sortDir passed to db.ts
- **CSV export with cross-page checkbox selection**: per-row checkboxes, select-all on page, selections/data cached across pages via useRef<Map>, UTF-8 BOM for Excel
- **Row number badges**: gold (1-3), silver (4-10), plain gray (11+); checkbox column is leftmost
- **Table layout fix**: whitespace-nowrap on status cell fixes badge wrap bug; overflow-x-auto working
- **/predict page**: paste Kickstarter URL → SSE stream → 5 dimension AI scoring → final score + verdict; requires ANTHROPIC_API_KEY in .env.local; methodology section (4 cards: Signal Extraction, Blind Audit, Benchmark Calibration, Eagle-Eye Validation) shown on idle/error state
- **Sidebar active highlight fix**: sub-routes like /projects/[id] now correctly highlight parent nav item using `pathname.startsWith(href + '/')`

## Known issues / pending

- Project links (ExternalLink icon) only work after a RESYNC since old data has category URLs in source_url, not project URLs. After resync, source_url will contain the full https://www.kickstarter.com/projects/creator/slug URL.
- Project detail page shows a simulated funding curve (no real time-series data). Real daily data would require building a separate scraper beyond webrobots.io.
- The /about page is a static page (no 'use client' needed).
- Old /categories, /trends, /countries routes still exist as standalone pages (not removed, not linked from sidebar anymore). Can be deleted in a future cleanup.

## Key files

- src/lib/db.ts — all DB queries; getCategories/getTrends/getCountries now accept { dateFrom?, dateTo? }
- src/lib/sync.ts — CSV sync, parses urls.web.project for source_url
- src/lib/i18n.ts — full CN/EN translation dictionary (as const); includes analysis + predict.methodology namespaces
- src/hooks/useLanguage.ts — localStorage + CustomEvent language hook; default EN
- src/app/analysis/page.tsx — merged analysis page: period filter bar + tab navigation + all 3 analysis views
- src/app/predict/page.tsx — predict page with SSE streaming + methodology section
- src/app/projects/page.tsx — sort, checkboxes, CSV export, row badges, i18n
- src/app/projects/[id]/page.tsx — project detail page
- src/app/about/page.tsx — about page
- src/app/api/meta/route.ts — meta endpoint
- src/app/api/categories/route.ts — accepts dateFrom/dateTo query params
- src/app/api/trends/route.ts — accepts dateFrom/dateTo query params
- src/app/api/countries/route.ts — accepts dateFrom/dateTo query params
- src/components/Sidebar.tsx — navigation with Kicksonar branding + CN/EN switcher (EN first); Analysis link replaces 3 separate links; active highlight works for sub-routes
- src/components/DataSource.tsx — dynamic data source footer
- public/logo.svg — sonar SVG logo
- public/favicon.svg — SVG favicon
- README.md — English primary README with cross-link to zh-CN
- README.zh-CN.md — Chinese README with cross-link to English
