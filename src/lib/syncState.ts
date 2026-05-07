export interface SyncState {
  status: 'idle' | 'running' | 'completed' | 'error';
  message: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  recordsImported: number;
  error: string | null;
  lastUrl: string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __ksSyncState: SyncState | undefined;
}

function ensureState(): SyncState {
  if (!globalThis.__ksSyncState) {
    globalThis.__ksSyncState = {
      status: 'idle',
      message: '',
      progress: 0,
      startedAt: null,
      completedAt: null,
      recordsImported: 0,
      error: null,
      lastUrl: null,
    };
  }
  return globalThis.__ksSyncState;
}

export function getSyncState(): SyncState {
  return { ...ensureState() };
}

export function updateSyncState(patch: Partial<SyncState>) {
  Object.assign(ensureState(), patch);
}
