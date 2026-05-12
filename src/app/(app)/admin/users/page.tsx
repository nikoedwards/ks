'use client';

import { useEffect, useState } from 'react';
import { Shield, UserCog, Users, type LucideIcon } from 'lucide-react';

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

  if (loading) return <div className="text-gray-400">加载中...</div>;
  if (!data) return <div className="text-red-500">需要管理员权限。</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">注册用户看板</h1>
        <p className="text-sm text-gray-500 mt-1">查看平台注册用户、角色、收藏和追踪数据。</p>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
