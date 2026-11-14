import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Staff alerts are critical mail: never held back by the suppression list
// (lib/email/suppressions.ts), whether they go to duty holders or to the team
// inbox. And an alert must reach somebody's email: when every Stellr holder has
// email turned off, the team inbox gets it too (legacy-23.4). Another tenant's
// alert still never goes to Stellr's inbox.

const { sendEmail, supabaseServer } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => ({ id: 're_1' })),
  supabaseServer: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendEmail,
  teamInboxEmail: () => 'alerts@example.test',
}))
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(), SMS_ENABLED: false }))
vi.mock('@/lib/supabase', () => ({ supabaseServer }))

const { notifyCommunityAdmins, notifyMember } = await import('./notify')
const { fakeSupabase } = await import('@/test/fake-supabase')

const TENANT_A = '11111111-1111-4111-8111-111111111111'

type Sent = { to: string; subject: string; html: string; text: string; critical?: boolean }
const sent = () => sendEmail.mock.calls.map((c) => c[0] as Sent)

const alert = {
  type: 'action' as const,
  body: 'A consent form bounced',
  email: { subject: 'A consent form bounced', html: '<p>Bounced.</p>', text: 'Bounced.' },
}

function seeded(opts: { prefs?: { member_id: string; email_enabled: boolean; inapp_enabled?: boolean }[]; noEmail?: string[] } = {}) {
  const noEmail = new Set(opts.noEmail ?? [])
  const fake = fakeSupabase({
    admin_duties: [
      { member_id: 'm-all', scopes: ['all'] },
      { member_id: 'm-comm', scopes: ['community'] },
    ],
    members: [
      { id: 'm-all', email: noEmail.has('m-all') ? null : 'all@x.test', clerk_user_id: 'c-all', is_active: true },
      { id: 'm-comm', email: noEmail.has('m-comm') ? null : 'comm@x.test', clerk_user_id: 'c-comm', is_active: true },
      { id: 'm-a1', email: 'a1@x.test', clerk_user_id: 'c-a1', is_active: true },
      { id: 'm-plain', email: 'plain@x.test', clerk_user_id: 'c-plain', is_active: true },
    ],
    member_notification_prefs: opts.prefs ?? [],
    tenant_memberships: [{ tenant_id: TENANT_A, member_id: 'm-a1', clerk_user_id: null, role: 'tenant_admin' }],
    community_notifications: [],
  })
  supabaseServer.mockReturnValue(fake.client)
  return fake
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sendEmail.mockClear()
  vi.stubEnv('AUTHZ_SOURCE', '')
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  errorSpy.mockRestore()
})

describe('notifyCommunityAdmins sends critical mail', () => {
  it('to every duty holder', async () => {
    seeded()
    await notifyCommunityAdmins(alert)
    expect(sent().map((s) => s.to).sort()).toEqual(['all@x.test', 'comm@x.test'])
    expect(sent().every((s) => s.critical === true)).toBe(true)
  })

  it('to the team-inbox fallback when nobody holds a duty', async () => {
    const fake = seeded()
    fake.table('admin_duties').splice(0)
    await notifyCommunityAdmins(alert)
    expect(sent()).toEqual([expect.objectContaining({ to: 'alerts@example.test', critical: true })])
    expect(sent()[0].text).toMatch(/nobody holds/)
  })

  it("to another tenant's admins", async () => {
    seeded()
    await notifyCommunityAdmins(alert, { tenantId: TENANT_A })
    expect(sent()).toEqual([expect.objectContaining({ to: 'a1@x.test', critical: true })])
  })

  it('even when the caller passed critical: false', async () => {
    seeded()
    await notifyCommunityAdmins({ ...alert, critical: false })
    expect(sent().every((s) => s.critical === true)).toBe(true)
  })
})

describe('notifyMember', () => {
  it('is not critical unless the caller asks', async () => {
    seeded()
    await notifyMember('m-plain', alert)
    await notifyMember('m-plain', { ...alert, critical: true })
    expect(sent().map((s) => s.critical)).toEqual([false, true])
  })
})

describe('every holder has email off (legacy-23.4)', () => {
  const allOff = [
    { member_id: 'm-all', email_enabled: false },
    { member_id: 'm-comm', email_enabled: false },
  ]

  it('Stellr: the holders still get the bell, and the team inbox gets the email with a note', async () => {
    const fake = seeded({ prefs: allOff })
    await notifyCommunityAdmins(alert)

    const bell = (fake.table('community_notifications') as { recipient_member_id: string }[]).map((r) => r.recipient_member_id).sort()
    expect(bell).toEqual(['m-all', 'm-comm'])
    expect(sent()).toHaveLength(1)
    const mail = sent()[0]
    expect(mail.to).toBe('alerts@example.test')
    expect(mail.critical).toBe(true)
    expect(mail.subject).toBe('A consent form bounced')
    expect(mail.html).toContain('<p>Bounced.</p>')
    expect(mail.text).toMatch(/nobody received this by email/)
    expect(mail.html).toMatch(/nobody received this by email/)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('has email off'))
  })

  it('Stellr: holders with no address on file count the same as email off', async () => {
    seeded({ prefs: [{ member_id: 'm-all', email_enabled: false }], noEmail: ['m-comm'] })
    await notifyCommunityAdmins(alert)
    expect(sent().map((s) => s.to)).toEqual(['alerts@example.test'])
  })

  it('Stellr: one holder with email on is enough; no fallback', async () => {
    seeded({ prefs: [{ member_id: 'm-all', email_enabled: false }] })
    await notifyCommunityAdmins(alert)
    expect(sent().map((s) => s.to)).toEqual(['comm@x.test'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it("another tenant: its admins' choice stands, and nothing goes to Stellr's inbox", async () => {
    seeded({ prefs: [{ member_id: 'm-a1', email_enabled: false }] })
    await notifyCommunityAdmins(alert, { tenantId: TENANT_A })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('never throws when the fallback email fails', async () => {
    seeded({ prefs: allOff })
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    await expect(notifyCommunityAdmins(alert)).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('[notify] fallback admin alert email failed:', expect.any(Error))
  })
})
