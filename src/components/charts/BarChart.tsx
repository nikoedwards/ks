'use client';

import {
  BarChart as RechartsBar,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface BarChartProps {
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; name: string; color: string }[];
  title?: string;
  yFormatter?: (v: number) => string;
  height?: number;
  layout?: 'vertical' | 'horizontal';
}

export default function BarChart({
  data,
  xKey,
  bars,
  title,
  yFormatter,
  height = 300,
  layout = 'horizontal',
}: BarChartProps) {
  const fmt = yFormatter ?? ((v: number) => v.toLocaleString());

  if (layout === 'vertical') {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        {title && <h3 className="font-semibold text-gray-700 mb-4">{title}</h3>}
        <ResponsiveContainer width="100%" height={height}>
          <RechartsBar data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey={xKey} tick={{ fontSize: 11 }} width={120} />
            <Tooltip formatter={(v: number) => fmt(v)} />
            <Legend />
            {bars.map(b => (
              <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[0, 3, 3, 0]} />
            ))}
          </RechartsBar>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
      {title && <h3 className="font-semibold text-gray-700 mb-4">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBar data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => fmt(v)} />
          <Legend />
          {bars.map(b => (
            <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[3, 3, 0, 0]} />
          ))}
        </RechartsBar>
      </ResponsiveContainer>
    </div>
  );
}
