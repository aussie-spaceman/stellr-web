import type { Metadata, Viewport } from 'next'
import { ConsentMode } from '@/components/analytics/ConsentMode'
import { SiteTracking } from '@/components/analytics/SiteTracking'
import { Toaster } from '@/components/ui/Toast'
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from '@/lib/structured-data'
import { fontVariables } from '@/lib/fonts'
import { tokens } from '@/lib/tokens'
import '../styles/tokens.css'
import '../styles/globals.css'

/* Default social card. Without it every share preview came back blank — the
   twitter:card was already summary_large_image with no image to fill it.
   Pages that want their own image override `openGraph.images`. */
const OG_IMAGE = {
  url: '/images/og-default.jpg',
  width: 1200,
  height: 630,
  alt: 'Stellr Education — real-world STEM design competitions for students',
}

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
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    images: [OG_IMAGE.url],
  },
  // "Add to Home Screen" on an iPhone opens the app full-screen under the
  // brand colour instead of as a browser bookmark.
  appleWebApp: { capable: true, title: 'Stellr', statusBarStyle: 'default' },
  // Search Console / Bing Webmaster ownership tags. Env-driven so the tokens
  // live with the other per-environment config, and emitted only when set —
  // the dev project must not claim ownership of the production property.
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
    other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { 'msvalidate.01': process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
      : undefined,
  },
}

// Zoom stays enabled (no maximumScale / userScalable). `viewportFit: cover`
// lets env(safe-area-inset-*) report the iPhone's notch and home indicator, so
// the fixed tab bars and banners can clear them; body keeps page content inside
// the side insets (styles/globals.css). The browser chrome takes the midnight
// brand colour.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: tokens.color.midnight,
}

// Organization + WebSite JSON-LD, emitted on every page so the entity is
// declared once and referenced by @id from the Event/Article graphs.
// See lib/structured-data.ts.
const siteSchema = [buildOrganizationJsonLd(), buildWebSiteJsonLd()]

/**
 * The root layout reads nothing from the request, so pages beneath it can be
 * prerendered and served from the CDN. Two things that used to need the
 * request now happen elsewhere:
 *   - private-link pages load no tags: decided in the browser by SiteTracking
 *     from lib/private-routes;
 *   - Clerk: each group that needs it ((member), (admin), (auth), register)
 *     has its own ClerkProvider, so the public site ships no Clerk code to
 *     anonymous visitors.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the head consent script may add
    // data-consent-needed to <html> before React hydrates.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Consent Mode v2 defaults — MUST stay above GTM so advertising tags
            never fire before the denied-by-default state lands. Not a tag: it
            sets defaults on the dataLayer and makes no request. */}
        <ConsentMode />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteSchema) }} />
      </head>
      <body>
        {/* Keyboard users skip the header's 30-odd links. Every layout's
            <main> carries id="main". */}
        <a
          href="#main"
          className="sr-only z-[70] rounded-control bg-white px-4 py-3 font-semibold text-ink shadow-lg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        {children}
        <SiteTracking />
        {/* Toasts from anywhere in the app (admin included). */}
        <Toaster />
      </body>
    </html>
  )
}
