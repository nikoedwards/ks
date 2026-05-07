'use client';

import { PieChart as RechartsPie, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PieData {
  name: string;
  value: number;
  color?: string;
}

const COLORS = ['#10B981', '#EF4444', '#3B82F6', '#F59E0B', '#8B5CF6', '#14B8A6', '#F97316'];

export default function PieChart({ data, title }: { data: PieData[]; title?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      {title && <h3 className="font-semibold text-gray-700 mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={280}>
        <RechartsPie>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color ?? COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => value.toLocaleString()}
          />
          <Legend />
        </RechartsPie>
      </ResponsiveContainer>
    </div>
  );
}
