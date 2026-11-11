import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, it, expect, vi } from 'vitest'

// S5 wave 6: the confirmation page after a 14-17-year-old registers for another
// organiser's event says the place waits on a guardian, and makes none of the
// paid registration's claims. Without the query it is unchanged, and Stellr's own
// page ignores the query: only the tenant page passes tenantEvent.

vi.mock('@/lib/events/repo', () => ({ getEventBySlug: async () => ({ title: 'Canary Cup' }) }))
vi.mock('@/components/forms/JoinLinkButton', () => ({ JoinLinkButton: () => null }))

const { confirmationBody } = await import('@/app/(stellr)/(flow)/register/[slug]/confirmation/confirmation-body')

const html = async (query: Record<string, string>, tenantEvent?: boolean) =>
  renderToStaticMarkup((await confirmationBody({ slug: 'canary-cup', query, tenantEvent })) as never)

describe('confirmation page, guardian consent pending', () => {
  it('on a tenant event: says the place waits on the guardian, with no payment, guarantee or agreement steps', async () => {
    const page = await html({ id: 'reg-1', type: 'individual', consent: 'pending' }, true)
    expect(page).toContain('Waiting for your parent or guardian')
    expect(page).toContain('Your place is confirmed once they sign')
    expect(page).not.toContain('Registration Submitted!')
    expect(page).not.toMatch(/money-back|Payment processed|DocuSign/)
    // Sent or queued: "will", never "have".
    expect(page).toContain('We’ll email your parent or guardian a consent form.')
    expect(page).not.toMatch(/We’ve emailed/)
  })

  it('when the invitation did not go: says consent is still needed, never that the guardian was emailed', async () => {
    const page = await html({ id: 'reg-1', type: 'individual', consent: 'unsent' }, true)
    expect(page).toContain('Waiting for your parent or guardian')
    expect(page).toContain('needs to sign a consent form before your place is confirmed')
    expect(page).not.toMatch(/We’ll email your parent|We’ve emailed/)
    expect(page).not.toContain('What happens next?')
    // Stellr's page ignores it.
    expect(await html({ id: 'reg-1', type: 'individual', consent: 'unsent' })).toBe(await html({ id: 'reg-1', type: 'individual' }))
  })

  it('is unchanged without the query, and for a group', async () => {
    const plain = await html({ id: 'reg-1', type: 'individual' }, true)
    expect(plain).toContain('Registration Submitted!')
    expect(plain).toContain('What happens next?')
    const group = await html({ id: 'reg-1', type: 'group', consent: 'pending' }, true)
    expect(group).toContain('Group Registration Submitted!')
    expect(group).not.toContain('Waiting for your parent or guardian')
  })

  it("Stellr's page ignores a hand-made ?consent=pending: byte-identical to the page without it", async () => {
    const crafted = await html({ id: 'reg-1', type: 'individual', consent: 'pending' })
    expect(crafted).toBe(await html({ id: 'reg-1', type: 'individual' }))
    expect(crafted).toContain('Registration Submitted!')
    expect(crafted).not.toContain('Waiting for your parent or guardian')
  })

  it('only the tenant confirmation page passes tenantEvent', () => {
    const tenant = readFileSync('app/%5Ft/[tenant]/(flow)/register/[slug]/confirmation/page.tsx', 'utf8')
    const stellr = readFileSync('app/(stellr)/(flow)/register/[slug]/confirmation/page.tsx', 'utf8')
    expect(tenant).toContain('tenantEvent: true')
    expect(stellr).not.toContain('tenantEvent')
  })
})
