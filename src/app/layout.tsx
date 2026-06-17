import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import GoogleAnalyticsPageview from '@/components/GoogleAnalyticsPageview';

const GA_MEASUREMENT_ID = 'G-J06YFPTGV9';

export const metadata: Metadata = {
  title: 'Kicksonar — Track What Funds. Launch What Works.',
  description: 'Explore 200,000+ Kickstarter campaigns. Uncover funding patterns, benchmark your idea, and back the projects that matter.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            window.gtag = window.gtag || function(){window.dataLayer.push(arguments);}
            window.gtag('js', new Date());
            window.gtag('config', '${GA_MEASUREMENT_ID}', { send_page_view: false });
          `}
        </Script>
        <GoogleAnalyticsPageview measurementId={GA_MEASUREMENT_ID} />
        {children}
      </body>
    </html>
  );
}
