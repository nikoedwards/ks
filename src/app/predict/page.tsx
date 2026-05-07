'use client';

import { useState, useRef } from 'react';
import { Search, CheckCircle, Loader2, AlertCircle, Star, TrendingUp, Sparkles, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';

interface Step {
  label: string;
  done: boolean;
  active: boolean;
}

interface Dimension {
  key: string;
  label_cn: string;
  label_en: string;
  score: number;
  max: number;
  reasoning: string;
}

interface FinalResult {
  total: number;
  prediction: 'likely_success' | 'uncertain' | 'likely_fail';
  verdict: string;
  highlights: string[];
  concerns: string[];
}

interface ProjectInfo {
  title: string;
  creator: string;
  description: string;
}

const DIM_COLORS: Record<string, string> = {
  brand: '#3B82F6',
  concept: '#8B5CF6',
  market: '#05CE78',
  prelaunch: '#F59E0B',
  risk: '#EF4444',
};

export default function PredictPage() {
  const [lang] = useLanguage();
  const tr = t[lang].predict;

  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [steps, setSteps] = useState<Step[]>([]);
  const [dimensions, setDimensions] = useState<Dimension[]>([]);
  const [final, setFinal] = useState<FinalResult | null>(null);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const handleAnalyze = async () => {
    const trimmed = url.trim();
    if (!trimmed || !trimmed.includes('kickstarter.com')) {
      setErrorMsg(tr.errorInvalid);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus('loading');
    setSteps([]);
    setDimensions([]);
    setFinal(null);
    setProjectInfo(null);
    setErrorMsg('');

    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed, lang }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) {
        setStatus('error');
        setErrorMsg(tr.errorApi);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === 'project') {
              setProjectInfo({ title: data.title, creator: data.creator, description: data.description });
            } else if (data.type === 'step') {
              if (data.done) {
                setSteps(prev => {
                  if (prev.length === 0) return prev;
                  const next = [...prev];
                  next[next.length - 1] = { label: data.label, done: true, active: false };
                  return next;
                });
              } else {
                setSteps(prev => [...prev, { label: data.label, done: false, active: true }]);
              }
            } else if (data.type === 'dimension') {
              setDimensions(prev => [...prev, data as Dimension]);
            } else if (data.type === 'final') {
              setFinal(data as FinalResult);
              setStatus('done');
            } else if (data.type === 'error') {
              setErrorMsg(data.message || tr.errorApi);
              setStatus('error');
            }
          } catch {
            // skip unparseable lines
          }
        }
      }

      if (status === 'loading') setStatus('done');
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setStatus('error');
        setErrorMsg(tr.errorApi);
      }
    }
  };

  const handleReset = () => {
    abortRef.current?.abort();
    setStatus('idle');
    setUrl('');
    setSteps([]);
    setDimensions([]);
    setFinal(null);
    setProjectInfo(null);
    setErrorMsg('');
  };

  const verdictCls = final?.prediction === 'likely_success'
    ? 'text-ks-green-dark bg-ks-green-light border-ks-green/20'
    : final?.prediction === 'likely_fail'
    ? 'text-red-600 bg-red-50 border-red-100'
    : 'text-amber-600 bg-amber-50 border-amber-100';

  const scoreCls = (final?.total ?? 0) >= 70
    ? 'text-ks-green'
    : (final?.total ?? 0) >= 50
    ? 'text-amber-500'
    : 'text-red-500';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-ks-green" />
          {tr.title}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      {/* URL Input */}
      {(status === 'idle' || status === 'error') && (
        <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm space-y-4">
          <label className="text-sm font-semibold text-gray-700 block">{tr.urlLabel}</label>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
              <input
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setErrorMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                placeholder={tr.urlPlaceholder}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ks-green"
              />
            </div>
            <button
              onClick={handleAnalyze}
              className="flex items-center gap-2 px-5 py-2.5 bg-ks-green hover:bg-ks-green-dark text-white rounded-lg font-semibold text-sm transition-colors shadow-sm shrink-0"
            >
              <TrendingUp className="w-4 h-4" />
              {tr.analyzeBtn}
            </button>
          </div>
          {errorMsg && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errorMsg}
            </div>
          )}
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 leading-relaxed">{tr.hint}</p>
        </div>
      )}

      {/* Active URL bar (during/after analysis) */}
      {(status === 'loading' || status === 'done') && (
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-600 truncate">{url}</span>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 transition-colors shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {tr.tryAnother}
          </button>
        </div>
      )}

      {/* Progress steps */}
      {steps.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">{tr.progress}</h3>
          <div className="space-y-2.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {step.done
                  ? <CheckCircle className="w-4 h-4 text-ks-green shrink-0" />
                  : step.active
                  ? <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                  : <div className="w-4 h-4 rounded-full border-2 border-gray-200 shrink-0" />}
                <span className={`text-sm ${step.done ? 'text-gray-400 line-through' : step.active ? 'text-gray-900 font-medium' : 'text-gray-400'}`}>
                  {step.label}
                </span>
              </div>
            ))}
            {status === 'loading' && dimensions.length === 0 && (
              <div className="mt-2 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                <div className="h-1 bg-ks-green rounded-full animate-pulse" style={{ width: '60%' }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Project info card */}
      {projectInfo && (
        <div className="bg-gray-50 rounded-xl border border-gray-100 p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-5 h-5 text-ks-green" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-snug">{projectInfo.title || url}</h3>
              {projectInfo.creator && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {tr.creatorLabel}: {projectInfo.creator}
                </p>
              )}
              {projectInfo.description && (
                <p className="text-xs text-gray-500 mt-1.5 leading-relaxed line-clamp-2">{projectInfo.description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dimension scores (appear one by one) */}
      {dimensions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm space-y-5">
          <h3 className="font-semibold text-gray-700 text-sm">{tr.dimensionScores}</h3>
          {dimensions.map(dim => (
            <div key={dim.key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">
                  {lang === 'cn' ? dim.label_cn : dim.label_en}
                </span>
                <span className="text-sm font-bold tabular-nums" style={{ color: DIM_COLORS[dim.key] ?? '#6B7280' }}>
                  {dim.score}/{dim.max}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className="h-2.5 rounded-full transition-all duration-700"
                  style={{
                    width: `${(dim.score / dim.max) * 100}%`,
                    backgroundColor: DIM_COLORS[dim.key] ?? '#6B7280',
                  }}
                />
              </div>
              {dim.reasoning && (
                <p className="text-xs text-gray-500 leading-relaxed">{dim.reasoning}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Final result */}
      {final && (
        <div className="space-y-4">
          {/* Score + Verdict */}
          <div className="bg-white rounded-xl border border-gray-100 p-6 shadow-sm flex items-center gap-6">
            <div className="shrink-0 text-center min-w-[80px]">
              <div className={`text-5xl font-black ${scoreCls}`}>{final.total}</div>
              <div className="text-xs text-gray-400 mt-0.5">/100</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border mb-2 ${verdictCls}`}>
                {final.prediction === 'likely_success' ? tr.verdictSuccess
                  : final.prediction === 'likely_fail' ? tr.verdictFail
                  : tr.verdictUncertain}
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{final.verdict}</p>
            </div>
          </div>

          {/* Highlights + Concerns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {final.highlights.length > 0 && (
              <div className="bg-ks-green-light rounded-xl p-4 border border-ks-green/20">
                <h4 className="text-sm font-semibold text-ks-green-dark mb-2.5 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5" />
                  {tr.highlights}
                </h4>
                <ul className="space-y-1.5">
                  {final.highlights.map((h, i) => (
                    <li key={i} className="text-xs text-ks-green-dark flex items-start gap-1.5 leading-relaxed">
                      <span className="mt-0.5 shrink-0">•</span>
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {final.concerns.length > 0 && (
              <div className="bg-amber-50 rounded-xl p-4 border border-amber-100">
                <h4 className="text-sm font-semibold text-amber-800 mb-2.5 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {tr.concerns}
                </h4>
                <ul className="space-y-1.5">
                  {final.concerns.map((c, i) => (
                    <li key={i} className="text-xs text-amber-800 flex items-start gap-1.5 leading-relaxed">
                      <span className="mt-0.5 shrink-0">⚠</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center leading-relaxed">{tr.hint}</p>
        </div>
      )}
    </div>
  );
}
