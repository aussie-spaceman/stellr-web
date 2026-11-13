import Stripe from 'stripe'
import { clerkClient } from '@clerk/nextjs/server'
import { loadTargetClerkRole } from '@/lib/authz/principal'
import { supabaseServer } from '@/lib/supabase'
import { voidEnvelopeRow } from '@/lib/esign/operations'
import { purgeStaffCheckIns } from './staff-check-ins'
import type { DeleteMode, EntityDef, ExternalCleanupKind, ExternalResult } from './types'
import { stripeClient } from '@/lib/stripe'

// Best-effort cleanup of records that also live in external systems (Stripe,
// DocuSign, Clerk). Failures are collected and returned — they never abort the local
// delete, since the admin's intent is to remove the data from Stellr. The UI
// surfaces partial failures so an admin can follow up in the external console.

async function cleanupStripeForMember(memberId: string): Promise<ExternalResult> {
  try {
    const stripe = stripeClient()
    if (!stripe) return { kind: 'stripe', ok: false, detail: 'Stripe not configured' }

    const db = supabaseServer()
    const { data: member } = await db
      .from('members')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('id', memberId)
      .maybeSingle()

    const subId = member?.stripe_subscription_id as string | null | undefined
    const custId = member?.stripe_customer_id as string | null | undefined

    if (subId) {
      await stripe.subscriptions.cancel(subId)
    }
    if (custId) {
      // Retain the customer record for financial history but redact PII linkage.
      await stripe.customers.update(custId, { metadata: { stellr_deleted: 'true' } })
    }
    return { kind: 'stripe', ok: true, detail: subId ? `Canceled subscription ${subId}` : 'No active subscription' }
  } catch (e) {
    return { kind: 'stripe', ok: false, detail: e instanceof Error ? e.message : 'Stripe cleanup failed' }
  }
}

// Deletes the member's Clerk login so a purged member can't sign back in and be
// onboarded as a brand-new duplicate row. Must run before the row is deleted,
// while clerk_user_id is still readable.
export async function cleanupClerkForMember(memberId: string): Promise<ExternalResult> {
  try {
    const db = supabaseServer()
    const { data: member } = await db
      .from('members')
      .select('clerk_user_id')
      .eq('id', memberId)
      .maybeSingle()
    const clerkUserId = member?.clerk_user_id as string | null | undefined
    return await deleteUnsharedClerkLogin(clerkUserId ?? null, memberId)
  } catch (e) {
    return { kind: 'clerk', ok: false, detail: e instanceof Error ? e.message : 'Clerk cleanup failed' }
  }
}

// Deletes a Clerk login unless another member row (other than `exceptMemberId`)
// is linked to it, or it is a staff account. Shared with the member merge,
// which calls it after the dropped row is already gone.
export async function deleteUnsharedClerkLogin(
  clerkUserId: string | null,
  exceptMemberId?: string,
): Promise<ExternalResult> {
  try {
    if (!clerkUserId) return { kind: 'clerk', ok: true, detail: 'No Clerk login linked' }
    const db = supabaseServer()

    // The login is only this member's to remove if no other row is linked to it.
    let others = db
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('clerk_user_id', clerkUserId)
    if (exceptMemberId) others = others.neq('id', exceptMemberId)
    const { count } = await others
    if ((count ?? 0) > 0) {
      return { kind: 'clerk', ok: false, detail: `Clerk login ${clerkUserId} is linked to another member; left in place` }
    }

    const client = await clerkClient()
    const { exists, role } = await loadTargetClerkRole(client, clerkUserId)
    if (!exists) return withStaffCheckInsRemoved(db, clerkUserId, 'Clerk login already removed')
    // A staff login is someone's working account, so a member purge never removes
    // one: that is a decision to make in Clerk. If the role tables can't be read the login
    // stays too, and the admin is told that, so they know to come back to it. (lib/authz is
    // `server-only`, and scripts load this file under plain tsx, so it loads here.)
    const { isStaffTargetOrUnknown } = await import('@/lib/authz')
    const staff = await isStaffTargetOrUnknown({ clerkUserId, clerkRole: role, memberId: exceptMemberId ?? null }, { route: 'deletion/clerk-login' })
    if (staff === null) {
      return { kind: 'clerk', ok: false, detail: `Could not confirm Clerk login ${clerkUserId} is not a staff account; left in place` }
    }
    if (staff) {
      const named = typeof role === 'string' ? ` (${role})` : ''
      return { kind: 'clerk', ok: false, detail: `Clerk login ${clerkUserId} is a staff account${named}; left in place` }
    }

    await client.users.deleteUser(clerkUserId)
    return withStaffCheckInsRemoved(db, clerkUserId, `Deleted Clerk login ${clerkUserId}`)
  } catch (e) {
    return { kind: 'clerk', ok: false, detail: e instanceof Error ? e.message : 'Clerk cleanup failed' }
  }
}

// Owner decision 13 Nov 2026: event staff check-ins leave with the account. Once
// the login is gone, so are the event-manager check-ins keyed by it
// (lib/deletion/staff-check-ins.ts). Never while the login stays (shared or
// staff): that person still holds the account. A failure is reported, not thrown,
// so the admin sees it; Clerk's user.deleted webhook also retries the same purge.
async function withStaffCheckInsRemoved(
  db: ReturnType<typeof supabaseServer>,
  clerkUserId: string,
  detail: string,
): Promise<ExternalResult> {
  const purged = await purgeStaffCheckIns(db, { clerkUserId })
  if (!purged.ok) {
    return { kind: 'clerk', ok: false, detail: `${detail}, but its event check-ins were not removed (${purged.error})` }
  }
  return { kind: 'clerk', ok: true, detail }
}

async function cleanupDocusignForEnvelope(envelopeId: string): Promise<ExternalResult> {
  try {
    const db = supabaseServer()
    const { data: row } = await db
      .from('agreements')
      .select('envelope_id, provider, status')
      .eq('id', envelopeId)
      .maybeSingle()

    const dsId = row?.envelope_id as string | undefined
    const status = row?.status as string | undefined

    if (!dsId) return { kind: 'docusign', ok: true, detail: 'No DocuSign envelope linked' }
    if (status === 'completed' || status === 'declined' || status === 'voided') {
      return { kind: 'docusign', ok: true, detail: `Envelope ${status}; nothing to void` }
    }
    await voidEnvelopeRow(db, { envelope_id: dsId, provider: row?.provider as string | null | undefined })
    return { kind: 'docusign', ok: true, detail: `Voided envelope ${dsId}` }
  } catch (e) {
    return { kind: 'docusign', ok: false, detail: e instanceof Error ? e.message : 'DocuSign cleanup failed' }
  }
}

// Voids every in-flight envelope whose agreements row matches
// `column = value` (e.g. member_id, participant_id).
async function cleanupDocusignByColumn(column: string, value: string): Promise<ExternalResult[]> {
  const db = supabaseServer()
  const { data: envs } = await db
    .from('agreements')
    .select('id')
    .eq(column, value)
  const out: ExternalResult[] = []
  for (const env of envs ?? []) {
    out.push(await cleanupDocusignForEnvelope((env as { id: string }).id))
  }
  return out
}

// Dispatches the external cleanups declared on the entity. `id` is the local row
// id (member id, agreements id, participant id, registration id, etc.).
export async function runExternalCleanup(def: EntityDef, id: string, mode: DeleteMode): Promise<ExternalResult[]> {
  const kinds: ExternalCleanupKind[] = def.external ?? []
  const results: ExternalResult[] = []
  for (const kind of kinds) {
    if (kind === 'stripe' && def.type === 'member') {
      results.push(await cleanupStripeForMember(id))
    }
    if (kind === 'clerk' && def.type === 'member' && mode === 'hard') {
      results.push(await cleanupClerkForMember(id))
    }
    if (kind === 'docusign') {
      if (def.type === 'docusign_envelope') {
        results.push(await cleanupDocusignForEnvelope(id))
      } else if (def.type === 'member') {
        results.push(...await cleanupDocusignByColumn('member_id', id))
      } else if (def.type === 'participant') {
        results.push(...await cleanupDocusignByColumn('participant_id', id))
      } else if (def.type === 'registration') {
        // Void envelopes for every participant in the registration.
        const db = supabaseServer()
        const { data: parts } = await db.from('participants').select('id').eq('registration_id', id)
        for (const p of parts ?? []) {
          results.push(...await cleanupDocusignByColumn('participant_id', (p as { id: string }).id))
        }
      }
    }
  }
  return results
}
