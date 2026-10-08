import { createHmac } from 'node:crypto'
import { safeStrEqual } from '@/lib/secret-compare'

// ── Event check-in: finding a participant at the door ────────────────────────
//
// CO, Oct 2026: many participants did not know which email they were registered
// under (a parent or teacher registered them), so the email-only lookup stalled
// the line. The door QR now matches on name + date of birth; email remains the
// fallback for a record with no usable DOB. Pure functions, so the matching
// rules are tested without a database.

export interface CheckInCandidate {
  id: string
  first_name: string
  last_name: string
  nickname: string | null
  date_of_birth: string | null
  email: string | null
}

/** Lowercase, accents and punctuation stripped: "O'Brien-Núñez" → "obriennunez". */
export function normaliseName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

// "Alex" finds "Alexander" and vice versa, but a 1–2 letter prefix is too loose
// to count. The registered nickname also matches.
function firstNameMatches(input: string, c: CheckInCandidate): boolean {
  const typed = normaliseName(input)
  if (!typed) return false
  return [c.first_name, c.nickname].some((n) => {
    const known = normaliseName(n)
    if (!known) return false
    if (known === typed) return true
    const [short, long] = known.length < typed.length ? [known, typed] : [typed, known]
    return short.length >= 3 && long.startsWith(short)
  })
}

function usableDob(dob: string | null): string | null {
  const d = dob?.slice(0, 10) ?? null
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
}

export type NameMatch<T extends CheckInCandidate = CheckInCandidate> =
  | { kind: 'match'; candidate: T }
  /** The name matched someone whose DOB can't be checked: ask for the email. */
  | { kind: 'need_email' }
  /** More than one person fits name and DOB: the desk sorts it out. */
  | { kind: 'ambiguous' }
  | { kind: 'none' }

export function matchByNameAndDob<T extends CheckInCandidate>(
  candidates: T[],
  input: { firstName: string; lastName: string; dob: string }
): NameMatch<T> {
  const last = normaliseName(input.lastName)
  if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(input.dob)) return { kind: 'none' }
  const named = candidates.filter((c) => normaliseName(c.last_name) === last && firstNameMatches(input.firstName, c))
  const hits = named.filter((c) => usableDob(c.date_of_birth) === input.dob)
  if (hits.length === 1) return { kind: 'match', candidate: hits[0] }
  if (hits.length > 1) return { kind: 'ambiguous' }
  if (named.some((c) => usableDob(c.date_of_birth) === null)) return { kind: 'need_email' }
  return { kind: 'none' }
}

export function matchByEmail<T extends CheckInCandidate>(candidates: T[], email: string): T | null {
  const e = email.trim().toLowerCase()
  if (!e) return null
  return candidates.find((c) => c.email?.trim().toLowerCase() === e) ?? null
}

// ── Remembering the participant on their phone ───────────────────────────────
//
// After a successful check-in the phone keeps a signed cookie, scoped to this
// event's check-in path, so re-scanning the QR or reopening the page goes
// straight to their page (Docs folder, survey) with no re-entry:
//
//   stellr_check_in = <participant id>.<base64url HMAC-SHA256(secret, "stellr-check-in|<slug>|<id>")>
//
// Nothing is stored server-side. With no secret configured the page still works,
// it just isn't remembered.

export const CHECK_IN_COOKIE = 'stellr_check_in'
/** Long enough to cover the survey, which closes 30 days after the event. */
export const CHECK_IN_COOKIE_MAX_AGE = 45 * 24 * 60 * 60

function secret(): string | null {
  const s = process.env.CREDENTIAL_LINK_SECRET || process.env.SURVEY_TOKEN_SECRET || process.env.ESIGN_TOKEN_SECRET
  return s && s.length >= 32 ? s : null
}

export function checkInCookiePath(slug: string): string {
  return `/check-in/${slug}`
}

export function signCheckIn(slug: string, participantId: string): string | null {
  const s = secret()
  if (!s) return null
  const sig = createHmac('sha256', s).update(`stellr-check-in|${slug}|${participantId}`).digest('base64url')
  return `${participantId}.${sig}`
}

/** The participant id the cookie vouches for, or null. Constant-time compare. */
export function verifyCheckIn(slug: string, value: string | null | undefined): string | null {
  if (!value) return null
  const dot = value.indexOf('.')
  if (dot < 1) return null
  const id = value.slice(0, dot)
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const expected = signCheckIn(slug, id)
  return expected && safeStrEqual(value, expected) ? id : null
}
