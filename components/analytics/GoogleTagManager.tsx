'use client'

import Script from 'next/script'

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID

/**
 * Google Tag Manager — the ONLY analytics tag loaded in code.
 *
 * GA4 and every event/measurement tag are configured by the site owner inside
 * the GTM UI, keeping this container the single control point. Per the Stellr
 * privacy policy there are NO advertising, remarketing, or cross-site tracking
 * tags here (no Meta Pixel, no LinkedIn Insight, no Google Ads/Signals) — do not
 * add any. Analytics only, first-party, privacy-safe.
 *
 * The matching <noscript> iframe lives in app/layout.tsx (it must be the first
 * child of <body>). Renders nothing until NEXT_PUBLIC_GTM_ID is set, so the tag
 * stays dormant in any environment that hasn't opted in.
 */
export function GoogleTagManager() {
  if (!GTM_ID) return null

  return (
    <Script id="gtm-init" strategy="afterInteractive">
      {`
        (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
        new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
        j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
        'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
        })(window,document,'script','dataLayer','${GTM_ID}');
      `}
    </Script>
  )
}
