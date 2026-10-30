import { createHmac } from 'node:crypto'
import { safeStrEqual } from '@/lib/secret-compare'
import { SITE_URL } from '@/lib/env'
import { checkInSecret } from '@/lib/check-in'
import { parseCheckInCode, type CheckInCodeKind } from '@/lib/check-in-desk'

// ── Check-in codes: one QR per participant, one per school group ─────────────
//
// Oct 2026: the desk scans a code instead of searching a name. A participant's
// code checks them in; a group's code opens that group's check-in list. Codes go
// in confirmation emails, on the teacher's "Your group" page and on badges.
//
//   <kind>.<uuid>.<first 22 chars of base64url HMAC-SHA256(secret, "stellr-check-in-code|<slug>|<kind>|<uuid>")>
//
// kind is "p" (participants.id) or "g" (registrations.id). Signed, so a code
// can't be made from an id, and tied to one event. The QR holds a link to the
// code page (codeUrl), so a phone camera that scans one shows the code instead
// of nothing; the desk scanner reads the code out of the link.

const SIG_LENGTH = 22

function sign(slug: string, kind: CheckInCodeKind, id: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`stellr-check-in-code|${slug}|${kind}|${id}`)
    .digest('base64url')
    .slice(0, SIG_LENGTH)
}

/** The code for a participant ("p") or group registration ("g"), or null with no secret configured. */
export function signCheckInCode(slug: string, kind: CheckInCodeKind, id: string): string | null {
  const secret = checkInSecret()
  if (!secret) return null
  return `${kind}.${id}.${sign(slug, kind, id, secret)}`
}

/** What a code vouches for at this event, or null. Constant-time compare. */
export function verifyCheckInCode(slug: string, code: string | null | undefined): { kind: CheckInCodeKind; id: string } | null {
  const parsed = parseCheckInCode(code)
  const secret = checkInSecret()
  if (!parsed || !secret) return null
  const expected = `${parsed.kind}.${parsed.id}.${sign(slug, parsed.kind, parsed.id, secret)}`
  return safeStrEqual(code as string, expected) ? { kind: parsed.kind, id: parsed.id } : null
}

export function checkInCodePath(slug: string, code: string): string {
  return `/check-in/${slug}/code?c=${encodeURIComponent(code)}`
}

/** The link a code's QR holds and its email button opens. */
export function checkInCodeUrl(slug: string, code: string): string {
  return `${SITE_URL}${checkInCodePath(slug, code)}`
}

/** The code page link for one participant or group, or null with no secret configured. */
export function checkInCodeLink(slug: string, kind: CheckInCodeKind, id: string): string | null {
  const code = signCheckInCode(slug, kind, id)
  return code ? checkInCodeUrl(slug, code) : null
}
