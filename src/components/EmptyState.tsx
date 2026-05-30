import Link from 'next/link';

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center">
      <div className="text-6xl mb-4">📊</div>
      <h2 className="text-2xl font-bold text-gray-700 mb-2">暂无数据</h2>
      <p className="text-gray-500 mb-6 max-w-md">
        数据库为空，请先同步 Kickstarter 数据集。
        数据来自 webrobots.io，约 100MB（压缩），解压后约 600MB。
      </p>
      <Link
        href="/data-quality"
        className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        前往数据质量
      </Link>
    </div>
  );
}
