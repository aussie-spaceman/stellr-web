import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ send: vi.fn(async (_db: unknown, _input: Record<string, unknown>): Promise<unknown> => ({ ok: true, id: 'em_1' })) }))
vi.mock('@/lib/event-emails/tenant-mail', () => ({ sendTenantConfirmation: h.send }))

const { sendTenantRegistrationConfirmation, tenantConfirmationContent } = await import('./tenant-confirmation')

beforeEach(() => vi.clearAllMocks())

describe('tenant registration confirmation (S5 A7)', () => {
  it('is a fixed template: every value from a row is escaped in the HTML', () => {
    const c = tenantConfirmationContent({ firstName: '<b>Kid</b>', eventTitle: 'Cup "A" & <script>', kind: 'individual' })
    expect(c.html).not.toContain('<b>')
    expect(c.html).not.toContain('<script>')
    expect(c.html).toContain('&lt;b&gt;Kid&lt;/b&gt;')
    expect(c.subject).toBe('Registered: Cup "A" & <script>')
    expect(c.text).toContain("You're registered for Cup")
  })

  it('names the group or the join for those kinds', () => {
    expect(tenantConfirmationContent({ firstName: 'T', eventTitle: 'Cup', kind: 'group' }).text).toContain('Your group is registered for Cup.')
    expect(tenantConfirmationContent({ firstName: 'T', eventTitle: 'Cup', kind: 'group_join' }).text).toContain("You've joined your group for Cup.")
  })

  it('goes only through B14’s tenant share, and never throws', async () => {
    await sendTenantRegistrationConfirmation('db' as never, { tenantId: 't-1', to: 'kid@example.com', firstName: 'K', eventTitle: 'Cup', kind: 'individual' })
    expect(h.send).toHaveBeenCalledWith('db', expect.objectContaining({ tenantId: 't-1', to: 'kid@example.com', subject: 'Registered: Cup' }))
    h.send.mockRejectedValueOnce(new Error('boom'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(sendTenantRegistrationConfirmation('db' as never, { tenantId: 't-1', to: 'a@b.co', firstName: '', eventTitle: '', kind: 'group' }))
      .resolves.toEqual({ ok: false, reason: 'send_failed' })
    errors.mockRestore()
  })
})

describe('guardian-consent notices (S5 wave 6)', () => {
  it('each kind has its own fixed subject and lead, with row values escaped', () => {
    const pending = tenantConfirmationContent({ firstName: 'Kit', eventTitle: 'Cup <b>', kind: 'consent_pending' })
    expect(pending.subject).toBe('Waiting for your parent or guardian: Cup <b>')
    expect(pending.html).toContain('Cup &lt;b&gt;')
    expect(pending.html).not.toContain('<b>')
    expect(pending.text).toContain('Your place is confirmed once they sign.')
    expect(tenantConfirmationContent({ firstName: 'Kit', eventTitle: 'Cup', kind: 'consent_signed' }).text).toContain("so you're registered for Cup.")
    expect(tenantConfirmationContent({ firstName: 'Kit', eventTitle: 'Cup', kind: 'consent_declined' }).subject).toBe('Registration cancelled: Cup')
    expect(tenantConfirmationContent({ firstName: 'Kit', eventTitle: 'Cup', kind: 'consent_expired' }).text).toContain('in time')
  })
})
