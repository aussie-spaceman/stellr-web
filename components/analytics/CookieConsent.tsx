'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { pushDataLayer } from '@/lib/analytics'
import { CONSENT_OPEN_EVENT, applyConsent, readConsent, writeConsent } from '@/lib/consent'

/**
 * Cookie consent banner, gating advertising tags only.
 *
 * Deliberately not a blocking modal: the audience includes students reaching a
 * competition page from a teacher's link, and a full-screen interstitial
 * between them and registration information is a worse outcome than a dismissible
 * bar. Declining is one click and is not hidden behind a "manage preferences"
 * screen — a decline that costs more effort than an accept is not a real choice.
 *
 * Renders nothing until mounted, so the server HTML and first client render
 * agree; the banner appearing a beat late is fine, because ConsentMode.tsx has
 * already applied the denied-by-default state before GTM loaded.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false)
  /** The stored choice, when the banner was reopened rather than shown cold. */
  const [current, setCurrent] = useState<boolean | null>(null)

  useEffect(() => {
    const stored = readConsent()
    if (stored) {
      // Replay so Consent Mode reflects the stored choice on this page load.
      // ConsentMode.tsx already did this inline for the accept case; repeating
      // it is idempotent and also covers a decline written by an older version.
      applyConsent(stored.ads)
    } else {
      setVisible(true)
    }

    // The footer link reopens the banner at any time. Withdrawing has to be as
    // easy as giving — telling people to clear their browser data is not that.
    function reopen() {
      setCurrent(readConsent()?.ads ?? null)
      setVisible(true)
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
    if (ads) pushDataLayer({ event: 'consent_granted' })

    setVisible(false)
  }

  if (!visible) return null

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-brand-grey-mid">
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
            <span className="mt-1 block font-semibold text-brand-blue-dark">
              Advertising cookies are currently {current ? 'on' : 'off'}.
            </span>
          )}
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => decide(false)}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:bg-brand-grey-light"
          >
            Essential only
          </button>
          <button type="button" onClick={() => decide(true)} className="btn-primary whitespace-nowrap">
            Accept all
          </button>
        </div>
      </div>
    </div>
  )
}
