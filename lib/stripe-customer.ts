import Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

interface MemberForCustomer {
  id: string
  email: string | null
  first_name?: string | null
  last_name?: string | null
  stripe_customer_id?: string | null
}

// Returns a valid Stripe customer id for the member, self-healing a stale one.
//
// A stored `members.stripe_customer_id` can point at a customer that no longer
// exists in the *active* Stripe account — e.g. it was created under a different
// account or in test mode while the live key is now in use. Stripe then rejects
// every downstream call ("No such customer: cus_…"), breaking all payment paths.
// Verify the stored id and transparently recreate it when Stripe says it's gone.
export async function ensureStripeCustomer(
  stripe: Stripe,
  db: SupabaseClient,
  member: MemberForCustomer,
  clerkUserId: string,
): Promise<string> {
  const existing = member.stripe_customer_id ?? null
  if (existing) {
    try {
      const customer = await stripe.customers.retrieve(existing)
      // A live, non-deleted customer in this account → reuse it.
      if (!('deleted' in customer) || !customer.deleted) return existing
    } catch (err) {
      // Anything other than "this customer doesn't exist" is a real error.
      if (!(err instanceof Stripe.errors.StripeInvalidRequestError)) throw err
    }
  }

  const name = [member.first_name, member.last_name].filter(Boolean).join(' ') || undefined
  const customer = await stripe.customers.create({
    email: member.email ?? undefined,
    name,
    metadata: { memberId: member.id, clerkUserId },
  })
  await db.from('members').update({ stripe_customer_id: customer.id }).eq('id', member.id)
  return customer.id
}
