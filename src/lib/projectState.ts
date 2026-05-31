// Canonical Kickstarter project states. The first five are the analytics-facing
// states used by charts, filters and the live CTE. `prelaunch` is a sixth
// stored state for campaigns that exist but haven't launched yet (KS GraphQL
// STARTED/SUBMITTED/DRAFT): it deliberately is NOT 'live' so prelaunch pages
// stay out of the live set and scrape queues. They re-promote to 'live'
// automatically when KS live discovery sees them after launch.
export const CANONICAL_STATES = ['live', 'successful', 'failed', 'canceled', 'suspended'] as const;
export const PRELAUNCH_STATE = 'prelaunch' as const;
export type ProjectState = typeof CANONICAL_STATES[number] | typeof PRELAUNCH_STATE;

const CANONICAL_SET = new Set<string>([...CANONICAL_STATES, PRELAUNCH_STATE]);

// Raw KS labels (and synonyms) that mean "created but not launched yet".
const PRELAUNCH_RAW = new Set(['prelaunch', 'pre-launch', 'started', 'submitted', 'draft', 'preview', 'registration']);

/** True when a raw KS state means the campaign hasn't launched yet. */
export function isPrelaunchRaw(raw: unknown): boolean {
  return PRELAUNCH_RAW.has(String(raw ?? '').trim().toLowerCase());
}

/**
 * Map a raw state string to a canonical state, or null when it is not a known
 * state (e.g. unknown, historical, ''). Case-insensitive; folds common synonyms
 * (funded → successful) and prelaunch labels (started/submitted → prelaunch).
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
    case 'prelaunch':
    case 'pre-launch':
    case 'started':
    case 'submitted':
    case 'draft':
    case 'preview':
    case 'registration':
      return PRELAUNCH_STATE;
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
