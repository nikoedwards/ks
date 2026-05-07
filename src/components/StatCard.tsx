interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  color?: 'blue' | 'green' | 'amber' | 'purple' | 'red';
  icon?: React.ReactNode;
}

const colorMap = {
  blue: 'bg-blue-50 text-blue-700 border-blue-100',
  green: 'bg-green-50 text-green-700 border-green-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  red: 'bg-red-50 text-red-700 border-red-100',
};

export default function StatCard({ title, value, sub, color = 'blue', icon }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-75">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
        </div>
        {icon && <div className="opacity-40 text-2xl">{icon}</div>}
      </div>
    </div>
  );
}
