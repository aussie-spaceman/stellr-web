// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { changeGroupPaymentMethod } from '@/lib/group-payment-change'
import { rosterDb, stellrGroup, tenantGroup } from './roster-db'

// S5 A8: the organiser-side payment change refuses a tenant's registration with the
// tenant payments answer before Stripe is asked anything, until S9. The Stripe client
// here throws on any use and records what was asked.

const asked: string[] = []
const stripeThatMustNotBeUsed = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'then') return undefined
    asked.push(String(prop))
    throw new Error(`Stripe was asked for ${String(prop)}`)
  },
}) as never

const actor = { memberId: 'member-org', label: 'teacher', by: 'organizer' as const }

describe('changeGroupPaymentMethod on a tenant’s registration', () => {
  it.each(['invoice', 'card', 'individual', 'invoice_some', 'teacher_share'] as const)('refuses a move to %s before Stripe', async (method) => {
    const db = rosterDb()
    asked.length = 0
    const result = await changeGroupPaymentMethod(db.client, stripeThatMustNotBeUsed, tenantGroup.id, method, actor)
    expect(asked).toEqual([])
    expect(result).toEqual({
      ok: false,
      status: 503,
      code: 'tenant_payments_unavailable',
      error: 'Paid registration for this event isn’t available online yet. Please contact the event organiser.',
    })
    // The lock it took is released.
    expect(db.fake.table('registrations').find((r) => r.id === tenantGroup.id)?.invoice_sync_lock_until).toBeNull()
  })

  it('Stellr’s registration goes past the check, as before', async () => {
    const db = rosterDb()
    const result = await changeGroupPaymentMethod(db.client, stripeThatMustNotBeUsed, stellrGroup.id, 'invoice', actor)
    // It read the roster, which comes after the check, and its answer is not the tenant's.
    expect(db.reads).toContain('participants')
    expect(result).not.toHaveProperty('code')
  })
})
