'use client';

import { useEffect, useState } from 'react';
import {
  Eye, MousePointerClick, Megaphone, Save, Heart, Radar, Sparkles,
  Plus, Trash2, RefreshCw, Clock, X,
} from 'lucide-react';

type Segment = 'favorites' | 'digest' | 'new_users';
type Frequency = 'daily' | 'once' | 'always';

interface GuideStep { icon?: string; title: string; desc: string; href?: string }

interface RuleConfig {
  headerNote?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  maxItems?: number;
  showPledgedDelta?: boolean;
  showBackersDelta?: boolean;
  showFundedPct?: boolean;
  showDaysLeft?: boolean;
  maxMovers?: number;
  showFastestFunding?: boolean;
  showFastestBackers?: boolean;
  showNewlyLaunched?: boolean;
  showEndingSoon?: boolean;
  newUserWindowDays?: number;
  intro?: string;
  steps?: GuideStep[];
}

interface Rule {
  segment: Segment;
  template: string;
  enabled: number;
  frequency: Frequency;
  config: RuleConfig;
  views?: number;
  clicks?: number;
  dismissals?: number;
  avg_duration_ms?: number | null;
}

const SEGMENT_META: Record<Segment, { icon: React.ComponentType<{ className?: string }>; title: string; desc: string; tone: string }> = {
  favorites: {
    icon: Heart,
    title: '收藏用户 · 每日动态摘要',
    desc: '面向已收藏进行中项目的用户，自动汇总这些项目今日的筹款、支持者和进度变化。',
    tone: 'from-rose-500 to-pink-500',
  },
  digest: {
    icon: Radar,
    title: '普通用户 · 平台每日速览',
    desc: '面向尚未收藏项目的用户（含未登录访客），自动展示全站升温最快、新上线、即将结束的项目。',
    tone: 'from-emerald-500 to-teal-500',
  },
  new_users: {
    icon: Sparkles,
    title: '新用户 · 核心功能引导',
    desc: '面向注册时间在窗口期内的新用户，展示一次性的产品上手引导。',
    tone: 'from-indigo-500 to-violet-500',
  },
};

export default function AdminPushPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [savingSeg, setSavingSeg] = useState<Segment | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    return fetch('/api/admin/push', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRules(d.data ?? []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const totals = rules.reduce(
    (acc, r) => {
      acc.views += Number(r.views ?? 0);
      acc.clicks += Number(r.clicks ?? 0);
      acc.dismissals += Number(r.dismissals ?? 0);
      return acc;
    },
    { views: 0, clicks: 0, dismissals: 0 },
  );
  const ctr = totals.views ? Math.round((totals.clicks / totals.views) * 1000) / 10 : 0;

  const update = (segment: Segment, patch: Partial<Rule>) =>
    setRules(prev => prev.map(r => (r.segment === segment ? { ...r, ...patch } : r)));
  const updateConfig = (segment: Segment, patch: Partial<RuleConfig>) =>
    setRules(prev => prev.map(r => (r.segment === segment ? { ...r, config: { ...r.config, ...patch } } : r)));

  const save = async (rule: Rule) => {
    setSavingSeg(rule.segment);
    await fetch('/api/admin/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment: rule.segment,
        enabled: !!rule.enabled,
        frequency: rule.frequency,
        config: rule.config,
      }),
    }).catch(() => {});
    setSavingSeg(null);
    load();
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">更新推送 · 自动生成</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            推送内容根据规则自动生成，无需手动撰写。系统会按用户类型（有收藏 / 无收藏 / 新用户）选择对应模板，
            你只需在这里配置投放人群、频率与展示维度，并查看效果数据。
          </p>
        </div>
        <button onClick={load} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
          <RefreshCw className="h-4 w-4" />刷新
        </button>
      </div>

      {/* Aggregate analytics */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon={Eye} label="总浏览" value={totals.views.toLocaleString()} />
        <StatCard icon={MousePointerClick} label="总点击" value={totals.clicks.toLocaleString()} />
        <StatCard icon={X} label="总关闭" value={totals.dismissals.toLocaleString()} />
        <StatCard icon={Megaphone} label="整体点击率" value={`${ctr}%`} accent />
      </div>

      {loading && <div className="rounded-xl border border-gray-100 bg-white p-10 text-center text-sm text-gray-400">加载中…</div>}

      <div className="space-y-5">
        {rules.map(rule => (
          <RuleCard
            key={rule.segment}
            rule={rule}
            saving={savingSeg === rule.segment}
            onChange={patch => update(rule.segment, patch)}
            onConfig={patch => updateConfig(rule.segment, patch)}
            onSave={() => save(rule)}
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-gray-400"><Icon className="h-4 w-4" />{label}</div>
      <p className={`mt-2 text-2xl font-black ${accent ? 'text-ks-green' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

function RuleCard({ rule, saving, onChange, onConfig, onSave }: {
  rule: Rule;
  saving: boolean;
  onChange: (patch: Partial<Rule>) => void;
  onConfig: (patch: Partial<RuleConfig>) => void;
  onSave: () => void;
}) {
  const meta = SEGMENT_META[rule.segment];
  const Icon = meta.icon;
  const views = Number(rule.views ?? 0);
  const clicks = Number(rule.clicks ?? 0);
  const ctr = views ? Math.round((clicks / views) * 1000) / 10 : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className={`flex items-center justify-between gap-4 bg-gradient-to-r ${meta.tone} px-5 py-4 text-white`}>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20"><Icon className="h-5 w-5" /></span>
          <div>
            <h2 className="font-black">{meta.title}</h2>
            <p className="text-xs text-white/80">{meta.desc}</p>
          </div>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">
          <input type="checkbox" checked={!!rule.enabled} onChange={e => onChange({ enabled: e.target.checked ? 1 : 0 })} className="accent-white" />
          {rule.enabled ? '已启用' : '已停用'}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[1fr_240px]">
        {/* Config */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm">
              <span className="mr-2 text-xs font-semibold text-gray-400">投放频率</span>
              <select value={rule.frequency} onChange={e => onChange({ frequency: e.target.value as Frequency })} className="rounded-lg border border-gray-200 px-3 py-1.5">
                <option value="daily">每天一次</option>
                <option value="once">仅一次</option>
                <option value="always">每次打开</option>
              </select>
            </label>
          </div>

          {rule.segment === 'favorites' && (
            <>
              <NumberField label="最多展示项目数" value={rule.config.maxItems ?? 6} min={1} max={12} onChange={v => onConfig({ maxItems: v })} />
              <div className="flex flex-wrap gap-2">
                <Toggle label="筹款变化" on={rule.config.showPledgedDelta !== false} onClick={() => onConfig({ showPledgedDelta: rule.config.showPledgedDelta === false })} />
                <Toggle label="支持者变化" on={rule.config.showBackersDelta !== false} onClick={() => onConfig({ showBackersDelta: rule.config.showBackersDelta === false })} />
                <Toggle label="完成度" on={rule.config.showFundedPct !== false} onClick={() => onConfig({ showFundedPct: rule.config.showFundedPct === false })} />
                <Toggle label="剩余天数" on={rule.config.showDaysLeft !== false} onClick={() => onConfig({ showDaysLeft: rule.config.showDaysLeft === false })} />
              </div>
              <CtaFields config={rule.config} onConfig={onConfig} />
              <NoteField config={rule.config} onConfig={onConfig} />
            </>
          )}

          {rule.segment === 'digest' && (
            <>
              <NumberField label="每个榜单展示数量" value={rule.config.maxMovers ?? 5} min={3} max={10} onChange={v => onConfig({ maxMovers: v })} />
              <div className="flex flex-wrap gap-2">
                <Toggle label="增长最快" on={rule.config.showFastestFunding !== false} onClick={() => onConfig({ showFastestFunding: rule.config.showFastestFunding === false })} />
                <Toggle label="支持者增长" on={rule.config.showFastestBackers !== false} onClick={() => onConfig({ showFastestBackers: rule.config.showFastestBackers === false })} />
                <Toggle label="新上线" on={rule.config.showNewlyLaunched !== false} onClick={() => onConfig({ showNewlyLaunched: rule.config.showNewlyLaunched === false })} />
                <Toggle label="即将结束" on={rule.config.showEndingSoon !== false} onClick={() => onConfig({ showEndingSoon: rule.config.showEndingSoon === false })} />
              </div>
              <CtaFields config={rule.config} onConfig={onConfig} />
              <NoteField config={rule.config} onConfig={onConfig} />
            </>
          )}

          {rule.segment === 'new_users' && (
            <>
              <NumberField label="新用户窗口（天）" value={rule.config.newUserWindowDays ?? 7} min={1} max={30} onChange={v => onConfig({ newUserWindowDays: v })} />
              <label className="block text-sm">
                <span className="text-xs font-semibold text-gray-400">引导开场白</span>
                <textarea value={rule.config.intro ?? ''} onChange={e => onConfig({ intro: e.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
              </label>
              <StepsEditor steps={rule.config.steps ?? []} onChange={steps => onConfig({ steps })} />
              <CtaFields config={rule.config} onConfig={onConfig} />
            </>
          )}

          <button onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-ks-green px-4 py-2.5 text-sm font-bold text-white hover:bg-ks-green-dark disabled:opacity-60">
            <Save className="h-4 w-4" />{saving ? '保存中…' : '保存规则'}
          </button>
        </div>

        {/* Analytics */}
        <div className="space-y-3 rounded-xl bg-gray-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-400">投放效果</p>
          <Metric label="浏览" value={views.toLocaleString()} />
          <Metric label="点击" value={clicks.toLocaleString()} />
          <Metric label="关闭" value={Number(rule.dismissals ?? 0).toLocaleString()} />
          <Metric label="点击率 (CTR)" value={`${ctr}%`} accent />
          <Metric label="平均停留" value={`${Math.round(Number(rule.avg_duration_ms ?? 0) / 1000)}s`} icon={Clock} />
        </div>
      </div>
    </section>
  );
}

function CtaFields({ config, onConfig }: { config: RuleConfig; onConfig: (p: Partial<RuleConfig>) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-sm">
        <span className="text-xs font-semibold text-gray-400">按钮文案</span>
        <input value={config.ctaLabel ?? ''} onChange={e => onConfig({ ctaLabel: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="text-xs font-semibold text-gray-400">跳转链接</span>
        <input value={config.ctaUrl ?? ''} onChange={e => onConfig({ ctaUrl: e.target.value })} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
      </label>
    </div>
  );
}

function NoteField({ config, onConfig }: { config: RuleConfig; onConfig: (p: Partial<RuleConfig>) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-semibold text-gray-400">顶部提示语（可选）</span>
      <input value={config.headerNote ?? ''} onChange={e => onConfig({ headerNote: e.target.value })} placeholder="例如：进行中项目数据仍在变化中" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm">
      <span className="text-xs font-semibold text-gray-400">{label}</span>
      <input type="number" min={min} max={max} value={value}
        onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
        className="mt-1 w-28 rounded-lg border border-gray-200 px-3 py-2" />
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${on ? 'bg-ks-green text-white' : 'bg-gray-100 text-gray-500'}`}>
      {label}
    </button>
  );
}

function Metric({ label, value, accent, icon: Icon }: { label: string; value: string; accent?: boolean; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-sm text-gray-500">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</span>
      <span className={`text-sm font-black ${accent ? 'text-ks-green' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}

function StepsEditor({ steps, onChange }: { steps: GuideStep[]; onChange: (s: GuideStep[]) => void }) {
  const set = (i: number, patch: Partial<GuideStep>) => onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const add = () => onChange([...steps, { icon: 'radar', title: '', desc: '', href: '' }]);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400">引导步骤</p>
      {steps.map((s, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <div className="flex items-center gap-2">
            <select value={s.icon ?? 'radar'} onChange={e => set(i, { icon: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm">
              <option value="radar">雷达</option>
              <option value="heart">收藏</option>
              <option value="chart">曲线</option>
              <option value="trophy">榜单</option>
            </select>
            <input value={s.title} onChange={e => set(i, { title: e.target.value })} placeholder="标题" className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
            <button onClick={() => remove(i)} className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
          </div>
          <input value={s.desc} onChange={e => set(i, { desc: e.target.value })} placeholder="描述" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
          <input value={s.href ?? ''} onChange={e => set(i, { href: e.target.value })} placeholder="跳转链接（可选）" className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm" />
        </div>
      ))}
      <button type="button" onClick={add} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-semibold text-gray-500 hover:bg-gray-50">
        <Plus className="h-4 w-4" />添加步骤
      </button>
    </div>
  );
}
