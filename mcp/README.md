# ks-mcp — Kicksonar MCP server

Connect the full Kicksonar crowdfunding dataset (Kickstarter + Indiegogo) to **your own LLM** — Claude Desktop, Cursor, ChatGPT, or any MCP-capable client. Your model can then search, rank, and analyze the data in natural language. Authentication uses a personal API key, so only registered users can access the data, and every call is subject to the same rate limits as the website plus a per-key daily quota.

## 1. Get an API key

1. Sign in to the website.
2. Open **Settings → API / MCP Access** (key icon in the sidebar).
3. Click **Generate**, give it a name, and copy the `ks_…` key. The plaintext is shown **only once** — store it safely. You can revoke a key at any time from the same page.

## 2. Configure your AI client

Add this to your MCP config (the Settings page shows a ready-to-copy snippet pre-filled with your key):

```json
{
  "mcpServers": {
    "kicksonar": {
      "command": "npx",
      "args": ["-y", "ks-mcp"],
      "env": {
        "KS_API_KEY": "ks_your_key_here",
        "KS_BASE_URL": "https://your-domain"
      }
    }
  }
}
```

- **Cursor**: Settings → MCP → add the server (or edit `~/.cursor/mcp.json`).
- **Claude Desktop**: edit `claude_desktop_config.json` and restart the app.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `KS_API_KEY` | yes | Your `ks_…` personal key. |
| `KS_BASE_URL` | no | Site origin, e.g. `https://your-domain`. Defaults to `http://localhost:3000` for local dev. |

## 3. Run locally (optional)

From this folder:

```bash
npm install
KS_API_KEY=ks_xxx KS_BASE_URL=https://your-domain npm start
```

Requires Node.js 18+ (uses the built-in `fetch`).

## Available tools

All tools are **read-only**.

| Tool | What it does | Backed by |
| --- | --- | --- |
| `search_projects` | Search/filter campaigns by platform, category, country, state, text, sort, pagination (≤100 rows/call) | `GET /api/projects` |
| `get_project` | Full detail for one project id, plus similar projects | `GET /api/projects/{id}` |
| `get_trends` | Monthly trend series (launches, success rate, pledged) | `GET /api/trends` |
| `get_leaderboard` | Top projects/creators/agencies + summary totals | `GET /api/leaderboard` |
| `get_stats` | Aggregate totals, success rate, state distribution, live summary | `GET /api/stats` |

`platform` accepts `kickstarter` (default), `indiegogo`, or `global`.

## Quotas & limits

- **Rate limits**: per-user per-minute / per-hour limits identical to the website.
- **Daily quota**: each API key has a per-day request cap (server env `API_KEY_DAILY_CAP`, default 2000) to prevent bulk export of the entire dataset. It resets at 00:00 UTC.
- Exceeding either returns HTTP `429`; the tool surfaces a clear message and a `Retry-After` hint.

## Security notes

- Only the SHA-256 hash of a key is stored server-side; the plaintext is shown once at creation.
- Revoke a key any time from **Settings → API / MCP Access**; revoked keys are rejected immediately.
- Only read-only data endpoints are exposed. Sync/admin/write operations are never accessible via an API key.
