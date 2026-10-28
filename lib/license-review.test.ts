import { describe, it, expect, vi, beforeEach } from 'vitest'

// The two license-review messages: staff hear about a submission (once per
// half hour — details then photo is one submission), and the teacher hears
// when they're verified. Neither may ever throw into the route that saved the
// license.

const h = vi.hoisted(() => ({
  recentAlerts: 0,
  member: { first_name: 'Pat', last_name: 'Teacher', email: 'pat@example.com' } as Record<string, unknown> | null,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  notifyCommunityAdmins: vi.fn(async (_input: Record<string, unknown>) => {}),
  sendEmail: vi.fn(async (_m: Record<string, unknown>) => {}),
  logActivity: vi.fn(async (_e: Record<string, unknown>) => {}),
}))

function makeDb() {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    Object.assign(chain, {
      select: () => chain, eq: () => chain, gte: () => chain,
      insert: async (row: Record<string, unknown>) => { h.inserts.push({ table, row }); return { error: null } },
      maybeSingle: async () => ({ data: table === 'members' ? h.member : null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(table === 'member_activity_log' ? { count: h.recentAlerts } : { data: null }).then(resolve),
    })
    return chain
  }
  return { from } as never
}

vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: h.notifyCommunityAdmins }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
vi.mock('@/lib/activity-log', () => ({ logActivity: h.logActivity }))
vi.mock('@/lib/env', () => ({ AUTH_APP_URL: 'https://app.example.org' }))

const { alertLicenseReview, notifyLicenseVerified } = await import('./license-review')

beforeEach(() => {
  vi.clearAllMocks()
  h.recentAlerts = 0
  h.inserts.length = 0
  h.member = { first_name: 'Pat', last_name: 'Teacher', email: 'pat@example.com' }
})

describe('alertLicenseReview', () => {
  it('tells staff there is a license to verify, linking to the member page', async () => {
    expect(await alertLicenseReview(makeDb(), 'm-1', 'details')).toEqual({ sent: true })
    const input = h.notifyCommunityAdmins.mock.calls[0][0] as { body: string; referenceType: string; referenceId: string; email: { html: string; text: string } }
    expect(input.body).toMatch(/Pat Teacher submitted their teaching license — waiting verification/)
    expect(input.referenceType).toBe('license_review')
    expect(input.referenceId).toBe('m-1')
    expect(input.email.text).toContain('https://app.example.org/admin/members/m-1')
    expect(h.logActivity).toHaveBeenCalledWith(expect.objectContaining({ action: 'license_review_alert_sent' }), expect.anything())
  })

  it('sends one alert per half hour: details then photo is one submission', async () => {
    h.recentAlerts = 1
    expect(await alertLicenseReview(makeDb(), 'm-1', 'document')).toEqual({ sent: false, reason: 'cooldown' })
    expect(h.notifyCommunityAdmins).not.toHaveBeenCalled()
  })

  it('never throws into the route', async () => {
    h.notifyCommunityAdmins.mockRejectedValueOnce(new Error('resend down'))
    expect(await alertLicenseReview(makeDb(), 'm-1', 'document')).toEqual({ sent: false, reason: 'error' })
  })
})

describe('notifyLicenseVerified', () => {
  it('emails the teacher and leaves a bell notice', async () => {
    expect(await notifyLicenseVerified(makeDb(), 'm-1', '2029-06-30')).toEqual({ sent: true })
    const mail = h.sendEmail.mock.calls[0][0] as { to: string; subject: string; text: string }
    expect(mail.to).toBe('pat@example.com')
    expect(mail.subject).toBe('Your teaching license is verified')
    expect(mail.text).toContain('https://app.example.org/account?tab=profile#clearance')
    expect(h.inserts).toEqual([
      expect.objectContaining({ table: 'community_notifications', row: expect.objectContaining({ reference_type: 'compliance_cleared', recipient_member_id: 'm-1' }) }),
    ])
  })

  it('does nothing for a member with no email, and never throws', async () => {
    h.member = { first_name: 'Pat', email: null }
    expect(await notifyLicenseVerified(makeDb(), 'm-1', '2029-06-30')).toEqual({ sent: false })
    h.member = { first_name: 'Pat', email: 'pat@example.com' }
    h.sendEmail.mockRejectedValueOnce(new Error('resend down'))
    expect(await notifyLicenseVerified(makeDb(), 'm-1', '2029-06-30')).toEqual({ sent: false })
  })
})
