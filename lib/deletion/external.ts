import Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { voidEnvelope } from '@/lib/docusign'
import type { EntityDef, ExternalCleanupKind, ExternalResult } from './types'

// Best-effort cleanup of records that also live in external systems (Stripe,
// DocuSign). Failures are collected and returned — they never abort the local
// delete, since the admin's intent is to remove the data from Stellr. The UI
// surfaces partial failures so an admin can follow up in the external console.

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  return new Stripe(key, { apiVersion: '2026-05-27.dahlia' })
}

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

async function cleanupDocusignForEnvelope(envelopeId: string): Promise<ExternalResult> {
  try {
    const db = supabaseServer()
    const { data: row } = await db
      .from('docusign_envelopes')
      .select('envelope_id, status')
      .eq('id', envelopeId)
      .maybeSingle()

    const dsId = row?.envelope_id as string | undefined
    const status = row?.status as string | undefined

    if (!dsId) return { kind: 'docusign', ok: true, detail: 'No DocuSign envelope linked' }
    if (status === 'completed' || status === 'declined' || status === 'voided') {
      return { kind: 'docusign', ok: true, detail: `Envelope ${status}; nothing to void` }
    }
    await voidEnvelope(dsId)
    return { kind: 'docusign', ok: true, detail: `Voided envelope ${dsId}` }
  } catch (e) {
    return { kind: 'docusign', ok: false, detail: e instanceof Error ? e.message : 'DocuSign cleanup failed' }
  }
}

// Dispatches the external cleanups declared on the entity. `id` is the local row
// id (member id, docusign_envelopes id, etc.).
export async function runExternalCleanup(def: EntityDef, id: string): Promise<ExternalResult[]> {
  const kinds: ExternalCleanupKind[] = def.external ?? []
  const results: ExternalResult[] = []
  for (const kind of kinds) {
    if (kind === 'stripe' && def.type === 'member') {
      results.push(await cleanupStripeForMember(id))
    } else if (kind === 'docusign' && def.type === 'docusign_envelope') {
      results.push(await cleanupDocusignForEnvelope(id))
    }
    // For a member, also void any in-flight envelopes tied to them.
    if (kind === 'docusign' && def.type === 'member') {
      const db = supabaseServer()
      const { data: envs } = await db
        .from('docusign_envelopes')
        .select('id, envelope_id, status')
        .eq('member_id', id)
      for (const env of envs ?? []) {
        results.push(await cleanupDocusignForEnvelope((env as { id: string }).id))
      }
    }
  }
  return results
}
