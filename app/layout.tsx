import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import { Analytics } from '@vercel/analytics/react'
import { ConsentMode } from '@/components/analytics/ConsentMode'
import { CookieConsent } from '@/components/analytics/CookieConsent'
import { GoogleTagManager } from '@/components/analytics/GoogleTagManager'
import { HubSpotTracking } from '@/components/analytics/HubSpotTracking'
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/structured-data'
import '../styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'),
  title: {
    template: '%s | Stellr Education',
    default: 'Stellr Education — Real-World STEM Competitions',
  },
  description:
    'Stellr connects middle and high school students with industry professionals through high-tempo design competitions across the US.',
  openGraph: {
    siteName: 'Stellr Education',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

// Organization + WebSite JSON-LD, emitted on every page so the entity is
// declared once and referenced by @id from the Event/Article graphs.
// See lib/structured-data.ts.
const siteSchema = [buildOrganizationJsonLd(), buildWebSiteJsonLd()]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {/* Consent Mode v2 defaults — MUST stay above GTM so advertising tags
              never fire before the denied-by-default state lands. */}
          <ConsentMode />
          {/* Google Tag Manager — the single tag container (see GoogleTagManager.tsx) */}
          <GoogleTagManager />
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchema) }}
          />
        </head>
        <body>
          {/* Google Tag Manager (noscript) */}
          {process.env.NEXT_PUBLIC_GTM_ID && (
            <noscript>
              {/* eslint-disable-next-line @next/next/no-sync-scripts */}
              <iframe
                src={`https://www.googletagmanager.com/ns.html?id=${process.env.NEXT_PUBLIC_GTM_ID}`}
                height="0"
                width="0"
                style={{ display: 'none', visibility: 'hidden' }}
                title="Google Tag Manager"
              />
            </noscript>
          )}
          {children}
          <CookieConsent />
          <Analytics />
          {/* Sets the hubspotutk cookie the lead routes pass to the Forms API
              for source attribution (see lib/hubspot.ts). */}
          <HubSpotTracking />
        </body>
      </html>
    </ClerkProvider>
  )
}
