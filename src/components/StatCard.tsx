interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}

export default function StatCard({ title, value, sub, accent = false }: StatCardProps) {
  return (
    <div className={`bg-white rounded-xl border p-5 shadow-sm ${accent ? 'border-l-4 border-l-ks-green border-gray-100' : 'border-gray-100'}`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
      <p className={`text-2xl font-bold mt-1.5 ${accent ? 'text-ks-green' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}
