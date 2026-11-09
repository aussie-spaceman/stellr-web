import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SITE_URL } from '@/lib/env'

// One-time links for the other signer on a two-person form (lib/esign/email-changes.ts).
//
// The token is 32 random bytes; only its SHA-256 is stored, so a database read
// never yields a working link. A link works once, for one signer on one form
// and one action, and expires after LINK_TTL_DAYS or as soon as the form is
// signed, cancelled or corrected (checked when it is used). It sits in the URL
// fragment, as the signing link does, so it never reaches a server log.

export const LINK_TTL_DAYS = 7

export type ChangeLinkKind = 'direct' | 'suggestion'

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function changeLinkUrl(token: string): string {
  return `${SITE_URL}/sign/email#${token}`
}

/** A token as it appears in a link: 43 base64url characters. Anything else is refused unread. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

/**
 * Creates a one-time link for `requestedBy` to act on a bounced signer, and
 * supersedes any earlier link for that signer that was never used.
 */
export async function createChangeLink(
  db: SupabaseClient,
  input: {
    agreementId: string
    recipientId: string
    roleName: string | null
    oldEmail: string
    kind: ChangeLinkKind
    requestedByRole: string | null
    requestedByEmail: string
    now?: Date
  },
): Promise<{ token: string; expiresAt: Date }> {
  const now = input.now ?? new Date()
  await db
    .from('agreement_email_changes')
    .update({ status: 'superseded', updated_at: now.toISOString() })
    .eq('agreement_id', input.agreementId)
    .eq('recipient_id', input.recipientId)
    .eq('status', 'link_sent')

  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000)
  const { error } = await db.from('agreement_email_changes').insert({
    agreement_id: input.agreementId,
    recipient_id: input.recipientId,
    role_name: input.roleName,
    kind: input.kind,
    status: 'link_sent',
    old_email: input.oldEmail.toLowerCase(),
    requested_by_role: input.requestedByRole,
    requested_by_email: input.requestedByEmail.toLowerCase(),
    token_hash: hashToken(token),
    token_expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error(`Creating the change link failed: ${error.message}`)
  return { token, expiresAt }
}
