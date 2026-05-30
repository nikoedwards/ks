import Sidebar from '@/components/Sidebar';
import PushModal from '@/components/PushModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
      <PushModal />
    </div>
  );
}
