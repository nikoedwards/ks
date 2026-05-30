'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw, Database, Zap, Activity, Clock, CheckCircle, XCircle,
  ChevronDown, ChevronUp, ExternalLink, AlertTriangle,
} from 'lucide-react';

interface SyncState {
  status: 'idle' | 'running' | 'completed' | 'error';
  message: string;
  progress: number;
  recordsImported: number;
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
  history: SyncLog[];
  projectCount: number;
}
interface WebrobotsInfo {
  latestDate: string | null;
  syncedDate: string | null;
  syncedAt: string | null;
  upToDate: boolean;
}

function fmtTime(iso: string | null, cn: boolean) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(cn ? 'zh-CN' : 'en-US');
}
function nextDailyCheck(cn: boolean) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(4, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toLocaleString(cn ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function DataSourceSync({ cn }: { cn: boolean }) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [wr, setWr] = useState<WebrobotsInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [livePages, setLivePages] = useState(10);
  const [liveState, setLiveState] = useState<'live' | 'successful' | 'all'>('live');
  const [ktPages, setKtPages] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const fetchStatus = useCallback(() => {
    fetch('/api/sync/status', { cache: 'no-store' }).then(r => r.json()).then(setStatus).catch(() => {});
  }, []);
  const fetchWr = useCallback(() => {
    fetch('/api/sync', { cache: 'no-store' }).then(r => r.json()).then(d => { if (!d.error) setWr(d); }).catch(() => {});
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);
  useEffect(() => { if (open && !wr) fetchWr(); }, [open, wr, fetchWr]);

  const running = status?.syncState?.status === 'running';
  useEffect(() => {
    if (!running && !busy) return;
    const id = setInterval(fetchStatus, 2500);
    return () => clearInterval(id);
  }, [running, busy, fetchStatus]);

  const post = async (url: string, body: object, key: string, label: string) => {
    setBusy(key);
    setNote(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) setNote({ ok: false, text: data.error || `${label}失败` });
      else if (data.skipped) setNote({ ok: true, text: data.message || '已是最新' });
      else setNote({ ok: true, text: data.message || `${label}已开始` });
      fetchStatus();
      if (key.startsWith('wr')) fetchWr();
    } catch (e) {
      setNote({ ok: false, text: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const syncState = status?.syncState;

  return (
    <section className="bg-white border border-gray-100 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-ks-green" />
          <h2 className="font-semibold text-gray-800">{cn ? '数据源同步' : 'Data source sync'}</h2>
          <span className="text-xs text-gray-400">{cn ? '后台已自动运行 · 此处为手动补充' : 'Runs automatically · manual triggers here'}</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-gray-100 pt-4">
          {note && (
            <div className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 ${note.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {note.ok ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}{note.text}
            </div>
          )}

          {running && syncState && (
            <div className="space-y-2 rounded-lg bg-blue-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm text-blue-700">
                <Clock className="w-4 h-4 animate-pulse" />{syncState.message}
              </div>
              <div className="w-full bg-blue-100 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${syncState.progress}%` }} />
              </div>
            </div>
          )}

          {/* Webrobots */}
          <div className="rounded-lg border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-500" />
                <span className="font-medium text-gray-800 text-sm">Webrobots</span>
                <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{cn ? '月度全量快照' : 'monthly snapshot'}</span>
                {wr && (wr.upToDate
                  ? <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{cn ? '已最新' : 'up to date'}</span>
                  : <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{cn ? '有新数据集' : 'new dataset'}</span>)}
              </div>
              <a href="https://webrobots.io/kickstarter-datasets/" target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                {cn ? '数据源' : 'source'}<ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>{cn ? '当前数据集' : 'Current'}: <b className="text-gray-700">{wr?.syncedDate ?? '—'}</b></span>
              <span>{cn ? '最新数据集' : 'Latest'}: <b className="text-gray-700">{wr?.latestDate ?? '—'}</b></span>
              <span>{cn ? '上次导入' : 'Last import'}: {fmtTime(wr?.syncedAt ?? null, cn)}</span>
              <span>{cn ? '下次自动检查' : 'Next auto-check'}: {nextDailyCheck(cn)}</span>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {cn ? '每天 04:00 自动检查，仅当 webrobots 发布新月度数据集时才下载导入。' : 'Auto-checks daily at 04:00 and imports only when a new monthly dataset is published.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => post('/api/sync', {}, 'wr-check', cn ? '检查更新' : 'Check')} disabled={!!busy || running}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'wr-check' ? 'animate-spin' : ''}`} />{cn ? '检查更新' : 'Check for update'}
              </button>
              <button onClick={() => post('/api/sync', { force: true }, 'wr-force', cn ? '强制重导' : 'Force')} disabled={!!busy || running}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                {cn ? '强制重新导入' : 'Force re-import'}
              </button>
            </div>
          </div>

          {/* KS Live + Kicktraq active */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-100 p-4">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-ks-green" />
                <span className="font-medium text-gray-800 text-sm">KS Live</span>
                <span className="text-xs bg-ks-green-light text-ks-green-dark px-2 py-0.5 rounded-full">{cn ? '每 15 分钟' : 'every 15m'}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{cn ? '发现新上线项目，后台已自动运行' : 'New project discovery, runs automatically'}</p>
              <div className="mt-3 flex items-end gap-2">
                <select value={livePages} onChange={e => setLivePages(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  {[5, 10, 20, 50].map(n => <option key={n} value={n}>{n}{cn ? ' 页' : 'p'}</option>)}
                </select>
                <select value={liveState} onChange={e => setLiveState(e.target.value as typeof liveState)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  <option value="live">{cn ? '进行中' : 'live'}</option>
                  <option value="successful">{cn ? '已成功' : 'successful'}</option>
                  <option value="all">{cn ? '全部' : 'all'}</option>
                </select>
                <button onClick={() => post('/api/sync/live', { maxPages: livePages, state: liveState, since: Math.floor(Date.now() / 1000) - 7 * 24 * 3600, wait: true }, 'live', cn ? '抓取' : 'Fetch')} disabled={!!busy || running}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ks-green px-3 py-1.5 text-xs font-medium text-white hover:bg-ks-green-dark disabled:opacity-50">
                  <Zap className={`w-3.5 h-3.5 ${busy === 'live' ? 'animate-pulse' : ''}`} />{cn ? '立即抓取' : 'Fetch'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-gray-100 p-4">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-purple-500" />
                <span className="font-medium text-gray-800 text-sm">Kicktraq</span>
                <span className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">{cn ? '每 6 小时' : 'every 6h'}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">{cn ? '活跃项目补充，后台已自动运行' : 'Active project supplement, runs automatically'}</p>
              <div className="mt-3 flex items-end gap-2">
                <select value={ktPages} onChange={e => setKtPages(Number(e.target.value))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
                  {[3, 5, 10, 20].map(n => <option key={n} value={n}>{n}{cn ? ' 页' : 'p'}</option>)}
                </select>
                <button onClick={() => post('/api/sync/kicktraq-active', { maxPages: ktPages, onlyCurrentlyLive: true, wait: true }, 'kt', cn ? '抓取' : 'Fetch')} disabled={!!busy || running}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50">
                  <Activity className={`w-3.5 h-3.5 ${busy === 'kt' ? 'animate-pulse' : ''}`} />{cn ? '立即抓取' : 'Fetch'}
                </button>
              </div>
            </div>
          </div>

          {/* Kicktraq full scan */}
          <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-4">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-amber-500" />
              <span className="font-medium text-gray-800 text-sm">{cn ? 'Kicktraq 全量扫描' : 'Kicktraq full scan'}</span>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{cn ? '一次性 · 无自动调度' : 'one-time'}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {cn ? '遍历约 130 个类目补全当前活跃项目（约 2800 个），预计 15–30 分钟。历史数据仍依赖 webrobots 月度快照。' : 'Crawls ~130 categories for currently active projects (~2800), 15–30 min. Historical data relies on webrobots.'}
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => post('/api/sync/kicktraq-full', { delayMs: 350 }, 'full', cn ? '全量扫描' : 'Full scan')} disabled={!!busy || running}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                <Activity className={`w-3.5 h-3.5 ${busy === 'full' || (running) ? 'animate-spin' : ''}`} />{cn ? '开始全量扫描' : 'Start full scan'}
              </button>
              {running && (
                <button onClick={() => post('/api/sync/kicktraq-full', { abort: true }, 'abort', cn ? '中止' : 'Abort')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100">
                  <XCircle className="w-3.5 h-3.5" />{cn ? '中止' : 'Abort'}
                </button>
              )}
            </div>
          </div>

          {/* History */}
          {(status?.history?.length ?? 0) > 0 && (
            <div className="rounded-lg border border-gray-100">
              <button onClick={() => setHistoryOpen(h => !h)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                <span>{cn ? '同步历史' : 'Sync history'} ({status!.history.length})</span>
                {historyOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              {historyOpen && (
                <div className="divide-y divide-gray-50 border-t border-gray-100 max-h-72 overflow-y-auto">
                  {status!.history.map(log => {
                    const src = log.url?.startsWith('ks_live:') ? ['KS Live', 'bg-ks-green-light text-ks-green-dark']
                      : log.url?.startsWith('kicktraq') ? ['Kicktraq', 'bg-purple-50 text-purple-600']
                      : ['webrobots', 'bg-blue-50 text-blue-600'];
                    return (
                      <div key={log.id} className="px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-2 flex-wrap">
                          {log.status === 'completed' ? <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <span className={`px-1.5 py-0.5 rounded font-medium ${src[1]}`}>{src[0]}</span>
                          <span className="text-gray-400">{fmtTime(log.started_at, cn)}</span>
                          {log.records_imported > 0 && <span className="text-gray-500">· {log.records_imported.toLocaleString()} {cn ? '条' : 'records'}</span>}
                        </div>
                        {log.error_message && <p className="mt-1 text-red-500 break-all">{log.error_message}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
