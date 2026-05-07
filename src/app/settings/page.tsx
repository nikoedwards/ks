'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, Clock, Database, ExternalLink } from 'lucide-react';

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

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN');
}

function fmtDuration(start: string, end: string) {
  if (!start || !end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export default function SettingsPage() {
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

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Poll while running
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
        alert(data.error || '同步启动失败');
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
        <h1 className="text-2xl font-bold text-gray-900">数据同步</h1>
        <p className="text-sm text-gray-500 mt-1">从 webrobots.io 同步最新 Kickstarter 数据集</p>
      </div>

      {/* Database Status */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <Database className="w-5 h-5 text-blue-500" />
          <h2 className="font-semibold text-gray-800">数据库状态</h2>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500">项目总数</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {(status?.projectCount ?? 0).toLocaleString()}
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500">最近同步时间</p>
            <p className="text-sm font-medium text-gray-700 mt-1">
              {fmtTime(status?.lastSync?.completed_at ?? null)}
            </p>
          </div>
        </div>
      </div>

      {/* Sync Action */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-blue-500" />
            <h2 className="font-semibold text-gray-800">手动同步</h2>
          </div>
          <a
            href="https://webrobots.io/kickstarter-datasets/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
          >
            数据来源 <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          每次只下载 webrobots.io 最新一期数据集（压缩约 100MB，约 200万条项目记录），
          解析后写入本地 SQLite 数据库。同步时间约 5~15 分钟，请勿关闭应用。
        </p>
        <p className="text-xs text-gray-400 mb-6 bg-amber-50 text-amber-700 rounded-lg px-3 py-2">
          自动同步：每月15日凌晨3点自动执行一次，无需手动操作。
        </p>

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
          {isRunning ? '同步中...' : '立即同步'}
        </button>

        {/* Progress */}
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
              <p className="text-xs text-gray-400">
                已导入: {syncState.recordsImported.toLocaleString()} 条记录
              </p>
            )}
          </div>
        )}
      </div>

      {/* Sync History */}
      {(status?.history?.length ?? 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h3 className="font-semibold text-gray-700">同步历史</h3>
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
                      {log.status === 'completed' ? '成功' : '失败'}
                    </span>
                    <span className="text-xs text-gray-400">{fmtTime(log.started_at)}</span>
                    {log.completed_at && (
                      <span className="text-xs text-gray-400">
                        耗时: {fmtDuration(log.started_at, log.completed_at)}
                      </span>
                    )}
                  </div>
                  {log.records_imported > 0 && (
                    <p className="text-xs text-gray-500 mt-1 ml-5">
                      导入 {log.records_imported.toLocaleString()} 条记录
                    </p>
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
        <h3 className="font-semibold text-blue-800 mb-2">数据说明</h3>
        <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
          <li>数据来源：webrobots.io 每月爬取的 Kickstarter 全量快照</li>
          <li>数据格式：CSV（ZIP压缩），包含约 20+ 个字段</li>
          <li>历史数据：2016年3月至今，每月一份快照</li>
          <li>同步策略：仅同步最新一份数据（覆盖写入），保持数据最新</li>
          <li>数据库：本地 SQLite，存储于 data/kickstarter.db</li>
        </ul>
      </div>
    </div>
  );
}
