'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, Database, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

interface SyncState {
  status: 'idle' | 'running' | 'completed' | 'error';
  message: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  recordsImported: number;
  error: string | null;
  lastUrl: string | null;
}

interface SyncLog {
  id: number;
  url: string;
  started_at: string;
  completed_at: string;
  records_imported: number;
  status: string;
  error_message: string | null;
}

interface StatusData {
  syncState: SyncState;
  lastSync: SyncLog | null;
  history: SyncLog[];
  projectCount: number;
}

function fmtTime(iso: string | null, lang: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(lang === 'cn' ? 'zh-CN' : 'en-US');
}

function fmtDuration(start: string, end: string, lang: string) {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (lang === 'cn') return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function SettingsPage() {
  const [lang] = useLanguage();
  const tr = t[lang].settings;

  const [status, setStatus] = useState<StatusData | null>(null);
  const [syncing, setSyncing] = useState(false);

  const fetchStatus = useCallback(() => {
    fetch('/api/sync/status')
      .then(r => r.json())
      .then(d => {
        setStatus(d);
        if (d.syncState?.status === 'running') setSyncing(true);
        else setSyncing(false);
      })
      .catch(console.error);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [syncing, fetchStatus]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || tr.syncBtn);
        setSyncing(false);
      } else {
        fetchStatus();
      }
    } catch {
      setSyncing(false);
    }
  };

  const syncState = status?.syncState;
  const isRunning = syncState?.status === 'running';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      {/* Database Status */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Database className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold text-gray-800">{tr.dbStatus}</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500">{tr.projectCount}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {(status?.projectCount ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500">{tr.lastSync}</p>
            <p className="text-sm font-medium text-gray-700 mt-1">
              {fmtTime(status?.lastSync?.completed_at ?? null, lang)}
            </p>
          </div>
        </div>
      </div>

      {/* Sync Action */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-gray-800">{tr.manualSync}</h2>
          </div>
          <a
            href="https://webrobots.io/kickstarter-datasets/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
          >
            {tr.dataSource} <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <p className="text-sm text-gray-500 mb-4">{tr.syncDesc}</p>
        <p className="text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-2 mb-6">{tr.autoSync}</p>

        <button
          onClick={handleSync}
          disabled={isRunning}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            isRunning
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          {isRunning ? tr.syncing : tr.syncBtn}
        </button>

        {syncState && syncState.status !== 'idle' && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center gap-2">
              {syncState.status === 'running' && <Clock className="w-4 h-4 text-blue-500 animate-pulse" />}
              {syncState.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-500" />}
              {syncState.status === 'error' && <XCircle className="w-4 h-4 text-red-500" />}
              <span className="text-sm text-gray-700">{syncState.message}</span>
            </div>

            {syncState.status === 'running' && (
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${syncState.progress}%` }}
                />
              </div>
            )}

            {syncState.recordsImported > 0 && (
              <p className="text-xs text-gray-400">{tr.imported(syncState.recordsImported.toLocaleString())}</p>
            )}
          </div>
        )}
      </div>

      {/* Sync History */}
      {(status?.history?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h3 className="font-semibold text-gray-700">{tr.history}</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {status!.history.map(log => (
              <div key={log.id} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {log.status === 'completed'
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    <span className={`text-xs font-medium ${log.status === 'completed' ? 'text-green-600' : 'text-red-600'}`}>
                      {log.status === 'completed' ? tr.success : tr.failed}
                    </span>
                    <span className="text-xs text-gray-400">{fmtTime(log.started_at, lang)}</span>
                    {log.completed_at && (
                      <span className="text-xs text-gray-400">
                        {tr.duration(fmtDuration(log.started_at, log.completed_at, lang))}
                      </span>
                    )}
                  </div>
                  {log.records_imported > 0 && (
                    <p className="text-xs text-gray-500 mt-1 ml-5">{tr.records(log.records_imported.toLocaleString())}</p>
                  )}
                  {log.error_message && (
                    <p className="text-xs text-red-500 mt-1 ml-5 break-all">{log.error_message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="bg-blue-50 rounded-xl border border-blue-100 p-5">
        <h3 className="font-semibold text-blue-800 mb-2">{tr.infoTitle}</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          {tr.infoItems.map((item, i) => <li key={i}>{item}</li>)}
        </ul>
      </div>
    </div>
  );
}
