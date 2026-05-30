import AppShell from '@/components/AppShell';
import PushModal from '@/components/PushModal';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppShell>{children}</AppShell>
      <PushModal />
    </>
  );
}
