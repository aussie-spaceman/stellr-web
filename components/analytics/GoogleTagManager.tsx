'use client'

import Script from 'next/script'

const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID

/**
 * Google Tag Manager — the ONLY tag loaded in code.
 *
 * Every measurement and advertising tag (GA4, Google Ads, and Meta/LinkedIn as
 * they are added) is configured by the site owner inside the GTM UI, keeping
 * this container the single control point. Do not hardcode a pixel here: a tag
 * added in code bypasses the consent gating below and cannot be switched off
 * without a deploy.
 *
 * Consent: advertising tags MUST be set to require `ad_storage` in GTM.
 * components/analytics/ConsentMode.tsx denies that by default until the visitor
 * accepts, but Consent Mode only withholds what the tags themselves are
 * configured to check — the default is enforced in the container, not here.
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
