'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pushDataLayer } from '@/lib/analytics'
import { CONSENT_NEEDED_ATTR, CONSENT_OPEN_EVENT, applyConsent, readConsent, writeConsent } from '@/lib/consent'
import { noAdsActive } from '@/lib/no-ads'

/**
 * Cookie consent banner, gating advertising tags only.
 *
 * Deliberately not a blocking modal: the audience includes students reaching a
 * competition page from a teacher's link, and a full-screen interstitial
 * between them and registration information is a worse outcome than a dismissible
 * bar. Declining is one click and is not hidden behind a "manage preferences"
 * screen — a decline that costs more effort than an accept is not a real choice.
 *
 * Rendered on the server and hidden by CSS until the head script
 * (ConsentMode.tsx) finds no stored choice, so a first-time visitor sees it at
 * first paint, not after hydration on a slow phone. The denied-by-default
 * Consent Mode state is applied by that script either way.
 */
export function CookieConsent() {
  /** Reopened from the footer link (otherwise CSS decides whether it shows). */
  const [open, setOpen] = useState(false)
  /** No stored choice. null until mounted: before hydration CSS decides. */
  const [needed, setNeeded] = useState<boolean | null>(null)
  /** The stored choice, when the banner was reopened rather than shown cold. */
  const [current, setCurrent] = useState<boolean | null>(null)

  useEffect(() => {
    const stored = readConsent()
    if (stored) {
      // Replay so Consent Mode reflects the stored choice on this page load.
      // ConsentMode.tsx already did this inline for the accept case; repeating
      // it is idempotent and also covers a decline written by an older version.
      applyConsent(stored.ads)
      setNeeded(false)
    } else {
      setNeeded(true)
      // Covers a client-side mount, and storage the head script couldn't read.
      document.documentElement.setAttribute(CONSENT_NEEDED_ATTR, '')
    }

    // The footer link reopens the banner at any time. Withdrawing has to be as
    // easy as giving — telling people to clear their browser data is not that.
    function reopen() {
      setCurrent(readConsent()?.ads ?? null)
      setOpen(true)
    }
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
  }, [])

  function decide(ads: boolean) {
    writeConsent(ads)
    applyConsent(ads)

    // A Consent Mode update alone does not start a third-party tag that was
    // already blocked. Google's own tags re-fire on the update; a GTM Custom
    // HTML tag hangs off a Page View trigger that has already passed, so it
    // stays dormant. Verified in production: accepting on /educators granted
    // ad_storage and brought Google Ads back immediately, while the LinkedIn
    // Insight Tag did not load at all.
    //
    // That is worse than one missed page here, because in-site navigation is
    // client-side and fires no further Page View triggers — so a visitor who
    // accepts on their first page can go a whole session untracked. This event
    // gives those tags a trigger to attach to at the moment consent arrives.
    //
    // Pushed after applyConsent so GTM has already processed the consent update
    // by the time the tag is evaluated; the reverse order would re-block it.
    //
    // Not on a student page or in a student's browser: nothing was granted
    // there (applyConsent refuses), so no tag may be woken (§9.4).
    if (ads && !noAdsActive()) pushDataLayer({ event: 'consent_granted' })

    document.documentElement.removeAttribute(CONSENT_NEEDED_ATTR)
    setOpen(false)
    setNeeded(false)
  }

  // Before hydration, CSS (globals.css) shows it while <html> carries
  // CONSENT_NEEDED_ATTR; once mounted, `hidden` follows the stored choice and
  // the footer link (data-open). Compact on phones: a short block of text and
  // two 44px buttons side by side, never more than half the screen, and above
  // the app's tab bar (--tabbar-h) rather than over it.
  return (
    <div
      data-cookie-banner=""
      data-open={open ? '' : undefined}
      hidden={needed === null ? undefined : !(needed || open)}
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-[var(--tabbar-h,0px)] z-50 max-h-[50svh] overflow-y-auto overscroll-contain border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:py-4 short:py-2">
        <p className="text-xs leading-snug text-content-body sm:text-sm sm:leading-5 short:text-xs short:leading-4">
          We use essential and analytics cookies to run this site. With your
          permission we&apos;d also use advertising cookies to measure our
          campaigns.{' '}
          <Link href="/privacy" className="underline hover:no-underline">
            Read our privacy policy
          </Link>
          .
          {current !== null && (
            // Reopened from the footer: say what is currently set, so the
            // choice on offer is a change rather than a guess.
            <span className="mt-1 block font-semibold text-ink">
              Advertising cookies are currently {current ? 'on' : 'off'}.
            </span>
          )}
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => decide(false)}
            className="min-h-11 flex-1 rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold text-ink hover:bg-surface sm:flex-none"
          >
            Essential only
          </button>
          <button type="button" onClick={() => decide(true)} className="btn-primary min-h-11 flex-1 whitespace-nowrap py-0 sm:flex-none">
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}
