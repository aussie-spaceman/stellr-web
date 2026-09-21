import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { agreementExpiry } from '@/lib/docusign-agreements'
import {
  CREDENTIAL_COLUMNS,
  canShare,
  isMinorOn,
  normaliseCredentialNumber,
  type CredentialRow,
  type CredentialSource,
  type CredentialTheme,
  type CredentialVisibility,
  type CredentialEventKind,
  type ShareConsent,
  type ShareBlock,
} from '@/lib/credentials-core'

export * from '@/lib/credentials-core'

// ── Verifiable credentials: database side ────────────────────────────────────
// Issue, revoke, visibility, consent lookups and reads. The pure helpers live
// in lib/credentials-core.ts so the edge routes can use them.
// Design: docs/PLAN-credentials-linkedin-2026-09-21.md.

// ── Numbers ──────────────────────────────────────────────────────────────────

// Crockford base32: no I, L, O or U, so the number survives being read aloud
// or typed from a printed CV.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * STL-2026-7K3MQ8ZD. 8 chars of base32 = 40 bits. The legacy certificate
 * format (STL-2026-XXXXXX, 6 hex = 24 bits) was enumerable; pages default to
 * private so a guessed number shows "private", not a name, but new issues
 * should not rely on that.
 */
export function generateCredentialNumber(now = new Date()): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += CROCKFORD[bytes[i] % 32]
  return `STL-${now.getFullYear()}-${out}`
}

// ── Minor sharing consent (D1, 21 Sept 2026: opt-out) ────────────────────────

/**
 * Whether a minor's guardian has consented to a public credential page.
 *
 * The parental consent form reads as the guardian opting the child IN unless
 * they note otherwise, so: a valid, completed minor envelope grants unless its
 * `credential_sharing_opt_out` is set. Coverage rows (`reused_from`) defer to
 * the envelope they reuse, the same way findValidAgreement does. No valid
 * envelope at all → 'none' — a student with no signed consent is not one we
 * publish, whatever the default says.
 */
export async function consentForMinor(
  db: SupabaseClient,
  who: { memberId: string | null; participantId: string | null },
  now = new Date(),
): Promise<Exclude<ShareConsent, 'not_required'>> {
  if (!who.memberId && !who.participantId) return 'none'

  const filters = [
    who.memberId ? `member_id.eq.${who.memberId}` : null,
    who.participantId ? `participant_id.eq.${who.participantId}` : null,
  ].filter(Boolean).join(',')

  const { data } = await db
    .from('docusign_envelopes')
    .select('id, completed_at, credential_sharing_opt_out, reused_from')
    .or(filters)
    .eq('envelope_type', 'minor')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.completed_at) return 'none'
  if (agreementExpiry(data.completed_at) < now) return 'none'

  let optOut = Boolean(data.credential_sharing_opt_out)
  if (data.reused_from) {
    const { data: root } = await db
      .from('docusign_envelopes')
      .select('credential_sharing_opt_out')
      .eq('id', data.reused_from)
      .maybeSingle()
    optOut = optOut || Boolean(root?.credential_sharing_opt_out)
  }
  return optOut ? 'declined' : 'granted'
}

export async function shareConsentFor(db: SupabaseClient, c: CredentialRow): Promise<ShareConsent> {
  if (!c.is_minor) return 'not_required'
  return consentForMinor(db, { memberId: c.member_id, participantId: c.participant_id })
}

// ── Issue / revoke / visibility ──────────────────────────────────────────────

export interface IssueInput {
  source: CredentialSource
  memberId?: string | null
  participantId?: string | null
  moduleId?: string | null
  eventSlug?: string | null
  recipient: { firstName: string; lastName: string; dateOfBirth: string | null }
  title: string
  description?: string | null
  criteria?: string | null
  skills?: string[]
  issuer?: string
  roleLabel?: string | null
  award?: string | null
  theme?: CredentialTheme | null
  expiresAt?: string | null
}

/**
 * Idempotent on the partial unique indexes (member+course, participant+event):
 * a re-run returns the existing row with `created: false`. A concurrent first
 * issue is treated the same way — the unique violation is the signal.
 */
export async function issueCredential(
  db: SupabaseClient,
  input: IssueInput,
): Promise<{ row: CredentialRow; created: boolean }> {
  const existing = await findExisting(db, input)
  if (existing) return { row: existing, created: false }

  const insert = {
    number:         generateCredentialNumber(),
    source:         input.source,
    member_id:      input.memberId ?? null,
    participant_id: input.participantId ?? null,
    module_id:      input.moduleId ?? null,
    event_slug:     input.eventSlug ?? null,
    recipient_name: `${input.recipient.firstName} ${input.recipient.lastName}`.trim(),
    title:          input.title,
    description:    input.description ?? null,
    criteria:       input.criteria ?? null,
    skills:         input.skills ?? [],
    issuer:         input.issuer ?? 'Stellr Education',
    role_label:     input.roleLabel ?? null,
    award:          input.award ?? null,
    theme:          input.theme ?? null,
    expires_at:     input.expiresAt ?? null,
    is_minor:       isMinorOn(input.recipient.dateOfBirth),
  }

  const { data, error } = await db
    .from('credentials')
    .insert(insert)
    .select(CREDENTIAL_COLUMNS)
    .single()

  if (error) {
    // Unique violation = a concurrent request issued it first.
    if (String(error.message).includes('duplicate') || error.code === '23505') {
      const again = await findExisting(db, input)
      if (again) return { row: again, created: false }
    }
    throw new Error(`[credentials] issue failed: ${error.message}`)
  }
  return { row: data as CredentialRow, created: true }
}

async function findExisting(db: SupabaseClient, input: IssueInput): Promise<CredentialRow | null> {
  let q = db.from('credentials').select(CREDENTIAL_COLUMNS).eq('source', input.source)
  if (input.source === 'course') {
    if (!input.memberId || !input.moduleId) throw new Error('[credentials] course credential needs memberId + moduleId')
    q = q.eq('member_id', input.memberId).eq('module_id', input.moduleId)
  } else if (input.source === 'event') {
    if (!input.participantId || !input.eventSlug) throw new Error('[credentials] event credential needs participantId + eventSlug')
    q = q.eq('participant_id', input.participantId).eq('event_slug', input.eventSlug)
  } else {
    return null
  }
  const { data } = await q.maybeSingle()
  return (data as CredentialRow | null) ?? null
}

export async function revokeCredential(
  db: SupabaseClient,
  id: string,
  reason: string,
  revokedBy: string | null,
): Promise<CredentialRow | null> {
  const { data } = await db
    .from('credentials')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
      revoked_by: revokedBy,
      // Visibility is left as it was: a credential that was public when it was
      // revoked must keep answering "Revoked" at the URL already on LinkedIn.
      // Setting it private would turn the verifier's answer into "private".
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'issued')
    .select(CREDENTIAL_COLUMNS)
    .maybeSingle()
  return (data as CredentialRow | null) ?? null
}

/**
 * Making a credential public is the earner's choice, gated by canShare().
 * Callers resolve consent first; this refuses rather than trusting them.
 */
export async function setVisibility(
  db: SupabaseClient,
  c: CredentialRow,
  visibility: CredentialVisibility,
  consent: ShareConsent,
): Promise<{ ok: true; row: CredentialRow } | { ok: false; reason: ShareBlock }> {
  if (visibility === 'public') {
    const check = canShare(c, consent)
    if (!check.ok) return check
  }
  const { data } = await db
    .from('credentials')
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq('id', c.id)
    .select(CREDENTIAL_COLUMNS)
    .single()
  return { ok: true, row: data as CredentialRow }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface CredentialView extends CredentialRow {
  /** From the linked member or participant; used for the LinkedIn age gate. */
  date_of_birth: string | null
}

export async function getCredentialByNumber(db: SupabaseClient, number: string): Promise<CredentialView | null> {
  const n = normaliseCredentialNumber(number)
  if (!n) return null
  const { data, error } = await db
    .from('credentials')
    .select(`${CREDENTIAL_COLUMNS}, members!credentials_member_id_fkey(date_of_birth), participants(date_of_birth)`)
    .eq('number', n)
    .maybeSingle()
  if (error) console.error('[credentials] lookup failed:', error.message)
  if (!data) return null
  return withDob(data as Record<string, unknown>)
}

export async function listMemberCredentials(db: SupabaseClient, memberId: string): Promise<CredentialView[]> {
  const { data } = await db
    .from('credentials')
    .select(`${CREDENTIAL_COLUMNS}, members!credentials_member_id_fkey(date_of_birth), participants(date_of_birth)`)
    .eq('member_id', memberId)
    .is('tombstoned_at', null)
    .order('issued_at', { ascending: false })
  return ((data ?? []) as Record<string, unknown>[]).map(withDob)
}

function withDob(row: Record<string, unknown>): CredentialView {
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { date_of_birth?: string | null } | null
  const { members, participants, ...rest } = row
  const dob = one(members)?.date_of_birth ?? one(participants)?.date_of_birth ?? null
  return { ...(rest as unknown as CredentialRow), date_of_birth: dob }
}

// ── Telemetry ────────────────────────────────────────────────────────────────

/** Fire-and-forget; never let a stats write break a page or a share. */
export async function recordCredentialEvent(db: SupabaseClient, credentialId: string, kind: CredentialEventKind): Promise<void> {
  const { error } = await db.from('credential_events').insert({ credential_id: credentialId, kind })
  if (error) console.error('[credentials] event write failed:', error.message)
}

// ── Erasure ──────────────────────────────────────────────────────────────────

/**
 * Right-to-erasure hook, called from lib/deletion before the person's row goes.
 * The number keeps resolving — a verifier holding a CV gets "withdrawn", not a
 * 404 that looks like a forgery — but the name is gone and the page is private.
 * Runs before the FK nulls the link, or the rows could not be found.
 */
export async function tombstoneCredentialsFor(
  db: SupabaseClient,
  who: 'member' | 'participant',
  id: string,
): Promise<number> {
  const col = who === 'member' ? 'member_id' : 'participant_id'
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('credentials')
    .update({ tombstoned_at: now, recipient_name: '', visibility: 'private', updated_at: now })
    .eq(col, id)
    .is('tombstoned_at', null)
    .select('id')
  if (error) console.error('[credentials] tombstone failed:', error.message)
  return data?.length ?? 0
}
