// Canonical Kickstarter project states. Everything stored in the DB must be one
// of these lowercase values so charts, filters and the live CTE stay consistent.
export const CANONICAL_STATES = ['live', 'successful', 'failed', 'canceled', 'suspended'] as const;
export type ProjectState = typeof CANONICAL_STATES[number];

const CANONICAL_SET = new Set<string>(CANONICAL_STATES);

/**
 * Map a raw state string to a canonical state, or null when it is not a known
 * terminal/live state (e.g. started, submitted, unknown, historical, draft, '').
 * Case-insensitive and folds common synonyms (funded → successful, etc).
 */
export function normalizeState(raw: unknown): ProjectState | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  switch (s) {
    case 'live':
      return 'live';
    case 'successful':
    case 'success':
    case 'funded':
      return 'successful';
    case 'failed':
    case 'unsuccessful':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'suspended':
      return 'suspended';
    default:
      return CANONICAL_SET.has(s) ? (s as ProjectState) : null;
  }
}

/** Derive a state from project numbers when the raw label is missing/ambiguous. */
export function inferState(opts: { deadline?: number | null; goal?: number | null; pledged?: number | null; now?: number }): ProjectState {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const deadline = opts.deadline ?? null;
  if (deadline && deadline > now) return 'live';
  const goal = Number(opts.goal ?? 0);
  const pledged = Number(opts.pledged ?? 0);
  if (goal > 0 && pledged >= goal) return 'successful';
  if (deadline && deadline <= now) return 'failed';
  // No deadline info at all — assume live; it self-corrects on the next scrape.
  return 'live';
}

/** Resolve a final canonical state: trust the raw label, else infer from data. */
export function resolveProjectState(opts: {
  raw?: unknown;
  deadline?: number | null;
  goal?: number | null;
  pledged?: number | null;
  now?: number;
}): ProjectState {
  const norm = normalizeState(opts.raw);
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  // A "live" label is only valid while the deadline is still ahead. Stale feeds
  // (monthly webrobots dumps, cached discover pages) routinely carry `live` for
  // campaigns that have already ended — trust the clock over the label so we
  // never store a project as live past its deadline. inferState then settles it
  // to successful/failed; a post-deadline scrape later confirms KS's truth.
  if (norm === 'live' && opts.deadline && opts.deadline <= now) {
    return inferState({ deadline: opts.deadline, goal: opts.goal, pledged: opts.pledged, now });
  }
  return norm ?? inferState(opts);
}
