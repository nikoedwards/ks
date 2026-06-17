import AppShell from '@/components/AppShell';
import GoogleAnalyticsPageview from '@/components/GoogleAnalyticsPageview';
import PushModal from '@/components/PushModal';
import { AuthProvider } from '@/contexts/AuthContext';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <GoogleAnalyticsPageview measurementId="G-J06YFPTGV9" skipInitial />
      <AppShell>{children}</AppShell>
      <PushModal />
    </AuthProvider>
  );
}
