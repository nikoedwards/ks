import AppShell from '@/components/AppShell';
import PushModal from '@/components/PushModal';
import { AuthProvider } from '@/contexts/AuthContext';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
      <PushModal />
    </AuthProvider>
  );
}
