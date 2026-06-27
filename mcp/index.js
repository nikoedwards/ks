#!/usr/bin/env node
// Kicksonar MCP server.
//
// Bridges your own LLM (Claude / Cursor / ChatGPT) to the Kicksonar crowdfunding
// dataset. Every tool call hits the same read-only REST API the website uses,
// authenticated with your personal API key (Authorization: Bearer). The key
// carries the per-user rate limit + per-key daily quota enforced server-side, so
// nothing here can exceed what your account is allowed to pull.
//
// Configure via environment variables:
//   KS_API_KEY   (required)  your "ks_…" key from Settings → API / MCP Access
//   KS_BASE_URL  (optional)  site origin, e.g. https://your-domain  (default below)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_KEY = process.env.KS_API_KEY;
const BASE_URL = (process.env.KS_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

if (!API_KEY) {
  console.error('[ks-mcp] Missing KS_API_KEY. Generate one at Settings → API / MCP Access.');
  process.exit(1);
}

/**
 * GET a JSON endpoint with the API key attached. Returns parsed JSON or throws
 * a readable error (so the model sees a useful message instead of a stack).
 */
async function apiGet(path, query = {}) {
  const url = new URL(BASE_URL + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' } });
  } catch (e) {
    throw new Error(`Network error reaching ${url.origin}: ${e?.message || e}`);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('Unauthorized: invalid or revoked API key (check KS_API_KEY).');
    if (res.status === 429) throw new Error(`Rate limited / daily quota exceeded: ${text}`);
    throw new Error(`HTTP ${res.status} from ${path}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err) {
  return { content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }], isError: true };
}

const server = new McpServer({ name: 'kicksonar', version: '0.1.0' });

const platformEnum = z.enum(['kickstarter', 'indiegogo', 'global']).optional()
  .describe('Which dataset to query. Defaults to kickstarter.');

server.tool(
  'search_projects',
  'Search and filter crowdfunding campaigns (Kickstarter / Indiegogo). Supports category, country, state, free-text search, sorting and pagination. Returns up to 100 rows per call.',
  {
    platform: platformEnum,
    search: z.string().optional().describe('Free-text query over project name/blurb.'),
    state: z.string().optional().describe('Campaign state, e.g. live, successful, failed.'),
    category: z.string().optional().describe('Category filter (raw category for a single platform, or unified parent in global mode).'),
    country: z.string().optional().describe('Two-letter country code, Kickstarter only.'),
    sort: z.enum(['usd_pledged', 'backers', 'goal', 'launched', 'funding_rate']).optional().describe('Sort key. Default usd_pledged.'),
    sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction. Default desc.'),
    page: z.number().int().positive().optional().describe('1-based page number.'),
    limit: z.number().int().positive().max(100).optional().describe('Rows per page (max 100).'),
    dateFrom: z.number().int().optional().describe('Unix seconds: only campaigns launched on/after.'),
    dateTo: z.number().int().optional().describe('Unix seconds: only campaigns launched on/before.'),
  },
  async (args) => {
    try {
      return jsonResult(await apiGet('/api/projects', args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  'get_project',
  'Get full detail for a single project by id, including a list of similar projects.',
  {
    id: z.string().describe('Project id (Kickstarter id, or an Indiegogo id like "igg_…").'),
  },
  async ({ id }) => {
    try {
      return jsonResult(await apiGet(`/api/projects/${encodeURIComponent(id)}`));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  'get_trends',
  'Monthly crowdfunding trend series (launches, success rate, pledged) over time.',
  {
    platform: platformEnum,
    dateFrom: z.number().int().optional().describe('Unix seconds lower bound.'),
    dateTo: z.number().int().optional().describe('Unix seconds upper bound.'),
  },
  async (args) => {
    try {
      return jsonResult(await apiGet('/api/trends', args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  'get_leaderboard',
  'Top projects, creators and agencies ranked by pledged amount and backers, with summary totals.',
  {
    platform: platformEnum,
    categoryParent: z.string().optional().describe('Parent category filter (or unified parent in global mode).'),
    categoryName: z.string().optional().describe('Sub-category name filter (Kickstarter).'),
    limit: z.number().int().positive().max(100).optional().describe('Number of ranked rows. Default 25.'),
    dateFrom: z.number().int().optional().describe('Unix seconds lower bound.'),
    dateTo: z.number().int().optional().describe('Unix seconds upper bound.'),
  },
  async (args) => {
    try {
      return jsonResult(await apiGet('/api/leaderboard', args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

server.tool(
  'get_stats',
  'Aggregate dataset statistics: totals, success rate, state distribution and live summary.',
  {
    platform: platformEnum,
    dateFrom: z.number().int().optional().describe('Unix seconds lower bound.'),
    dateTo: z.number().int().optional().describe('Unix seconds upper bound.'),
  },
  async (args) => {
    try {
      return jsonResult(await apiGet('/api/stats', args));
    } catch (e) {
      return errorResult(e);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[ks-mcp] connected. base=${BASE_URL}`);
