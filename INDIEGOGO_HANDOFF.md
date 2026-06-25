# Indiegogo 抓取架构 — 交接 / 下一步

> 用于换电脑后继续。先 `git pull`，再按下面顺序推进。当前代码已通过 `npx tsc --noEmit`，worker 本地冒烟已验证（/health cleared、/search 返回 total 10000）。

## 已经做完的（本轮）

- **过盾 worker** `indiegogo-probe/worker.mjs`：`puppeteer-real-browser` 常驻过盾会话，暴露 `POST /search` + `GET /health`，单串行车道、自动重过盾、`live`/`bulk` 双角色。
- **worker 客户端** `src/lib/indiegogoWorker.ts`：与 KS fleet 隔离，健康/熔断 + 多节点轮询。
- **三条管线** `src/lib/indiegogo.ts`：
  - `discoverIndiegogoIncremental()` 实时发现（live worker）
  - `trackIndiegogoLive()` 分级在筹 tracker（detail API，对齐 KS markFetched 分档）
  - `runIndiegogoBacklogSweep()` 存量递归切片（phase → 33 分类 → newest 兜底），断点表 `indiegogo_search_slices`，可暂停/续跑
- **调度** `src/instrumentation.ts`：discover 20m / track 30m 两个 cron，受 `INDIEGOGO_CRAWLER_ENABLED` + 进程锁约束。
- **API/UI**：`runPlatformAction` + actions 路由新增 `discover` / `track` / `backlog_sweep(start|pause|resume)`；`/data-quality` 面板按三管线重写，Webrobots 降级为遗留回灌。

## 下一步（按顺序）

### 1. 部署两个 worker 到 Railway
同一个 `indiegogo-probe/` 目录、Dockerfile 构建，起**两个**服务（角色隔离）：

```text
# 服务 A（实时发现，稳定优先）
INDIEGOGO_WORKER_ROLE=live
BROWSER_WORKER_TOKEN=<长随机串>

# 服务 B（存量扫描，可重启）
INDIEGOGO_WORKER_ROLE=bulk
BROWSER_WORKER_TOKEN=<同一个 token>
```

部署后冒烟：`curl https://<url>/health`、`curl -X POST https://<url>/search -H "Authorization: Bearer <token>" -d '{"pageIndex":1,"sortType":1}'`。

### 2. 主应用配置环境变量（Railway 主服务）

```text
INDIEGOGO_LIVE_WORKER_URL=https://<服务A-url>
INDIEGOGO_BULK_WORKER_URL=https://<服务B-url>
INDIEGOGO_WORKER_TOKEN=<同一个 token>   # 或复用 BROWSER_WORKER_TOKEN
INDIEGOGO_CRAWLER_ENABLED=1
```

### 3. 首轮验证（/data-quality → Indiegogo）
1. 若 DB 未建：点「初始化 Indiegogo 数据库」。
2. 点「立即发现一轮」→ 看 recentRuns 里 discover 是否 imported>0、worker 健康是否「已过盾」。
3. 点「立即跟踪一轮」→ 看详情/跟踪队列 ok 增长。
4. 点「运行存量一轮」→ 看存量切片进度（done/todo）；确认 phase 3/4 被自动展开成分类子切片。

### 4. 跑通后调参 / 收尾
- 存量节奏：`INDIEGOGO_BACKLOG_PAGE_BUDGET`（每轮页预算）、可加 cron 定时推进存量。
- 发现深度：`INDIEGOGO_DISCOVER_MAX_PAGES`。
- 抽样核对：挑一个分类档，对比 worker 返回 total 与库里该分类行数是否吻合。

## 待办 / 已知点
- [ ] 部署两个 worker + 配 env（步骤 1–2）
- [ ] 首轮三管线验证（步骤 3）
- [ ] 货币近似：搜索卡只有货币符号，`$`→USD 默认，detail API 会用 `currencyShortName` 校正；若发现非美元项目偏差，考虑发现阶段先不算 USD、等 detail 回填。
- [ ] 分类枚举 `INDIEGOGO_CATEGORIES` 是硬编码的 33 项（实测抓取得到）；IGG 若改动需更新。
- [ ] 单类目仍 >1 万时目前靠 trending+newest 兜底（非完全穷尽），如需更全可再加 tag 维度切片。
- [ ] 存量 cron 目前未挂（只有发现/tracker 两个 cron），存量靠手动触发或后续加定时。

## 关键文件
- `indiegogo-probe/worker.mjs`、`indiegogo-probe/README.md`
- `src/lib/indiegogoWorker.ts`
- `src/lib/indiegogo.ts`（discover / track / backlog sweep）
- `src/lib/platformDb.ts`（actions + `indiegogo_search_slices` 表 + quality 注入 worker/backlog）
- `src/instrumentation.ts`（cron）
- `src/app/(app)/data-quality/page.tsx`（`IndiegogoControlPanel`）
