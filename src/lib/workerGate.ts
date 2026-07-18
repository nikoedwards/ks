// Central gate for ALL main-app → browser-worker traffic.
//
// The browser worker runs a single Chromium lane (BROWSER_MAX_CONCURRENCY=1 by
// design — headed Chrome + xvfb OOMs and Cloudflare clearance gets flaky above
// that). When several main-app passes (live discovery + tracker rich/core +
// collab/prelaunch) fire at the worker at once, its tiny internal queue fills
// and extra requests 503 with QUEUE_TIMEOUT — which the crawler records as
// "blocked". That is what wedged production for ~2 days.
//
// This module is the contingency/redundancy layer the platform was missing:
//
//   1. In-process priority semaphore — the main app never has more than
//      WORKER_MAX_INFLIGHT requests in flight, so it can't dogpile the worker's
//      queue. High-priority work (live discovery, on-demand user fetches)
//      preempts low-priority background passes for the next free slot, so
//      discovery can never be starved by the rich/core backfill again.
//
//   2. Worker fleet + health-aware failover — KICKSTARTER_BROWSER_FETCH_URL (or
//      KICKSTARTER_BROWSER_WORKER_URL) may now be a comma-separated LIST of
//      worker URLs. Calls route to the healthiest base; a base that errors or
//      503s is benched for a cooldown, so a dead/saturated worker is routed
//      around automatically instead of taking the whole pipeline down.
//
//   3. Circuit breaker — when the whole fleet looks unhealthy, low-priority
//      background passes shed themselves (see isFleetUnhealthy) so they stop
//      piling on while discovery keeps trying.

function envRaw(name: string): string {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const match = Object.entries(process.env).find(([key]) => key.trim() === name);
  return match?.[1]?.trim() ?? '';
}

function envNum(name: string, def: number, min: number, max: number): number {
  const raw = envRaw(name);
  // Number('') is 0, so an unset variable must be handled before conversion;
  // otherwise it silently becomes zero (or the minimum) instead of the default.
  if (!raw) return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(v, max));
}

// ── Priorities (lower number = served first) ──────────────────────────────────
export const WorkerPriority = {
  HIGH: 0,   // live discovery, on-demand user-triggered fetches
  NORMAL: 1, // cheap funding refresh (/core)
  LOW: 2,    // expensive background backfill (/project rich, /collab, prelaunch)
} as const;
export type WorkerPriorityValue = (typeof WorkerPriority)[keyof typeof WorkerPriority];

// ── Worker fleet + health ─────────────────────────────────────────────────────

function stripEndpoint(u: string): string {
  return u.replace(/\/(fetch|project|core|discover|collab)\/?$/i, '').replace(/\/+$/, '');
}

/** All configured worker base URLs (supports a comma-separated fleet). */
export function getWorkerBases(): string[] {
  const explicit = envRaw('KICKSTARTER_BROWSER_WORKER_URL');
  const raw = explicit || envRaw('KICKSTARTER_BROWSER_FETCH_URL');
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const base = stripEndpoint(part.trim());
    if (base && !seen.has(base)) { seen.add(base); out.push(base); }
  }
  return out;
}

interface BaseHealth { failures: number; openUntil: number; }
const health = new Map<string, BaseHealth>();

const BREAKER_FAILS = () => envNum('WORKER_BREAKER_FAILS', 3, 1, 50);
const BREAKER_COOLDOWN_MS = () => envNum('WORKER_BREAKER_COOLDOWN_MS', 60_000, 5_000, 600_000);

function healthOf(base: string): BaseHealth {
  let h = health.get(base);
  if (!h) { h = { failures: 0, openUntil: 0 }; health.set(base, h); }
  return h;
}

export function reportWorkerOutcome(base: string, ok: boolean): void {
  if (!base) return;
  const h = healthOf(base);
  if (ok) {
    h.failures = 0;
    h.openUntil = 0;
  } else {
    h.failures += 1;
    if (h.failures >= BREAKER_FAILS()) h.openUntil = Date.now() + BREAKER_COOLDOWN_MS();
  }
}

function isOpen(base: string, now: number): boolean {
  return healthOf(base).openUntil > now;
}

/**
 * The base URL to use right now. Prefers a base whose breaker is closed; if all
 * are tripped, returns the one that recovers soonest (least-bad) so we still
 * retry rather than give up. Returns null when nothing is configured.
 */
export function pickWorkerBase(): string | null {
  const bases = getWorkerBases();
  if (!bases.length) return null;
  const now = Date.now();
  const healthy = bases.filter(b => !isOpen(b, now));
  if (healthy.length) {
    // Spread load across healthy bases by fewest recent failures, then rotate.
    healthy.sort((a, b) => healthOf(a).failures - healthOf(b).failures);
    return healthy[0];
  }
  // Everything tripped → pick the one whose cooldown expires first.
  return [...bases].sort((a, b) => healthOf(a).openUntil - healthOf(b).openUntil)[0];
}

/** True when every configured worker base currently has its breaker open. */
export function isFleetUnhealthy(): boolean {
  const bases = getWorkerBases();
  if (!bases.length) return true;
  const now = Date.now();
  return bases.every(b => isOpen(b, now));
}

// ── In-process priority semaphore ─────────────────────────────────────────────

let inFlight = 0;
interface Waiter { priority: number; seq: number; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> | null; }
const waiters: Waiter[] = [];
let seqCounter = 0;

function maxInFlight(): number {
  // Default to the fleet size so adding a second worker lifts throughput, but
  // stay at 1 for a single worker (its lane is serial by design).
  const def = Math.max(1, getWorkerBases().length || 1);
  return envNum('WORKER_MAX_INFLIGHT', def, 1, 8);
}

function slotWaitMs(): number {
  return envNum('WORKER_SLOT_WAIT_MS', 240_000, 10_000, 600_000);
}

function acquire(priority: number): Promise<void> {
  if (inFlight < maxInFlight()) {
    inFlight += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { priority, seq: seqCounter++, resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const idx = waiters.indexOf(waiter);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error('worker slot wait timed out'));
    }, slotWaitMs());
    waiters.push(waiter);
    // Highest priority (lowest number) first; FIFO within a priority.
    waiters.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) {
    if (next.timer) clearTimeout(next.timer);
    next.resolve(); // hand the slot off without changing inFlight
  } else {
    inFlight = Math.max(0, inFlight - 1);
  }
}

/** Run `fn` once a worker slot is free, respecting priority. */
export async function withWorkerSlot<T>(priority: WorkerPriorityValue, fn: () => Promise<T>): Promise<T> {
  await acquire(priority);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Gated fetch to a worker base. Acquires a slot (priority-ordered), performs the
 * fetch, and updates the base's health (a thrown error or a 5xx counts against
 * it). Throws on network errors exactly like fetch(); returns the Response
 * otherwise so callers keep their existing body/JSON handling.
 */
export async function gatedWorkerFetch(
  base: string,
  endpoint: string,
  init: RequestInit,
  priority: WorkerPriorityValue = WorkerPriority.NORMAL,
): Promise<Response> {
  return withWorkerSlot(priority, async () => {
    try {
      const res = await fetch(`${base}${endpoint}`, init);
      // 503/5xx from the worker means "busy/unhealthy" → count against the base
      // so we route around it next time; 2xx/4xx are treated as reachable.
      reportWorkerOutcome(base, res.status < 500);
      return res;
    } catch (err) {
      reportWorkerOutcome(base, false);
      throw err;
    }
  });
}

// ── Cross-process load awareness (via the worker's cheap /health) ─────────────
//
// The in-process semaphore only coordinates ONE replica. On Railway the app runs
// multiple replicas (shared SQLite volume), so the tracker holder + on-demand
// user fetches on other replicas can still converge on the single worker lane.
// The worker's /health is the one place that sees global load (activeFetches +
// queuedFetches), so we poll it (briefly cached) to decide whether to shed
// low-priority background work. This is the cross-replica admission control.

interface FleetLoad {
  freeLane: boolean;
  active: number;
  queued: number;
  concurrency: number;
  graphqlCooldownMs: number;
  at: number;
}
const loadCache = new Map<string, FleetLoad>();
const LOAD_TTL_MS = () => envNum('WORKER_LOAD_TTL_MS', 8_000, 1_000, 60_000);
const BUSY_QUEUE_THRESHOLD = () => envNum('WORKER_BUSY_QUEUE_THRESHOLD', 1, 0, 20);

function authHeader(): Record<string, string> {
  const token = envRaw('BROWSER_WORKER_TOKEN');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function probeBaseLoad(base: string): Promise<FleetLoad | null> {
  const cached = loadCache.get(base);
  const now = Date.now();
  if (cached && now - cached.at < LOAD_TTL_MS()) return cached;
  try {
    const res = await fetch(`${base}/health`, {
      headers: { Accept: 'application/json', ...authHeader() },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const active = Number(body?.activeFetches ?? 0) || 0;
    const queued = Number(body?.queuedFetches ?? 0) || 0;
    const concurrency = Math.max(1, Number(body?.maxConcurrency ?? 1) || 1);
    const graphqlCooldownMs = Math.max(0, Number(body?.graphqlCooldownMs ?? 0) || 0);
    // A lane is free for new low-priority work only if it isn't already at
    // capacity, its queue is below the busy threshold, and Kickstarter's rich
    // GraphQL endpoint is not in a shared 429 cooldown.
    const freeLane = active < concurrency
      && queued < BUSY_QUEUE_THRESHOLD()
      && graphqlCooldownMs <= 0;
    const load: FleetLoad = { active, queued, concurrency, graphqlCooldownMs, freeLane, at: now };
    loadCache.set(base, load);
    return load;
  } catch {
    return null;
  }
}

/**
 * True when at least one healthy worker base has a free lane (so it's safe to
 * dispatch low-priority background work). When /health can't be read we return
 * true (optimistic) and let the breaker catch real failures, so a flaky /health
 * never silently halts the pipeline.
 */
export async function fleetHasFreeLane(): Promise<boolean> {
  const bases = getWorkerBases();
  if (!bases.length) return false;
  const now = Date.now();
  const healthy = bases.filter(b => !isOpen(b, now));
  if (!healthy.length) return false;
  const loads = await Promise.all(healthy.map(probeBaseLoad));
  let sawLoad = false;
  for (const l of loads) {
    if (!l) continue;
    sawLoad = true;
    if (l.freeLane) return true;
  }
  // No readable /health at all → optimistic; some readable but all busy → shed.
  return !sawLoad;
}

/** Lightweight snapshot for diagnostics / admin surfaces. */
export function workerGateStatus() {
  const now = Date.now();
  return {
    inFlight,
    queued: waiters.length,
    maxInFlight: maxInFlight(),
    bases: getWorkerBases().map(b => {
      const h = healthOf(b);
      return { base: b, failures: h.failures, breakerOpen: h.openUntil > now, openForMs: Math.max(0, h.openUntil - now) };
    }),
  };
}
