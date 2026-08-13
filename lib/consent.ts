// ── Consent state ────────────────────────────────────────────────────────────
// Shared between the pre-GTM default script and the banner. Consent is a
// *browser* fact, not a server one, so it lives in localStorage and is replayed
// into Google Consent Mode on every page load — a consent update is per-page
// and does not persist across navigations on its own.
//
// Scope: this gates advertising tags only (Google Ads, and Meta/LinkedIn once
// they exist). Analytics and the HubSpot tracking cookie are first-party,
// aggregate, and disclosed in the privacy policy, so they are not gated outside
// the EEA/UK/CH — see CONSENT_DEFAULT below for why that distinction is drawn
// where it is.

/**
 * EEA + UK + Switzerland: prior consent required for analytics too, not just
 * advertising.
 *
 * Google's tags receive this list through Consent Mode's `region` parameter and
 * enforce it themselves. Anything that is not a Google tag — the HubSpot
 * tracking script — has no such mechanism, so it must be gated by us against
 * the same list. Shared from here so the two cannot drift: a country added for
 * Google but missed for HubSpot would be a silent compliance gap.
 */
export const STRICT_REGIONS = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'NL', 'NO', 'PL',
  'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH',
]

/**
 * Whether a visitor's country requires prior consent for analytics.
 *
 * An unknown country returns false, matching the Consent Mode defaults above:
 * the non-strict default is the one that applies when no region matches. Geo
 * is absent in local dev and on non-Vercel hosts, so failing the other way
 * would silently disable tracking everywhere it cannot be determined.
 */
export function isStrictRegion(country: string | null | undefined): boolean {
  if (!country) return false
  return STRICT_REGIONS.includes(country.toUpperCase())
}

/** Bump when the meaning of a stored decision changes, to re-ask everyone. */
export const CONSENT_VERSION = 1

export const CONSENT_STORAGE_KEY = `stellr_consent_v${CONSENT_VERSION}`

/**
 * Dispatched by the footer link to reopen the banner. A DOM event rather than
 * shared React state because the two components sit in different trees — the
 * footer is rendered server-side inside the page, the banner lives in the root
 * layout — and threading a context provider around the whole app to carry one
 * boolean would be the larger change.
 */
export const CONSENT_OPEN_EVENT = 'stellr:open-consent'

/**
 * Reopen the consent banner. Exists so withdrawing consent is as easy as
 * giving it: the UK/EEA expectation is that the two take comparable effort, and
 * "clear your browser data" does not meet that.
 */
export function openConsentSettings(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT))
}

export interface ConsentDecision {
  /** Advertising / remarketing tags. */
  ads: boolean
  /** ISO timestamp of the decision, so an audit can show when it was given. */
  decidedAt: string
}

export type ConsentSignal = 'granted' | 'denied'

/**
 * Read the stored decision. Returns null when the visitor has not chosen yet
 * (banner should show) or when storage is unavailable — treating an unreadable
 * store as "no consent" is the safe direction.
 */
export function readConsent(): ConsentDecision | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ConsentDecision>
    if (typeof parsed?.ads !== 'boolean') return null
    return { ads: parsed.ads, decidedAt: parsed.decidedAt ?? '' }
  } catch {
    return null
  }
}

/** Persist a decision. Best-effort: private mode just means we ask again. */
export function writeConsent(ads: boolean): ConsentDecision {
  const decision: ConsentDecision = { ads, decidedAt: new Date().toISOString() }
  try {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(decision))
  } catch {
    /* storage unavailable — the banner reappears next visit */
  }
  return decision
}

/**
 * Push a Consent Mode v2 update. Uses the `gtag` shim installed by
 * ConsentMode.tsx; falls back to a raw dataLayer push if that script somehow
 * did not run, since the argument shape is identical.
 */
export function applyConsent(ads: boolean): void {
  if (typeof window === 'undefined') return
  const signal: ConsentSignal = ads ? 'granted' : 'denied'
  const update = {
    ad_storage: signal,
    ad_user_data: signal,
    ad_personalization: signal,
    // Granting ads implies the visitor accepted cookies generally, which also
    // settles analytics for the regions where it defaulted to denied.
    ...(ads ? { analytics_storage: 'granted' as ConsentSignal } : {}),
  }

  const w = window as unknown as { gtag?: (...args: unknown[]) => void; dataLayer?: unknown[] }
  if (typeof w.gtag === 'function') {
    w.gtag('consent', 'update', update)
  } else {
    w.dataLayer = w.dataLayer || []
    w.dataLayer.push(['consent', 'update', update])
  }
}
