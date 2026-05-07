# Kicksonar

**Kickstarter 众筹数据分析平台 | Kickstarter Crowdfunding Analytics Platform**

> Like sonar that detects objects in the deep, Kicksonar surfaces patterns and opportunities hidden in Kickstarter's crowdfunding data.
>
> 如同声呐探测水下目标，Kicksonar 从 Kickstarter 历史数据中发现众筹市场的规律与机会。

---

## 功能 / Features

| 页面 | Features |
|------|----------|
| 数据概览 | Dashboard with platform-wide KPIs, state distribution, category & trend charts |
| 项目列表 | Search & filter 200k+ campaigns by keyword, state, category, country, time period |
| 类目分析 | Success rate, total funding, and project volume by category (Top 25) |
| 趋势分析 | 36-month monthly trends: launches, successes, success rate, pledged amount |
| 国家分析 | Country-level performance comparison (Top 20) |
| 项目详情 | Per-project metrics, funding progress, simulated funding curve, links to Kickstarter & Kicktraq |

---

## 技术栈 / Tech Stack

- **Next.js 15** — App Router, Server Components, API Routes
- **TypeScript** — strict mode
- **better-sqlite3** — synchronous, disk-based SQLite (no external DB required)
- **Tailwind CSS** — Kickstarter-inspired green (#05CE78) theme
- **Recharts** — bar, line, and pie charts
- **Railway** — Docker-based deployment with persistent volume

---

## 数据来源 / Data Source

数据来自 [webrobots.io Kickstarter Datasets](https://webrobots.io/kickstarter-datasets/)，每月自动更新，覆盖 Kickstarter 平台 2009 年至今全量公开项目。

Data sourced from [webrobots.io Kickstarter Datasets](https://webrobots.io/kickstarter-datasets/), updated monthly, covering all public Kickstarter campaigns since 2009.

> Kicksonar is not affiliated with Kickstarter or webrobots.io. Data is used for educational and research purposes only.

---

## 本地开发 / Local Development

```bash
# Install dependencies
npm install

# Start dev server (SQLite DB auto-created on first sync)
npm run dev

# Build for production
npm run build
npm start
```

访问 `http://localhost:3000`，然后前往 **数据同步** 页面触发首次数据同步（约 400MB 下载，需要几分钟）。

Visit `http://localhost:3000`, then go to **Settings → Data Sync** to trigger the first sync (~400 MB download, takes a few minutes).

---

## 部署 / Deployment (Railway)

1. Fork this repo → connect to [Railway](https://railway.app)
2. Add a **Volume** mounted at `/app/data`
3. Set env var: `DATA_DIR=/app/data`
4. Railway auto-detects the `Dockerfile` and builds

The app auto-syncs data on startup if the DB is empty.

---

## 环境变量 / Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `./data` | SQLite database directory path |
| `PORT` | `3000` | HTTP server port |

---

## 联系 / Contact

- Email: [nikoedwards75@gmail.com](mailto:nikoedwards75@gmail.com)
- GitHub: [github.com/nikoedwards/ks](https://github.com/nikoedwards/ks)

---

## License

MIT
