import { credentialUrl, type CredentialRow } from '@/lib/credentials-core'

// ── LinkedIn sharing ─────────────────────────────────────────────────────────
// Two links, nothing more. LinkedIn has no API for writing to a member's
// profile; every credential platform (Credly, Accredible, Sertifier) does
// exactly this.
//
//  • Add to profile — opens the Licenses & certifications form with the fields
//    prefilled. LinkedIn's help page says prefill is being retired in favour of
//    a static URL; the builders in the wild still document it working. The UI
//    shows a "copy these details" panel beside the button so the flow survives
//    either way.
//  • Share — the feed composer with the credential page attached. What shows
//    is the page's OG card, so the card is where the badge lives.
//
// Nothing here is age-gated; callers check canUseLinkedIn() (16+) first.

const ORGANIZATION_NAME = 'Stellr Education'

/**
 * The numeric ID of Stellr's LinkedIn Page, from its admin URL
 * (linkedin.com/company/<id>/admin/). With it, the profile entry links to the
 * Page (logo, auto-tag on share); without it the entry carries the name only.
 * Read at call time so a missing value in one environment never fails a build.
 */
function organizationId(): string | null {
  const v = (process.env.LINKEDIN_ORGANIZATION_ID ?? '').trim()
  return /^\d+$/.test(v) ? v : null
}

let warnedMissingOrg = false

export function linkedInAddToProfileUrl(
  c: Pick<CredentialRow, 'number' | 'title' | 'issued_at' | 'expires_at'>,
): string {
  const issued = new Date(c.issued_at)
  const params = new URLSearchParams({
    startTask:  'CERTIFICATION_NAME',
    name:       c.title,
    issueYear:  String(issued.getUTCFullYear()),
    issueMonth: String(issued.getUTCMonth() + 1),
    certId:     c.number,
    certUrl:    credentialUrl(c.number),
  })
  if (c.expires_at) {
    const exp = new Date(c.expires_at)
    params.set('expirationYear', String(exp.getUTCFullYear()))
    params.set('expirationMonth', String(exp.getUTCMonth() + 1))
  }
  const org = organizationId()
  if (org) {
    params.set('organizationId', org)
  } else {
    params.set('organizationName', ORGANIZATION_NAME)
    if (!warnedMissingOrg) {
      warnedMissingOrg = true
      console.warn('[linkedin] LINKEDIN_ORGANIZATION_ID unset — profile entries will not link to the Stellr Page')
    }
  }
  return `https://www.linkedin.com/profile/add?${params.toString()}`
}

export function linkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`
}

/** The fields a member types by hand if prefill does not fire. */
export function linkedInManualDetails(c: Pick<CredentialRow, 'number' | 'title' | 'issued_at' | 'expires_at' | 'issuer'>) {
  const issued = new Date(c.issued_at)
  const month = issued.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
  return {
    name:         c.title,
    organization: ORGANIZATION_NAME,
    issueDate:    `${month} ${issued.getUTCFullYear()}`,
    credentialId: c.number,
    credentialUrl: credentialUrl(c.number),
  }
}
