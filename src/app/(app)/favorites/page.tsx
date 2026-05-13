'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Heart, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/hooks/useLanguage';
import { t } from '@/lib/i18n';
import ImagePreview from '@/components/ImagePreview';

interface Project {
  id: string;
  name: string;
  blurb: string;
  state: string;
  category_parent: string;
  category_name?: string | null;
  currency?: string | null;
  usd_pledged: number;
  backers_count: number;
  goal?: number;
  country?: string;
  deadline?: number;
  source_url: string;
  image_url?: string | null;
  image_thumb_url?: string | null;
}

export default function FavoritesPage() {
  const { user, showLogin } = useAuth();
  const [lang] = useLanguage();
  const tr = t[lang].favorites;
  const authTr = t[lang].auth;

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading]   = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadFavorites = () => {
    if (!user) { setLoading(false); return; }
    fetch('/api/favorites').then(r => r.json()).then(d => {
      setProjects(d.data ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => {
    try {
      setExpandedIds(new Set(JSON.parse(localStorage.getItem('ks:favorites:expandedRows') || '[]') as string[]));
    } catch { /* ignore */ }
    loadFavorites();
  }, [user]);

  const toggleExpanded = (projectId: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem('ks:favorites:expandedRows', JSON.stringify([...next]));
      return next;
    });
  };

  const removeFavorite = async (projectId: string) => {
    await fetch(`/api/favorites/${projectId}`, { method: 'DELETE' });
    setProjects(prev => prev.filter(p => p.id !== projectId));
  };

  if (!user) return (
    <div className="max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>
      <div className="mt-12 text-center">
        <Heart className="w-12 h-12 text-gray-200 mx-auto mb-4" />
        <p className="text-gray-500 mb-4">{authTr.loginToFavorite}</p>
        <button
          onClick={() => showLogin()}
          className="px-6 py-2.5 bg-ks-green hover:bg-ks-green-dark text-white rounded-lg font-semibold text-sm transition-colors"
        >
          {authTr.signIn}
        </button>
      </div>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />
      {lang === 'cn' ? '加载中...' : 'Loading...'}
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tr.title}</h1>
        <p className="text-sm text-gray-500 mt-1">{tr.subtitle}</p>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16">
          <Heart className="w-12 h-12 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">{tr.empty}</p>
          <p className="text-gray-400 text-sm mt-1">{tr.emptyHint}</p>
          <Link href="/projects" className="inline-flex items-center gap-1.5 mt-4 text-ks-green font-semibold text-sm hover:underline">
            {lang === 'cn' ? '浏览项目' : 'Browse Projects'}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">
                  <th className="px-5 py-3"></th>
                  <th className="px-5 py-3">{lang === 'cn' ? '项目名称' : 'Project'}</th>
                  <th className="px-5 py-3">{lang === 'cn' ? '状态' : 'Status'}</th>
                  <th className="px-5 py-3">{lang === 'cn' ? '类目' : 'Category'}</th>
                  <th className="px-5 py-3 text-right">{lang === 'cn' ? '众筹金额' : 'Pledged'}</th>
                  <th className="px-5 py-3 text-right">{lang === 'cn' ? '支持人数' : 'Backers'}</th>
                  <th className="px-5 py-3 text-center">{lang === 'cn' ? '操作' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map(p => {
                  const expanded = expandedIds.has(p.id);
                  const pct = p.goal ? Math.round((Number(p.usd_pledged ?? 0) / Math.max(1, Number(p.goal))) * 100) : null;
                  return (
                  <Fragment key={p.id}>
                  <tr className="hover:bg-gray-50/80">
                    <td className="px-5 py-3">
                      <Link href={`/projects/${p.id}`} className="block h-12 w-20 overflow-hidden rounded-md bg-gray-100">
                        {p.image_thumb_url || p.image_url ? (
                          <ImagePreview src={p.image_thumb_url || p.image_url} className="block h-full w-full">
                            <img src={p.image_thumb_url || p.image_url || ''} alt="" className="h-full w-full object-cover" />
                          </ImagePreview>
                        ) : (
                          <div className="h-full w-full bg-gray-100" />
                        )}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/projects/${p.id}`} className="font-medium text-gray-900 hover:text-ks-green transition-colors line-clamp-1">
                        {p.name}
                      </Link>
                      {p.blurb && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{p.blurb}</p>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                        p.state === 'successful' ? 'bg-ks-green-light text-ks-green-dark'
                        : p.state === 'failed' ? 'bg-red-50 text-red-600'
                        : 'bg-blue-50 text-blue-600'
                      }`}>
                        {t[lang].states[p.state as keyof typeof t.en.states] ?? p.state}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{p.category_parent}</td>
                    <td className="px-5 py-3 text-right text-gray-700">${Number(p.usd_pledged).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right text-gray-600">{Number(p.backers_count).toLocaleString()}</td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {p.source_url && (
                          <a href={p.source_url} target="_blank" rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => removeFavorite(p.id)}
                          className="p-1.5 text-red-400 hover:text-red-600 transition-colors"
                          title={tr.remove}
                        >
                          <Heart className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          onClick={() => toggleExpanded(p.id)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 transition-colors"
                          title={expanded ? (lang === 'cn' ? '收起详情' : 'Collapse') : (lang === 'cn' ? '展开详情' : 'Expand')}
                        >
                          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded && (
                    <tr key={`${p.id}-details`} className="bg-gray-50/60">
                      <td />
                      <td colSpan={6} className="px-5 py-4">
                        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-6">
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '二级类目' : 'Subcategory'}</p>
                            <p className="mt-1 text-gray-800">{p.category_name || '-'}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '国家' : 'Country'}</p>
                            <p className="mt-1 text-gray-800">{p.country || '-'}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '目标' : 'Goal'}</p>
                            <p className="mt-1 text-gray-800">${Number(p.goal ?? 0).toLocaleString()}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '完成率' : 'Funded'}</p>
                            <p className="mt-1 text-gray-800">{pct !== null ? `${pct}%` : '-'}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '截止时间' : 'Deadline'}</p>
                            <p className="mt-1 text-gray-800">{p.deadline ? new Date(p.deadline * 1000).toLocaleDateString('zh-CN') : '-'}</p>
                          </div>
                          <div>
                            <p className="font-semibold text-gray-400">{lang === 'cn' ? '项目 ID' : 'Project ID'}</p>
                            <p className="mt-1 truncate text-gray-800">{p.id}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );})}
              </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
