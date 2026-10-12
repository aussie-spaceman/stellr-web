import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PAY-5: confirmRegistration is the settled-money confirm shared by
// the Stripe webhook, the scholarship path, and direct registration. A lost write
// must NOT be swallowed — it has to throw so the caller fails closed (the webhook
// then 500s and Stripe retries) instead of reporting the registration confirmed
// while it is still 'pending' in the database.

const h = vi.hoisted(() => ({
  finalizeRegistrationMerch: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => {}),
  updateError: null as { message: string } | null,
}))

// Minimal thenable Supabase stand-in: `update(...).eq(...)` resolves with the
// injected {error}; every read resolves empty (so no confirmation email is sent).
function makeDb() {
  const from = () => {
    const state = { op: 'select' as 'select' | 'update' }
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: () => { state.op = 'update'; return chain },
      eq: () => chain,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(
          state.op === 'update' ? { data: null, error: h.updateError } : { data: null, error: null },
        ).then(onF, onR),
    }
    return chain
  }
  return { from }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => makeDb() }))
vi.mock('@/lib/store/event-merch', () => ({ finalizeRegistrationMerch: h.finalizeRegistrationMerch }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  individualConfirmationEmail: () => ({ subject: '', html: '', text: '' }),
  groupPaymentConfirmedEmail: () => ({ subject: '', html: '', text: '' }),
}))

const { confirmRegistration } = await import('./registration-confirm')

beforeEach(() => {
  vi.clearAllMocks()
  h.updateError = null
})

describe('confirmRegistration (PAY-5: fail closed on write error)', () => {
  it('throws when the status write returns a Supabase error', async () => {
    h.updateError = { message: 'db unavailable' }
    await expect(confirmRegistration('reg-1', false)).rejects.toThrow(/reg-1/)
    // It must not pretend success: no downstream fulfilment ran.
    expect(h.finalizeRegistrationMerch).not.toHaveBeenCalled()
  })

  it('resolves normally when the status write succeeds', async () => {
    h.updateError = null
    await expect(confirmRegistration('reg-1', false)).resolves.toBeUndefined()
    expect(h.finalizeRegistrationMerch).toHaveBeenCalledTimes(1)
  })
})
