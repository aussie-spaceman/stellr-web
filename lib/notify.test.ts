import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// notifyCommunityAdmins must never swallow an alert: when staff_roles has no
// 'all'/'community' holder (prod on 28 Sept 2026) or the lookup fails, the alert
// goes to the staff inbox instead.

const { sendEmail, supabaseServer } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_opts: unknown) => {}),
  supabaseServer: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendEmail,
  staffAlertEmail: () => process.env.REGISTRATION_ALERT_EMAIL ?? 'hello@stellreducation.org',
}))
vi.mock('@/lib/sms', () => ({ sendSms: vi.fn(), SMS_ENABLED: false }))
vi.mock('@/lib/supabase', () => ({ supabaseServer }))

const { notifyCommunityAdmins } = await import('./notify')
const { fakeSupabase } = await import('@/test/fake-supabase')
const { STELLR_TENANT_ID } = await import('@/lib/tenancy/constants')
type SupabaseClient = import('@supabase/supabase-js').SupabaseClient

type Result = { data: unknown; error: { message: string } | null }

/** A fake client: staff_roles lookup returns `staff`; per-member reads return `members`. */
function fakeDb(staff: Result, members: Record<string, string> = {}) {
  const inserted: unknown[] = []
  const db = {
    inserted,
    from(table: string) {
      if (table === 'staff_roles') {
        return { select: () => ({ overlaps: async () => staff }) }
      }
      if (table === 'community_notifications') {
        return { insert: async (row: unknown) => { inserted.push(row); return { error: null } } }
      }
      // members / member_notification_prefs: .select().eq(col, id).maybeSingle()
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({
              data: table === 'members' ? { email: members[id] ?? null } : null,
              error: null,
            }),
          }),
        }),
      }
    },
  }
  supabaseServer.mockReturnValue(db)
  return db
}

const alert = {
  type: 'action' as const,
  body: 'DocuSign dispatch failed for Jane Doe',
  email: { subject: 'DocuSign dispatch failed', html: '<p>Failed.</p>', text: 'Failed.' },
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  sendEmail.mockClear()
  process.env.REGISTRATION_ALERT_EMAIL = 'alerts@stellreducation.org'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete process.env.REGISTRATION_ALERT_EMAIL
  errorSpy.mockRestore()
})

describe('notifyCommunityAdmins', () => {
  it('notifies each configured staff member and does not use the fallback', async () => {
    const db = fakeDb(
      { data: [{ member_id: 'm1' }, { member_id: 'm1' }, { member_id: 'm2' }], error: null },
      { m1: 'one@x.org', m2: 'two@x.org' },
    )
    await notifyCommunityAdmins(alert)

    expect(db.inserted).toHaveLength(2)
    expect(sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)).toEqual(['one@x.org', 'two@x.org'])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('emails the staff inbox and logs loudly when no staff are configured', async () => {
    fakeDb({ data: [], error: null })
    await notifyCommunityAdmins(alert)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = sendEmail.mock.calls[0][0] as { to: string; subject: string; html: string; text: string }
    expect(sent.to).toBe('alerts@stellreducation.org')
    expect(sent.subject).toBe('DocuSign dispatch failed')
    expect(sent.html).toContain('<p>Failed.</p>')
    expect(sent.text).toMatch(/no staff member holds/)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no staff_roles holder'))
  })

  it('falls back to the plain body when the alert has no rich email', async () => {
    fakeDb({ data: null, error: null })
    await notifyCommunityAdmins({ type: 'action', body: 'Checkr report referred' })

    const sent = sendEmail.mock.calls[0][0] as { subject: string; html: string }
    expect(sent.subject).toBe('Checkr report referred')
    expect(sent.html).toContain('<p>Checkr report referred</p>')
  })

  // deep review PUB-2: the plain-text body (which can carry names and other free
  // text, e.g. the e-sign decline reason) is escaped before it becomes the HTML
  // fallback body, so injected markup can't render.
  it('escapes the plain body in the HTML fallback', async () => {
    fakeDb({ data: [], error: null })
    await notifyCommunityAdmins({ type: 'action', body: 'Pat <img src=x onerror=alert(1)> declined' })

    const sent = sendEmail.mock.calls[0][0] as { html: string }
    expect(sent.html).not.toContain('<img src=x')
    expect(sent.html).toContain('&lt;img src=x')
  })

  it('falls back when the staff_roles lookup errors', async () => {
    fakeDb({ data: null, error: { message: 'permission denied for table staff_roles' } })
    await notifyCommunityAdmins(alert)

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((sendEmail.mock.calls[0][0] as { to: string }).to).toBe('alerts@stellreducation.org')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('lookup failed'), expect.any(Error))
  })

  it('does not throw when the fallback email itself fails', async () => {
    fakeDb({ data: [], error: null })
    sendEmail.mockRejectedValueOnce(new Error('resend down'))

    await expect(notifyCommunityAdmins(alert)).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('[notify] fallback admin alert email failed:', expect.any(Error))
  })
})

// S5 B17: recipients come from lib/authz/audiences (not mocked here). Seeded
// data, so each filter really runs.
describe('notifyCommunityAdmins audiences (S5 B17)', () => {
  const TENANT_A = '11111111-1111-4111-8111-111111111111'

  const seed = () => ({
    staff_roles: [
      { member_id: 'm-all', scopes: ['all'] },
      { member_id: 'm-comm', scopes: ['community', 'events'] },
      { member_id: 'm-events', scopes: ['events'] },
      { member_id: 'm-dup', scopes: ['all', 'community'] },
      { member_id: null, scopes: ['all'] },
    ],
    members: [
      { id: 'm-all', email: 'all@x.org', clerk_user_id: 'c-all' },
      { id: 'm-comm', email: 'comm@x.org', clerk_user_id: 'c-comm' },
      { id: 'm-events', email: 'events@x.org', clerk_user_id: 'c-events' },
      { id: 'm-dup', email: 'dup@x.org', clerk_user_id: 'c-dup' },
      { id: 'm-a1', email: 'a1@x.org', clerk_user_id: 'c-a1', is_active: true },
      { id: 'm-a2', email: 'a2@x.org', clerk_user_id: 'c-a2', is_active: true },
      { id: 'm-a3', email: 'a3@x.org', clerk_user_id: 'c-a3', is_active: false },
    ],
    tenant_memberships: [
      // A Stellr membership must not widen Stellr's audience under AUTHZ_SOURCE=clerk.
      { tenant_id: STELLR_TENANT_ID, member_id: 'm-events', clerk_user_id: null, role: 'tenant_admin' },
      { tenant_id: TENANT_A, member_id: 'm-a1', clerk_user_id: null, role: 'tenant_admin' },
      { tenant_id: TENANT_A, member_id: null, clerk_user_id: 'c-a2', role: 'tenant_admin' },
      // A deactivated member who still holds a tenant_admin row gets no alert.
      { tenant_id: TENANT_A, member_id: 'm-a3', clerk_user_id: null, role: 'tenant_admin' },
      { tenant_id: TENANT_A, member_id: 'm-comm', clerk_user_id: null, role: 'staff' },
    ],
  })

  function seeded(fail?: string, rows = seed()) {
    const fake = fakeSupabase(rows, { failOn: (t, action) => (t === fail && action === 'select' ? 'boom' : null) })
    supabaseServer.mockReturnValue(fake.client)
    return fake
  }

  const sentTo = () => sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to).sort()

  it("Stellr: the same members as the staff_roles query before B17, under the default AUTHZ_SOURCE", async () => {
    vi.stubEnv('AUTHZ_SOURCE', '')
    const fake = seeded()
    // The query notifyCommunityAdmins ran before B17, on the same rows.
    const { data } = await (fake.client as unknown as SupabaseClient).from('staff_roles').select('member_id').overlaps('scopes', ['all', 'community'])
    const before = [...new Set(((data ?? []) as { member_id: string | null }[]).map((r) => r.member_id).filter(Boolean))].sort()

    await notifyCommunityAdmins(alert)

    const notified = (fake.table('community_notifications') as { recipient_member_id: string }[]).map((r) => r.recipient_member_id).sort()
    expect(before).toEqual(['m-all', 'm-comm', 'm-dup'])
    expect(notified).toEqual(before)
    expect(sentTo()).toEqual(['all@x.org', 'comm@x.org', 'dup@x.org'])
    expect(errorSpy).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('Stellr: a failed staff_roles read still falls back to the staff inbox', async () => {
    seeded('staff_roles')
    await notifyCommunityAdmins(alert)
    expect(sentTo()).toEqual(['alerts@stellreducation.org'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('lookup failed'), expect.any(Error))
  })

  it("another tenant: its tenant admins by email only, never Stellr's staff or the bell", async () => {
    const fake = seeded('staff_roles')
    await notifyCommunityAdmins(alert, { tenantId: TENANT_A })
    expect(sentTo()).toEqual(['a1@x.org', 'a2@x.org'])
    expect(fake.table('community_notifications')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('another tenant: a deactivated member with a tenant_admin row gets nothing', async () => {
    const TENANT_B = '22222222-2222-4222-8222-222222222222'
    const rows = seed()
    rows.tenant_memberships.push({ tenant_id: TENANT_B, member_id: 'm-a3', clerk_user_id: null, role: 'tenant_admin' })
    seeded(undefined, rows)
    await notifyCommunityAdmins(alert, { tenantId: TENANT_B })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/dropped: it has no tenant admin/))
  })

  it("another tenant whose members read fails: dropped and logged, never sent to Stellr's inbox", async () => {
    // Admins keyed by member id only, so the active-member read is the one that fails.
    const TENANT_B = '22222222-2222-4222-8222-222222222222'
    const rows = seed()
    rows.tenant_memberships.push({ tenant_id: TENANT_B, member_id: 'm-a1', clerk_user_id: null, role: 'tenant_admin' })
    seeded('members', rows)
    await notifyCommunityAdmins(alert, { tenantId: TENANT_B })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/dropped: its staff lookup failed/))
  })

  it("another tenant with no admin: dropped and logged, never sent to Stellr's inbox", async () => {
    seeded()
    await notifyCommunityAdmins(alert, { tenantId: '33333333-3333-4333-8333-333333333333' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/dropped: it has no tenant admin/))
  })

  it("another tenant whose lookup fails: dropped and logged, never sent to Stellr's inbox", async () => {
    seeded('tenant_memberships')
    await notifyCommunityAdmins(alert, { tenantId: TENANT_A })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/dropped: its staff lookup failed/))
    // The log names the tenant and the reason, never the alert body.
    for (const call of errorSpy.mock.calls) expect(String(call[0])).not.toContain('Jane Doe')
  })
})
