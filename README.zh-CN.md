# Kicksonar — Kickstarter 众筹数据分析平台

[English](README.md) | **[中文]**

> 如同声呐探测水下目标，Kicksonar 从 Kickstarter 历史数据中发现众筹市场的规律与机会。

---

## 功能特性

| 页面 | 功能描述 |
|------|----------|
| **数据概览** | 全平台 KPI 统计、项目状态分布、类目与趋势图表 |
| **项目列表** | 搜索与筛选 20 万+ 项目，支持关键词、状态、类目、国家、时间段过滤；按融资额/支持人数/完成率排序；跨页勾选 CSV 导出 |
| **数据分析** | 类目、月度趋势、国家三维度深度分析，统一时间范围筛选 |
| **项目预测** | 粘贴 Kickstarter 预热页面链接 → AI 五维度打分 + 成功率预测 |
| **项目详情** | 单项目融资进度、关键指标、模拟融资曲线、直达 Kickstarter & Kicktraq |
| **数据同步** | 一键同步 webrobots.io 数据集；每月自动同步 |

---

## 技术栈

- **Next.js 15** — App Router、Server Components、API Routes
- **TypeScript** — 严格模式
- **better-sqlite3** — 同步磁盘 SQLite（无需外部数据库）
- **Tailwind CSS** — Kickstarter 绿色主题（#05CE78）
- **Recharts** — 柱状图、折线图、饼图
- **Railway** — Docker 部署 + 持久化数据卷
- **Claude API** — 项目预测 AI 评分（`claude-sonnet-4-6`）

---

## 数据来源

数据来自 [webrobots.io Kickstarter Datasets](https://webrobots.io/kickstarter-datasets/)，每月自动更新，覆盖 2009 年至今 Kickstarter 平台全量公开项目。

> Kicksonar 与 Kickstarter 及 webrobots.io 无隶属关系，数据仅用于教育与研究目的。

---

## 本地开发

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`，前往 **数据同步** 页面触发首次同步（约 400MB 下载，需数分钟）。

**可选——项目预测功能：**

在 `.env.local` 中配置 Anthropic API Key：

```
ANTHROPIC_API_KEY=sk-ant-...
```

---

## 部署（Railway）

1. Fork 本仓库 → 连接 [Railway](https://railway.app)
2. 添加 **Volume**，挂载路径：`/app/data`
3. 配置环境变量：
   - `DATA_DIR=/app/data`
   - `ANTHROPIC_API_KEY=sk-ant-...` *（项目预测功能）*
4. Railway 自动识别 `Dockerfile` 并构建

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATA_DIR` | `./data` | SQLite 数据库目录 |
| `PORT` | `3000` | HTTP 服务端口 |
| `ANTHROPIC_API_KEY` | — | Claude API Key（项目预测功能） |

---

## 联系方式

- Email：[nikoedwards75@gmail.com](mailto:nikoedwards75@gmail.com)
- GitHub：[github.com/nikoedwards/ks](https://github.com/nikoedwards/ks)

---

MIT License
