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

/** Bump when the meaning of a stored decision changes, to re-ask everyone. */
export const CONSENT_VERSION = 1

export const CONSENT_STORAGE_KEY = `stellr_consent_v${CONSENT_VERSION}`

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
