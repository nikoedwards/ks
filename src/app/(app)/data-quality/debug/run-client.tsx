'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, ExternalLink, PlayCircle, RefreshCw, XCircle } from 'lucide-react';

type DebugAction = 'official' | 'kicktraq';
type StepStatus = 'pending' | 'running' | 'success' | 'error';

type StepDefinition = {
  key: string;
  title: string;
  description: string;
  blocking?: boolean;
};

type StepState = StepDefinition & {
  status: StepStatus;
  startedAt?: number;
  finishedAt?: number;
  httpStatus?: number;
  message?: string;
  payload?: unknown;
};

const officialSteps: StepDefinition[] = [
  {
    key: 'prepare',
    title: '准备项目 URL',
    description: '确认项目 ID、Kickstarter JSON、Campaign、Rewards、Creator 页面 URL 是否能正确推导。',
    blocking: true,
  },
  {
    key: 'direct_json',
    title: '直连 Kickstarter JSON',
    description: '从主服务直接请求 Kickstarter .json，检查是否 403、Cloudflare、或只返回基础字段。',
  },
  {
    key: 'browser_health',
    title: '检查 Browser Worker',
    description: '确认 Browser Worker 是否在线、是否配置 token、Playwright 浏览器是否可用。',
  },
  {
    key: 'browser_json',
    title: 'Browser Worker 项目 JSON',
    description: '通过浏览器环境请求项目详情，并检查 rewards / collaborators 是否被提取出来。',
  },
  {
    key: 'browser_rewards',
    title: 'Rewards 页面检查',
    description: '打开 /rewards 页面，确认 Available Rewards、Backers 等可见内容是否存在。',
  },
  {
    key: 'browser_creator',
    title: 'Creator 页面检查',
    description: '打开 /creator 页面，确认右侧 Collaborators 区域是否存在。',
  },
  {
    key: 'write',
    title: '执行官方同步入库',
    description: '使用当前官方同步链路写入概览、数字曲线、奖励档位、合作者和文案快照。',
  },
];

const kicktraqSteps: StepDefinition[] = [
  {
    key: 'prepare',
    title: '准备 Kicktraq URL',
    description: '确认 creator slug、project slug、Kicktraq 页面和 dailychart 地址是否能正确推导。',
    blocking: true,
  },
  {
    key: 'page',
    title: '读取 Kicktraq 页面',
    description: '请求 Kicktraq 项目页，检查状态码、HTML 内容和是否被拦截。',
  },
  {
    key: 'parse',
    title: '解析早日曲线',
    description: '按 JSON、HTML、OCR 的顺序解析 Daily Data 行，并展示诊断信息。',
  },
  {
    key: 'write',
    title: '写入历史曲线',
    description: '将解析出的每日数据转换成累计快照并写入数据库。',
  },
];

function statusStyle(status: StepStatus) {
  if (status === 'success') return 'border-green-200 bg-green-50 text-green-700';
  if (status === 'error') return 'border-red-200 bg-red-50 text-red-700';
  if (status === 'running') return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-gray-200 bg-white text-gray-500';
}

function statusIcon(status: StepStatus) {
  if (status === 'success') return <CheckCircle2 className="h-4 w-4" />;
  if (status === 'error') return <XCircle className="h-4 w-4" />;
  if (status === 'running') return <RefreshCw className="h-4 w-4 animate-spin" />;
  return <Clock3 className="h-4 w-4" />;
}

function formatMs(start?: number, finish?: number) {
  if (!start) return '-';
  const end = finish ?? Date.now();
  return `${Math.max(0, end - start).toLocaleString()} ms`;
}

function stringifyPayload(payload: unknown) {
  if (payload === undefined) return '';
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export default function DebugRunClient({
  projectId,
  action,
}: {
  projectId: string;
  action: DebugAction;
}) {
  const definitions = useMemo(() => action === 'kicktraq' ? kicktraqSteps : officialSteps, [action]);
  const [steps, setSteps] = useState<StepState[]>(() => definitions.map(step => ({ ...step, status: 'pending' })));
  const [running, setRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<string | null>(definitions[0]?.key ?? null);
  const hasAutoRun = useRef(false);

  const title = action === 'kicktraq' ? '早日曲线 Debug' : '官方同步 Debug';
  const subtitle = action === 'kicktraq'
    ? '逐步检查 Kicktraq 历史曲线补录链路。'
    : '逐步检查 Kickstarter 官方同步链路，重点定位 rewards 和 collaborators 为什么抓不到。';

  const resetSteps = () => {
    setSteps(definitions.map(step => ({ ...step, status: 'pending' })));
    setExpanded(definitions[0]?.key ?? null);
  };

  const run = async () => {
    if (!projectId || running) return;
    setRunning(true);
    setRunStartedAt(Date.now());
    setSteps(definitions.map(step => ({ ...step, status: 'pending' })));

    for (const definition of definitions) {
      const startedAt = Date.now();
      setExpanded(definition.key);
      setSteps(current => current.map(step => step.key === definition.key
        ? { ...step, status: 'running', startedAt, finishedAt: undefined, message: undefined, payload: undefined, httpStatus: undefined }
        : step
      ));

      let failedBlockingStep = false;
      try {
        const res = await fetch('/api/data-quality/debug', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, action, step: definition.key }),
        });
        const payload = await res.json().catch(() => ({}));
        const ok = res.ok && payload.ok !== false;
        const finishedAt = Date.now();
        setSteps(current => current.map(step => step.key === definition.key
          ? {
              ...step,
              status: ok ? 'success' : 'error',
              finishedAt,
              httpStatus: res.status,
              message: payload.message || (ok ? 'Step completed.' : 'Step failed.'),
              payload,
            }
          : step
        ));
        failedBlockingStep = !ok && Boolean(definition.blocking);
      } catch (err) {
        const finishedAt = Date.now();
        setSteps(current => current.map(step => step.key === definition.key
          ? {
              ...step,
              status: 'error',
              finishedAt,
              message: err instanceof Error ? err.message : String(err),
              payload: { ok: false, message: err instanceof Error ? err.message : String(err) },
            }
          : step
        ));
        failedBlockingStep = Boolean(definition.blocking);
      }

      if (failedBlockingStep) break;
    }

    setRunning(false);
  };

  useEffect(() => {
    if (hasAutoRun.current) return;
    hasAutoRun.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completed = steps.filter(step => step.status === 'success').length;
  const failed = steps.filter(step => step.status === 'error').length;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <a href="/data-quality" className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" />
            返回数据质量
          </a>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
          <p className="mt-2 break-all text-xs text-gray-400">Project ID: {projectId || '(missing)'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={projectId ? `/projects/${projectId}` : '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <ExternalLink className="h-4 w-4" />
            项目页
          </a>
          <button
            onClick={() => {
              resetSteps();
              run();
            }}
            disabled={running || !projectId}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            重新运行
          </button>
        </div>
      </div>

      {!projectId && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          缺少 projectId，无法开始 Debug。
        </div>
      )}

      <section className="rounded-lg border border-gray-100 bg-white p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">运行状态</h2>
            <p className="mt-1 text-xs text-gray-400">
              成功 {completed} / {steps.length}，失败 {failed}，耗时 {runStartedAt ? formatMs(runStartedAt, running ? undefined : Date.now()) : '-'}
            </p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 md:w-72">
            <div
              className={`h-full rounded-full ${failed ? 'bg-red-500' : 'bg-ks-green'}`}
              style={{ width: `${Math.round(((completed + failed) / Math.max(steps.length, 1)) * 100)}%` }}
            />
          </div>
        </div>
      </section>

      <div className="space-y-3">
        {steps.map((step, index) => {
          const isExpanded = expanded === step.key;
          return (
            <section key={step.key} className="overflow-hidden rounded-lg border border-gray-100 bg-white">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : step.key)}
                className="flex w-full items-start gap-4 px-5 py-4 text-left hover:bg-gray-50"
              >
                <div className={`mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border ${statusStyle(step.status)}`}>
                  {statusIcon(step.status)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-400">STEP {index + 1}</span>
                    <h3 className="font-semibold text-gray-900">{step.title}</h3>
                    {step.httpStatus && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">HTTP {step.httpStatus}</span>}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{step.description}</p>
                  {step.message && (
                    <p className={`mt-2 text-sm ${step.status === 'error' ? 'text-red-700' : 'text-gray-700'}`}>
                      {step.message}
                    </p>
                  )}
                </div>
                <div className="hidden text-right text-xs text-gray-400 sm:block">
                  <p>{step.status}</p>
                  <p>{formatMs(step.startedAt, step.finishedAt)}</p>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-gray-100 bg-gray-950 p-4">
                  {step.status === 'pending' ? (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Clock3 className="h-4 w-4" />
                      等待执行
                    </div>
                  ) : step.status === 'running' ? (
                    <div className="flex items-center gap-2 text-sm text-blue-200">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      正在执行这个环节...
                    </div>
                  ) : (
                    <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-gray-100">
                      {stringifyPayload(step.payload)}
                    </pre>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {!!failed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            有步骤失败。先看第一个红色步骤里的 status、error、analysis 和 rawPreview；如果 Browser Worker 是 502，通常要继续看 worker 健康、Railway 日志和 worker 是否超时。
          </p>
        </div>
      )}
    </div>
  );
}
