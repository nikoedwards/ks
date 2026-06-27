import type { Metadata } from 'next';
import Script from 'next/script';
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from '@/lib/seo';
import './globals.css';

const GA_MEASUREMENT_ID = 'G-J06YFPTGV9';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Kicksonar — Track What Funds. Launch What Works.',
  description: SITE_DESCRIPTION,
  icons: { icon: '/favicon.svg' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
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
            window.gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>
        {children}
      </body>
    </html>
  );
}
