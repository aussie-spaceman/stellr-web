'use client'

import { openConsentSettings } from '@/lib/consent'

/**
 * Footer link that reopens the consent banner.
 *
 * This exists for a compliance reason, not a cosmetic one: withdrawing consent
 * is expected to take comparable effort to giving it, and before this the only
 * route was "clear this site's data in your browser" — which is both harder
 * than one click and destroys the visitor's login session as a side effect.
 *
 * A button rather than a link because it changes state on the current page and
 * navigates nowhere; screen readers should announce it as an action.
 *
 * Note this governs *future* tag firing. Withdrawing does not unload a pixel
 * that already loaded on the current page — GTM re-checks consent each time a
 * tag fires, so nothing further is sent, and on the next page load the tags do
 * not load at all.
 */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openConsentSettings} className={className}>
      Cookie settings
    </button>
  )
}
