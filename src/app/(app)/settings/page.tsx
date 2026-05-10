'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, Database, ExternalLink, Zap, Activity } from 'lucide-react';
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

type LiveState = 'live' | 'successful' | 'all';

interface LiveSyncResult {
  ok: boolean;
  result?: { discovered: number; insertedOrUpdated: number; snapshots: number; pages: number; stoppedReason: string; message?: string };
  error?: string;
}

interface KicktraqSyncResult {
  ok: boolean;
  result?: { pages: number; imported: number; snapshots: number; stoppedReason: string; message?: string };
  error?: string;
}

export default function SettingsPage() {
  const [lang] = useLanguage();
  const tr = t[lang].settings;

  // ── Webrobots state ──────────────────────────────────────────────────────────
  const [status, setStatus] = useState<StatusData | null>(null);
  const [syncing, setSyncing] = useState(false);

  // ── KS Live state ────────────────────────────────────────────────────────────
  const [livePages, setLivePages] = useState(10);
  const [liveState, setLiveState] = useState<LiveState>('live');
  const [liveSyncing, setLiveSyncing] = useState(false);
  const [liveResult, setLiveResult] = useState<LiveSyncResult | null>(null);

  // ── Kicktraq state ───────────────────────────────────────────────────────────
  const [ktPages, setKtPages] = useState(5);
  const [ktSyncing, setKtSyncing] = useState(false);
  const [ktResult, setKtResult] = useState<KicktraqSyncResult | null>(null);

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

  // ── Webrobots sync ───────────────────────────────────────────────────────────
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

  // ── KS Live sync ─────────────────────────────────────────────────────────────
  const handleLiveSync = async () => {
    setLiveSyncing(true);
    setLiveResult(null);
    try {
      const res = await fetch('/api/sync/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxPages: livePages,
          state: liveState,
          since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600, // last 7 days
          wait: true,
        }),
      });
      const data = await res.json() as LiveSyncResult;
      setLiveResult(data);
      fetchStatus(); // refresh project count
    } catch (e) {
      setLiveResult({ ok: false, error: String(e) });
    } finally {
      setLiveSyncing(false);
    }
  };

  // ── Kicktraq sync ────────────────────────────────────────────────────────────
  const handleKicktraqSync = async () => {
    setKtSyncing(true);
    setKtResult(null);
    try {
      const res = await fetch('/api/sync/kicktraq-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxPages: ktPages,
          onlyCurrentlyLive: true,
          wait: true,
        }),
      });
      const data = await res.json() as KicktraqSyncResult;
      setKtResult(data);
      fetchStatus();
    } catch (e) {
      setKtResult({ ok: false, error: String(e) });
    } finally {
      setKtSyncing(false);
    }
  };

  const syncState = status?.syncState;
  const isRunning = syncState?.status === 'running';

  const selectCls = 'border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ks-green bg-white';

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

      {/* ── Source 1: Webrobots ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-gray-800">{tr.manualSync}</h2>
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">webrobots.io</span>
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
        <p className="text-xs text-gray-400 mb-4">{lang === 'cn' ? '月度全量快照 · 覆盖 2016 年至今' : 'Monthly full snapshot · 2016 to present'}</p>

        <p className="text-sm text-gray-500 mb-3">{tr.syncDesc}</p>
        <p className="text-xs bg-amber-50 text-amber-700 rounded-lg px-3 py-2 mb-5">{tr.autoSync}</p>

        <button
          onClick={handleSync}
          disabled={isRunning || liveSyncing || ktSyncing}
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

      {/* ── Source 2: KS Live Discovery ─────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Zap className="w-5 h-5 text-ks-green" />
          <h2 className="font-semibold text-gray-800">{tr.liveSync}</h2>
          <span className="text-xs bg-ks-green-light text-ks-green-dark px-2 py-0.5 rounded-full font-medium">kickstarter.com</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">{lang === 'cn' ? '实时发现新项目 · 补充快照盲区' : 'Real-time new project discovery · fills snapshot gaps'}</p>

        <p className="text-sm text-gray-500 mb-3">{tr.liveSyncDesc}</p>
        <p className="text-xs bg-green-50 text-green-700 rounded-lg px-3 py-2 mb-5">{tr.liveSyncAuto}</p>

        <div className="flex flex-wrap items-end gap-4 mb-5">
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.liveSyncPages}</label>
            <select value={livePages} onChange={e => setLivePages(Number(e.target.value))} className={selectCls}>
              {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.liveSyncState}</label>
            <select value={liveState} onChange={e => setLiveState(e.target.value as LiveState)} className={selectCls}>
              <option value="live">{tr.liveSyncStateLive}</option>
              <option value="successful">{tr.liveSyncStateSuccessful}</option>
              <option value="all">{tr.liveSyncStateAll}</option>
            </select>
          </div>
        </div>

        <button
          onClick={handleLiveSync}
          disabled={liveSyncing || isRunning || ktSyncing}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            liveSyncing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-ks-green text-white hover:bg-ks-green-dark'
          }`}
        >
          <Zap className={`w-4 h-4 ${liveSyncing ? 'animate-pulse' : ''}`} />
          {liveSyncing ? tr.liveSyncing : tr.liveSyncBtn}
        </button>

        {liveResult && (
          <div className="mt-4 p-3 rounded-lg border text-sm space-y-1 ${liveResult.ok ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}">
            {liveResult.ok && liveResult.result ? (
              <>
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">{lang === 'cn' ? '抓取完成' : 'Fetch complete'}</span>
                </div>
                <div className="text-xs text-green-600 space-y-0.5 ml-6">
                  <div>{lang === 'cn' ? `发现: ${liveResult.result.discovered} 个项目` : `Discovered: ${liveResult.result.discovered} projects`}</div>
                  <div>{lang === 'cn' ? `入库: ${liveResult.result.insertedOrUpdated} 条` : `Upserted: ${liveResult.result.insertedOrUpdated} records`}</div>
                  <div>{lang === 'cn' ? `翻页: ${liveResult.result.pages} 页` : `Pages: ${liveResult.result.pages}`}</div>
                  <div>{lang === 'cn' ? `停止原因: ${liveResult.result.stoppedReason}` : `Stopped: ${liveResult.result.stoppedReason}`}</div>
                  {liveResult.result.message && <div className="text-amber-600">{liveResult.result.message}</div>}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="w-4 h-4" />
                <span>{liveResult.error ?? (lang === 'cn' ? '抓取失败' : 'Fetch failed')}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Source 3: Kicktraq Active ────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-1">
          <Activity className="w-5 h-5 text-purple-500" />
          <h2 className="font-semibold text-gray-800">{tr.kicktraqSync}</h2>
          <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-medium">kicktraq.com</span>
        </div>
        <p className="text-xs text-gray-400 mb-4">{lang === 'cn' ? '活跃项目补充 · 第三方数据源' : 'Active project supplement · third-party source'}</p>

        <p className="text-sm text-gray-500 mb-3">{tr.kicktraqSyncDesc}</p>
        <p className="text-xs bg-purple-50 text-purple-700 rounded-lg px-3 py-2 mb-5">{tr.kicktraqSyncAuto}</p>

        <div className="flex flex-wrap items-end gap-4 mb-5">
          <div>
            <label className="text-xs font-medium text-gray-400 mb-1 block">{tr.kicktraqPages}</label>
            <select value={ktPages} onChange={e => setKtPages(Number(e.target.value))} className={selectCls}>
              {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <button
          onClick={handleKicktraqSync}
          disabled={ktSyncing || isRunning || liveSyncing}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium text-sm transition-colors ${
            ktSyncing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-purple-600 text-white hover:bg-purple-700'
          }`}
        >
          <Activity className={`w-4 h-4 ${ktSyncing ? 'animate-pulse' : ''}`} />
          {ktSyncing ? tr.kicktraqSyncing : tr.kicktraqSyncBtn}
        </button>

        {ktResult && (
          <div className="mt-4 p-3 rounded-lg border text-sm space-y-1">
            {ktResult.ok && ktResult.result ? (
              <>
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle className="w-4 h-4" />
                  <span className="font-medium">{lang === 'cn' ? '抓取完成' : 'Fetch complete'}</span>
                </div>
                <div className="text-xs text-green-600 space-y-0.5 ml-6">
                  <div>{lang === 'cn' ? `入库: ${ktResult.result.imported} 条` : `Imported: ${ktResult.result.imported} records`}</div>
                  <div>{lang === 'cn' ? `翻页: ${ktResult.result.pages} 页` : `Pages: ${ktResult.result.pages}`}</div>
                  <div>{lang === 'cn' ? `停止原因: ${ktResult.result.stoppedReason}` : `Stopped: ${ktResult.result.stoppedReason}`}</div>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="w-4 h-4" />
                <span>{ktResult.error ?? (lang === 'cn' ? '抓取失败' : 'Fetch failed')}</span>
              </div>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    {log.status === 'completed'
                      ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                    <span className={`text-xs font-medium ${log.status === 'completed' ? 'text-green-600' : 'text-red-600'}`}>
                      {log.status === 'completed' ? tr.success : tr.failed}
                    </span>
                    {/* Source badge */}
                    {log.url?.startsWith('ks_live:') && (
                      <span className="text-xs bg-ks-green-light text-ks-green-dark px-1.5 py-0.5 rounded font-medium">KS Live</span>
                    )}
                    {log.url?.startsWith('kicktraq_active:') && (
                      <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded font-medium">Kicktraq</span>
                    )}
                    {!log.url?.startsWith('ks_live:') && !log.url?.startsWith('kicktraq_active:') && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">webrobots</span>
                    )}
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
