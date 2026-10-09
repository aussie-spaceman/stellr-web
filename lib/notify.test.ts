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
