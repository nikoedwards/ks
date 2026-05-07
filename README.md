# Kicksonar — Kickstarter Crowdfunding Analytics

**[English]** | [中文](README.zh-CN.md)

> Like sonar that detects objects in the deep, Kicksonar surfaces patterns and opportunities hidden in Kickstarter's crowdfunding data.

---

## Features

| Page | Description |
|------|-------------|
| **Overview** | Platform-wide KPIs, status distribution, category and trend charts |
| **Projects** | Search & filter 200k+ campaigns by keyword, state, category, country, date; sort by funding / backers / rate; cross-page CSV export |
| **Analysis** | Deep-dive by category, monthly trend, or country — with unified date-range filter |
| **Predict** | Paste a Kickstarter pre-launch URL → AI-powered 5-dimension scoring and success prediction |
| **Project Detail** | Per-project funding progress, stats, simulated funding curve, links to Kickstarter & Kicktraq |
| **Data Sync** | One-click sync from webrobots.io dataset; monthly auto-sync |

---

## Tech Stack

- **Next.js 15** — App Router, Server Components, API Routes
- **TypeScript** — strict mode
- **better-sqlite3** — synchronous, disk-based SQLite (no external DB required)
- **Tailwind CSS** — Kickstarter-inspired green (#05CE78) theme
- **Recharts** — bar, line, and pie charts
- **Railway** — Docker-based deployment with persistent volume
- **Claude API** — AI scoring for the Predict feature (`claude-sonnet-4-6`)

---

## Data Source

Data sourced from [webrobots.io Kickstarter Datasets](https://webrobots.io/kickstarter-datasets/), updated monthly, covering all public Kickstarter campaigns from 2009 to present.

> Kicksonar is not affiliated with Kickstarter or webrobots.io. Data is used for educational and research purposes only.

---

## Local Development

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, then go to **Settings → Data Sync** to trigger the first sync (~400 MB download, takes a few minutes).

**Optional — Predict feature:**

Add your Anthropic API key to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## Deployment (Railway)

1. Fork this repo → connect to [Railway](https://railway.app)
2. Add a **Volume** mounted at `/app/data`
3. Set env vars:
   - `DATA_DIR=/app/data`
   - `ANTHROPIC_API_KEY=sk-ant-...` *(for Predict feature)*
4. Railway auto-detects the `Dockerfile` and builds

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | SQLite database directory |
| `PORT` | `3000` | HTTP server port |
| `ANTHROPIC_API_KEY` | — | Claude API key (Predict feature) |

---

## Contact

- Email: [nikoedwards75@gmail.com](mailto:nikoedwards75@gmail.com)
- GitHub: [github.com/nikoedwards/ks](https://github.com/nikoedwards/ks)

---

MIT License
