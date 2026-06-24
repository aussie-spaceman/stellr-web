import { Webhook } from 'svix'
import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { normalizeEmail } from '@/lib/member-enums'
import { claimPendingSpaceInvites } from '@/lib/spaces'

// Clerk sends user.created / user.updated / user.deleted events here.
// This keeps the members table in sync with Clerk identity records.

interface ClerkEmailAddress {
  email_address: string
  id: string
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
    event = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkEvent
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const db = supabaseServer()
  const { type, data } = event

  if (type === 'user.created') {
    const primaryEmail = normalizeEmail(data.email_addresses.find(
      (e) => e.id === data.primary_email_address_id
    )?.email_address)

    if (!primaryEmail) {
      return NextResponse.json({ received: true, skipped: 'no primary email' })
    }

    // Check if a member record already exists for this email (created via event registration)
    const { data: existing } = await db
      .from('members')
      .select('id')
      .eq('email', primaryEmail)
      .maybeSingle()

    let memberId: string | null = null
    if (existing) {
      // Link the existing member record to the new Clerk user
      await db
        .from('members')
        .update({ clerk_user_id: data.id, profile_photo_url: data.image_url })
        .eq('id', existing.id)
      memberId = (existing as { id: string }).id
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
    await db
      .from('members')
      .update({ is_active: false, deleted_at: new Date().toISOString(), clerk_user_id: null })
      .eq('clerk_user_id', data.id)
  }

  return NextResponse.json({ received: true })
}
