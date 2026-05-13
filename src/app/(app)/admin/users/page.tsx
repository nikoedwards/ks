'use client';

import { useEffect, useState } from 'react';
import { Edit3, Plus, Save, Shield, Trash2, UserCog, Users, X, type LucideIcon } from 'lucide-react';

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  role: 'admin' | 'user';
  email_verified: number;
  created_at: number;
  favorites_count: number;
  subscriptions_count: number;
  session_expires_at: number | null;
}

interface UsersData {
  summary: { total_users: number; admins: number; normal_users: number; verified_users: number };
  users: UserRow[];
}

function fmtDate(ts: number | null) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN');
}

export default function AdminUsersPage() {
  const [data, setData] = useState<UsersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ username: '', email: '', password: '', role: 'user' as 'admin' | 'user', email_verified: 1 });

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const setRole = async (userId: number, role: 'admin' | 'user') => {
    await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role }),
    });
    load();
  };

  const startEdit = (user: UserRow) => {
    setEditingId(user.id);
    setForm({
      username: user.username,
      email: user.email ?? '',
      password: '',
      role: user.role,
      email_verified: user.email_verified ? 1 : 0,
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ username: '', email: '', password: '', role: 'user', email_verified: 1 });
  };

  const saveUser = async () => {
    const payload = {
      ...(editingId ? { userId: editingId } : {}),
      username: form.username,
      email: form.email,
      ...(form.password ? { password: form.password } : {}),
      role: form.role,
      email_verified: form.email_verified,
    };
    await fetch('/api/admin/users', {
      method: editingId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    resetForm();
    load();
  };

  const deleteUser = async (userId: number) => {
    if (!window.confirm('确定删除这个用户？关联会话、收藏和追踪也会一起删除。')) return;
    await fetch(`/api/admin/users?id=${userId}`, { method: 'DELETE' });
    load();
  };

  if (loading) return <div className="text-gray-400">加载中...</div>;
  if (!data) return <div className="text-red-500">需要管理员权限。</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">注册用户看板</h1>
        <p className="text-sm text-gray-500 mt-1">查看并直接维护用户数据库：新增、编辑、重置密码、切换角色或删除用户。</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          ['总用户', data.summary.total_users, Users],
          ['管理员', data.summary.admins, Shield],
          ['普通用户', data.summary.normal_users, UserCog],
          ['已验证邮箱', data.summary.verified_users, Shield],
        ] as [string, number, LucideIcon][]).map(([label, value, Icon]) => (
          <div key={String(label)} className="bg-white border border-gray-100 rounded-lg p-5">
            <div className="flex items-center justify-between">
              <Icon className="w-5 h-5 text-ks-green" />
              <p className="text-2xl font-bold text-gray-900">{Number(value).toLocaleString()}</p>
            </div>
            <p className="text-sm font-semibold text-gray-700 mt-3">{String(label)}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-100 rounded-lg p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-800">{editingId ? '编辑用户' : '新增用户'}</h2>
            <p className="text-xs text-gray-400 mt-1">密码留空时，编辑用户不会修改原密码。</p>
          </div>
          {editingId && (
            <button onClick={resetForm} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50">
              <X className="h-3.5 w-3.5" />取消编辑
            </button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1fr_130px_120px_auto]">
          <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="用户名" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="邮箱" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
          <input value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={editingId ? '新密码（可选）' : '密码'} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" type="password" />
          <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value as 'admin' | 'user' })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <option value="user">普通用户</option>
            <option value="admin">管理员</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            <input type="checkbox" checked={!!form.email_verified} onChange={e => setForm({ ...form, email_verified: e.target.checked ? 1 : 0 })} className="accent-ks-green" />
            已验证
          </label>
          <button onClick={saveUser} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-ks-green px-4 py-2 text-sm font-bold text-white hover:bg-ks-green-dark">
            {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editingId ? '保存' : '新增'}
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">用户数据库</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-5 py-3 text-left">ID</th>
                <th className="px-5 py-3 text-left">用户</th>
                <th className="px-5 py-3 text-left">邮箱</th>
                <th className="px-5 py-3 text-left">角色</th>
                <th className="px-5 py-3 text-right">收藏</th>
                <th className="px-5 py-3 text-right">追踪</th>
                <th className="px-5 py-3 text-left">注册时间</th>
                <th className="px-5 py-3 text-left">会话过期</th>
                <th className="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.users.map(user => (
                <tr key={user.id}>
                  <td className="px-5 py-3 text-gray-400">{user.id}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{user.username}</td>
                  <td className="px-5 py-3 text-gray-600">{user.email ?? '-'}</td>
                  <td className="px-5 py-3">
                    <select
                      value={user.role}
                      onChange={e => setRole(user.id, e.target.value as 'admin' | 'user')}
                      className="border border-gray-200 rounded-md px-2 py-1 text-xs"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </td>
                  <td className="px-5 py-3 text-right">{user.favorites_count}</td>
                  <td className="px-5 py-3 text-right">{user.subscriptions_count}</td>
                  <td className="px-5 py-3 text-gray-500">{fmtDate(user.created_at)}</td>
                  <td className="px-5 py-3 text-gray-500">{fmtDate(user.session_expires_at)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => startEdit(user)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteUser(user.id)} className="rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
