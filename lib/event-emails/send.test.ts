import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmail, reissue, resolveAudience, calls } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_o: { to: string; subject: string; from?: string; replyTo?: string }) => {}),
  reissue: vi.fn(async (..._a: unknown[]) => ({ kind: 'resent' })),
  resolveAudience: vi.fn(async (..._a: unknown[]): Promise<{ recipients: unknown[]; docusignParticipantIds: string[] }> => ({ recipients: [], docusignParticipantIds: [] })),
  calls: { order: [] as string[] },
}))

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/email', () => ({ sendEmail: (o: { to: string; subject: string }) => { calls.order.push(`email:${o.to}`); return sendEmail(o) } }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: (...a: unknown[]) => { calls.order.push('docusign'); return reissue(...a) } }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ title: 'CO SDC', date: '2026-10-03', venue: 'STEM School' }) }))
vi.mock('./audiences', () => ({ resolveAudience }))

const { sendEventEmail, reclaimStuckSending } = await import('./send')
const { markdownToTiptap } = await import('./defaults')

const EMAIL = {
  id: 'e1', event_slug: 'co', name: 'DocuSign chase', template_key: null, audiences: ['docusign_outstanding'],
  subject: '{{event_name}}: DocuSign', body_json: markdownToTiptap('Hi {{first_name}}'), attachments: [],
  resend_docusign: true, schedule_days_before: 5, status: 'scheduled', created_by: null, sent_at: null,
}

const R = (email: string, firstName: string) => ({
  email, firstName, name: firstName, roles: ['participant'], reasons: ['docusign_outstanding'],
  participantNames: [firstName], isParticipant: true, payments: [],
})

// Supabase stand-in with a real claim: the conditional UPDATE only matches
// while the row's status is draft/scheduled.
function fakeDb(row: typeof EMAIL) {
  const state = { row: { ...row }, sends: [] as Record<string, unknown>[], statusWrites: [] as string[] }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...state.row } }) }) }),
          update: (values: { status: string }) => ({
            eq: () => {
              const claim = {
                in: (_c: string, allowed: string[]) => ({
                  select: async () => {
                    if (!allowed.includes(state.row.status)) return { data: [] }
                    state.row.status = values.status
                    state.statusWrites.push(values.status)
                    return { data: [{ id: row.id }] }
                  },
                }),
                then: (resolve: (v: unknown) => void) => {
                  state.row.status = values.status
                  state.statusWrites.push(values.status)
                  resolve({ error: null })
                },
              }
              return claim
            },
          }),
        }
      }
      // event_email_sends
      return {
        // alreadyTriedAddresses: .select('recipients').eq(...).neq('trigger','test')
        select: () => ({
          eq: () => ({
            neq: async (_c: string, v: string) => ({
              data: state.sends.filter((s) => (s as { trigger?: string }).trigger !== v)
                .map((s) => ({ recipients: (s as { recipients?: unknown }).recipients ?? [] })),
              error: null,
            }),
          }),
        }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: async () => { state.sends.push({ ...values }); return { data: { id: `s${state.sends.length}` } } } }),
        }),
        // deliver now writes recipients incrementally AND a final counts update;
        // both are plain merges onto the current (last-inserted) send row.
        update: (values: Record<string, unknown>) => ({ eq: async () => { Object.assign(state.sends[state.sends.length - 1], values); return {} } }),
      }
    },
  }
  return db
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.order.length = 0
  resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: ['p1'] })
})

describe('sendEventEmail', () => {
  it('re-sends DocuSign first, emails each person from David, and records the send', async () => {
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, recipients: 2, sent: 2, failed: 0, docusignResent: 1 })
    expect(calls.order).toEqual(['docusign', 'email:a@example.com', 'email:b@example.com'])
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      subject: 'CO SDC: DocuSign',
      from: expect.stringContaining('David Shaw'),
      replyTo: 'david.shaw@stellreducation.org',
    })
    expect(db.state.row.status).toBe('sent')
    expect(db.state.sends[0]).toMatchObject({ trigger: 'schedule', subject: 'CO SDC: DocuSign', recipient_count: 2, sent_count: 2, docusign_resent: 1 })
  })

  it('does not re-send a Stellr signing agreement when the email itself carries the signing link', async () => {
    resolveAudience.mockResolvedValue({
      recipients: [R('a@example.com', 'Al')],
      docusignParticipantIds: ['p-docusign', 'p-native'],
      nativeParticipantIds: ['p-native'],
    } as never)
    const db = fakeDb({ ...EMAIL, body_json: markdownToTiptap('Hi {{first_name}}\n\n{{agreement_link}}') })
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(reissue.mock.calls.map((c) => c[1])).toEqual(['p-docusign'])

    // Without the link in the email, both are re-sent as before.
    reissue.mockClear()
    await sendEventEmail(fakeDb(EMAIL) as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(reissue.mock.calls.map((c) => c[1])).toEqual(['p-docusign', 'p-native'])
  })

  it('cannot send the same email twice', async () => {
    const db = fakeDb(EMAIL)
    await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    sendEmail.mockClear()
    const again = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(again).toMatchObject({ ok: false, status: 409 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a test goes only to the sender, leaves the status alone and re-sends no DocuSign', async () => {
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'test', testTo: 'me@stellreducation.org', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, recipients: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'me@stellreducation.org', subject: '[TEST] CO SDC: DocuSign' })
    expect(reissue).not.toHaveBeenCalled()
    expect(db.state.statusWrites).toEqual([])
    expect(db.state.sends[0]).toMatchObject({ trigger: 'test' })
  })

  it('records a failed recipient without stopping the rest', async () => {
    sendEmail.mockRejectedValueOnce(new Error('Resend 422'))
    const out = await sendEventEmail(fakeDb(EMAIL) as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: true, sent: 1, failed: 1 })
  })

  it('a manual send to nobody is refused and the email stays editable', async () => {
    resolveAudience.mockResolvedValue({ recipients: [], docusignParticipantIds: [] })
    const db = fakeDb({ ...EMAIL, status: 'draft' })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(db.state.row.status).toBe('draft')
  })

  it('refuses an email with a merge field it cannot fill, before claiming it', async () => {
    const db = fakeDb({ ...EMAIL, subject: 'Hi {{firstName}}' })
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'manual', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('{{firstName}}') })
    expect(db.state.statusWrites).toEqual([])
  })

  it('puts the email back if the audience cannot be resolved', async () => {
    resolveAudience.mockRejectedValueOnce(new Error('roster down'))
    const db = fakeDb(EMAIL)
    const out = await sendEventEmail(db as never, 'e1', { trigger: 'schedule', spacingMs: 0 })
    expect(out).toMatchObject({ ok: false, status: 500 })
    expect(db.state.row.status).toBe('scheduled')
  })
})

// deep review INT-1: a send killed at the 60s budget is left stuck in 'sending'
// forever — the admin PATCH refuses with 409 and the cron only picks up
// 'scheduled'. reclaimStuckSending re-drives a row that has been 'sending'
// longer than the stale window, and the resumed send skips whoever the killed
// run already emailed.
function reclaimDb(opts: { updatedAt: string; priorSent: { email: string; status: string }[] }) {
  const state = {
    row: { ...EMAIL, status: 'sending' as string, updated_at: opts.updatedAt },
    sends: [] as Record<string, unknown>[],
    statusWrites: [] as string[],
    // Seed a prior (killed) send row so alreadyTried has something to skip.
    seeded: [{ trigger: 'schedule', recipients: opts.priorSent }] as Record<string, unknown>[],
  }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: (cols: string) => ({
            eq: (_c: string, _v: string) => ({
              // sendEventEmail's row read
              maybeSingle: async () => ({ data: { ...state.row } }),
              // reclaimStuckSending's listing: .eq('status','sending').lt('updated_at',stale).order()
              lt: (_c2: string, stale: string) => ({
                order: async () => ({
                  data: state.row.status === 'sending' && state.row.updated_at < stale ? [{ id: state.row.id }] : [],
                  error: null,
                }),
              }),
            }),
          }),
          update: (values: { status: string }) => ({
            eq: (_c: string, _v: string) => ({
              // resume CAS: .eq('status','sending').lt('updated_at',stale).select('id')
              eq: (_c2: string, wantStatus: string) => ({
                lt: (_c3: string, stale: string) => ({
                  select: async () => {
                    if (state.row.status !== wantStatus || !(state.row.updated_at < stale)) return { data: [] }
                    state.row.status = values.status
                    state.row.updated_at = new Date().toISOString() // trigger bump: no second reclaim
                    state.statusWrites.push(values.status)
                    return { data: [{ id: state.row.id }] }
                  },
                }),
              }),
              // release(): plain awaited update
              then: (resolve: (v: unknown) => void) => {
                state.row.status = values.status
                state.statusWrites.push(values.status)
                resolve({ error: null })
              },
            }),
          }),
        }
      }
      // event_email_sends
      return {
        select: () => ({
          eq: () => ({
            neq: async (_c: string, v: string) => ({
              data: [...state.seeded, ...state.sends]
                .filter((s) => (s as { trigger?: string }).trigger !== v)
                .map((s) => ({ recipients: (s as { recipients?: unknown }).recipients ?? [] })),
              error: null,
            }),
          }),
        }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: async () => { state.sends.push({ ...values }); return { data: { id: `s${state.sends.length}` } } } }),
        }),
        update: (values: Record<string, unknown>) => ({ eq: async () => { Object.assign(state.sends[state.sends.length - 1], values); return {} } }),
      }
    },
  }
  return db
}

describe('reclaimStuckSending', () => {
  beforeEach(() => {
    resolveAudience.mockResolvedValue({ recipients: [R('a@example.com', 'Al'), R('b@example.com', 'Bo')], docusignParticipantIds: [] })
  })

  it('resumes a stale send and emails only the recipients the killed run had not reached', async () => {
    const old = new Date(Date.now() - 20 * 60_000).toISOString()
    const db = reclaimDb({ updatedAt: old, priorSent: [{ email: 'a@example.com', status: 'sent' }] })
    const out = await reclaimStuckSending(db as never, () => true)
    expect(out).toMatchObject({ reclaimed: 1, errors: [] })
    // Al already had it; only Bo is emailed on resume.
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['b@example.com'])
    expect(db.state.row.status).toBe('sent')
  })

  it('leaves a fresh (in-progress) send alone', async () => {
    const db = reclaimDb({ updatedAt: new Date().toISOString(), priorSent: [] })
    const out = await reclaimStuckSending(db as never, () => true)
    expect(out).toMatchObject({ reclaimed: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(db.state.row.status).toBe('sending')
  })
})
