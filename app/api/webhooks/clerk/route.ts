import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { normalizeEmail } from '@/lib/member-enums'
import { claimPendingSpaceInvites } from '@/lib/spaces'
import { syncMemberClassificationRole } from '@/lib/member-roles'
import { startRetentionClock } from '@/lib/esign/retention'
import { mayLinkLogin } from '@/lib/guardian-consent'
import { logActivity } from '@/lib/activity-log'

// Clerk sends user.created / user.updated / user.deleted events here.
// This keeps the members table in sync with Clerk identity records. A new
// Clerk user is tied to a member row only through a verified primary email,
// never to a row another login already holds, and never to a child under 13
// (or of unknown age) before a parent or guardian has signed.

interface ClerkEmailAddress {
  email_address: string
  id: string
  /** Clerk's verification of this address: 'verified' once its owner proved it. */
  verification?: { status?: string | null } | null
}

interface ClerkUserPayload {
  id: string
  first_name: string | null
  last_name: string | null
  email_addresses: ClerkEmailAddress[]
  primary_email_address_id: string
  image_url: string | null
}

interface ClerkEvent {
  type: string
  data: ClerkUserPayload
}

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) {
    console.error('CLERK_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const headerPayload = await headers()
  const svixId = headerPayload.get('svix-id')
  const svixTimestamp = headerPayload.get('svix-timestamp')
  const svixSignature = headerPayload.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
  }

  const payload = await req.text()
  const wh = new Webhook(secret)
  let event: ClerkEvent

  try {
    // svix 2 only verifies; it no longer parses the payload. Parsing stays
    // inside the try so a non-JSON body is still a 400.
    wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
    event = JSON.parse(payload) as ClerkEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const db = supabaseServer()
  const { type, data } = event

  if (type === 'user.created') {
    const primary = data.email_addresses.find((e) => e.id === data.primary_email_address_id)
    const primaryEmail = normalizeEmail(primary?.email_address)

    if (!primaryEmail) {
      return NextResponse.json({ received: true, skipped: 'no primary email' })
    }

    // S0 (2 Nov 2026): an address its owner has not proved gets no member row,
    // linked or new. A Clerk user can exist with an unverified address (an
    // identity provider that does not vouch for it, or one added by hand in the
    // Clerk dashboard; the app's own backend creates mark theirs verified):
    // linking it would hand that login an existing member's record — possibly
    // a child's — and creating one would reserve the address for whoever typed it.
    if (primary?.verification?.status !== 'verified') {
      console.warn('[clerk webhook] user.created with an unverified primary email: not linked', { clerkUserId: data.id })
      return NextResponse.json({ received: true, skipped: 'email not verified' })
    }

    // Check if a member record already exists for this email (created via event registration)
    const { data: existing } = await db
      .from('members')
      .select('id, event_role, clerk_user_id, date_of_birth')
      .eq('email', primaryEmail)
      .maybeSingle()

    let memberId: string | null = null
    if (existing) {
      const linkedTo = (existing as { clerk_user_id: string | null }).clerk_user_id
      // Never move a member row from one login to another: the row already
      // belongs to the Clerk user it names. (The registration routes link the
      // login they just made before this event lands; that is the same id.)
      if (linkedTo && linkedTo !== data.id) {
        console.warn('[clerk webhook] user.created for an email whose member is linked to another login: not linked', { clerkUserId: data.id })
        return NextResponse.json({ received: true, skipped: 'member already linked' })
      }
      if (!linkedTo) {
        // COPPA: a self-serve sign-up never went through guardedEnsureClerkUser,
        // so the guard's rule is applied here before the record is handed over.
        // A child under 13, or a member whose age cannot be read, waits for a
        // parent or guardian's signed agreement. Not linked means the login sees
        // nothing of the record; onboarding makes the link once the agreement
        // is signed, under the same rule.
        const consent = await mayLinkLogin(db, existing as { id: string; date_of_birth: string | null })
        if (!consent.allowed) {
          console.warn('[clerk webhook] user.created for a member under 13 or of unknown age with no guardian agreement: not linked', { clerkUserId: data.id })
          await logActivity({
            memberId: (existing as { id: string }).id,
            category: 'account',
            actorType: 'system',
            action: 'account_link_held_for_consent',
            summary: `A sign-up with this member's email was not linked: ${consent.reason === 'under_13' ? 'under 13' : 'no usable date of birth'} and no parent or guardian agreement on file yet`,
          }, db)
          return NextResponse.json({ received: true, skipped: 'guardian consent required' })
        }
        // Link the existing member record to the new Clerk user — only while it
        // is still unlinked, so a link made in the meantime is never overwritten.
        const { data: linked, error: linkError } = await db
          .from('members')
          .update({ clerk_user_id: data.id, profile_photo_url: data.image_url })
          .eq('id', existing.id)
          .is('clerk_user_id', null)
          .select('id')
        // Nothing updated: another login took the row between the read and the
        // write (or the write failed). Back off: the row is not this user's, so
        // no roles are seeded and no invites claimed on its behalf.
        if (!linked?.length) {
          if (linkError) console.error('[clerk webhook] member link failed:', linkError)
          else console.warn('[clerk webhook] member linked by another login before this one: not linked', { clerkUserId: data.id })
          return NextResponse.json({ received: true, skipped: 'member already linked' })
        }
      }
      memberId = (existing as { id: string }).id

      // Seed roles on this branch too. It is the COMMON path for self-serve
      // signup — the onboarding POST usually creates the member row before this
      // webhook lands — and skipping it left every such member with no
      // member_roles row at all. Sync from the row's own event_role, not a
      // hardcoded default, since an existing row may already be classified.
      await syncMemberClassificationRole(
        db,
        memberId,
        ((existing as { event_role: string | null }).event_role) ?? 'subscriber',
      )
    } else {
      // Create a minimal member record; they complete their profile on /account
      const { data: created } = await db.from('members').insert({
        clerk_user_id: data.id,
        first_name: data.first_name ?? '',
        last_name: data.last_name ?? '',
        email: primaryEmail,
        profile_photo_url: data.image_url,
        // Defaults — member sets these during onboarding
        age_bracket: 'adult',
        event_role: 'subscriber',
        is_active: true,
      }).select('id').maybeSingle()
      memberId = (created as { id: string } | null)?.id ?? null
      // New signups are base members; seed their unified member_roles row.
      if (memberId) await syncMemberClassificationRole(db, memberId, 'subscriber')
    }

    // Auto-claim any space invites that were parked against this email before they
    // had an account (#1 pending-invite). Best-effort — never fail the webhook.
    if (memberId) {
      await claimPendingSpaceInvites(memberId, primaryEmail).catch((e) =>
        console.error('[clerk webhook] claim space invites error:', e)
      )
    }
  }

  if (type === 'user.updated') {
    const primaryEmail = normalizeEmail(data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id
    )?.email_address) || undefined

    await db
      .from('members')
      .update({
        first_name: data.first_name ?? undefined,
        last_name: data.last_name ?? undefined,
        email: primaryEmail ?? undefined,
        profile_photo_url: data.image_url,
      })
      .eq('clerk_user_id', data.id)
  }

  if (type === 'user.deleted') {
    // Soft-delete: retain data, revoke access
    const { data: deactivated } = await db
      .from('members')
      .update({ is_active: false, deleted_at: new Date().toISOString(), clerk_user_id: null })
      .eq('clerk_user_id', data.id)
      .select('id')
    // Signed agreements are kept 7 years from deactivation (V2.3).
    for (const m of deactivated ?? []) {
      await startRetentionClock(db, (m as { id: string }).id).catch((err) => console.error('[clerk] retention clock failed:', err))
    }
  }

  return NextResponse.json({ received: true })
}
