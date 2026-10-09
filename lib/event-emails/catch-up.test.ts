import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sendEmail, resolveAudience, event } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_o: { to: string; subject: string }) => {}),
  resolveAudience: vi.fn(async (..._a: unknown[]): Promise<{ recipients: unknown[]; docusignParticipantIds: string[] }> => ({ recipients: [], docusignParticipantIds: [] })),
  event: { date: '2026-10-03' as string | undefined },
}))

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/email', () => ({ sendEmail }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: vi.fn() }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => ({ title: 'CO SDC', date: event.date, venue: 'STEM School' }) }))
vi.mock('./audiences', () => ({ resolveAudience }))

const { catchUpAudiences, catchUpOpen, sendCatchUp, runCatchUps } = await import('./catch-up')
const { markdownToTiptap } = await import('./defaults')

const EMAIL = {
  id: 'e1', event_slug: 'co', name: '2 Days Out', template_key: null, audiences: ['participants', 'guardians'],
  subject: '{{event_name}} is nearly here', body_json: markdownToTiptap('Hi {{first_name}}'), attachments: [],
  resend_docusign: false, schedule_days_before: null, status: 'sent', created_by: null, sent_at: '2026-10-01T19:05:59Z',
  catch_up_claimed_at: null as string | null,
}

const R = (email: string, firstName: string, role = 'participant') => ({
  email, firstName, name: firstName, roles: [role], reasons: ['participants'],
  participantNames: [firstName], isParticipant: role === 'participant', payments: [],
})

// Supabase stand-in: event_emails with a real lease, event_email_sends with
// history the catch-up reads back and records into. A send row is one object,
// shared between `inserted` and `history`, that deliver updates in place — so
// `recipients` written incrementally mid-send are visible to alreadyTried, as
// in the real jsonb column. `killAtFinish` makes the final completion write
// (the one that sets finished_at) throw, simulating the function dying after
// the last recipient was recorded but before the row was marked finished.
function fakeDb(
  row: typeof EMAIL,
  history: { trigger: string; recipients: { email: string; status: string }[] }[],
  opts: { killAtFinish?: boolean } = {},
) {
  const state = {
    row: { ...row },
    history: history.map((h) => ({ ...h })) as { trigger: string; recipients: { email: string; status: string }[] }[],
    inserted: [] as Record<string, unknown>[],
    killAtFinish: opts.killAtFinish ?? false,
  }
  const db = {
    state,
    from(table: string) {
      if (table === 'event_emails') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...state.row } }),
              // runCatchUps' listing
              contains: () => ({ order: async () => ({ data: state.row.status === 'sent' ? [{ id: row.id, event_slug: row.event_slug }] : [], error: null }) }),
            }),
          }),
          update: (values: { catch_up_claimed_at: string | null }) => ({
            eq: () => {
              const q = {
                or: () => ({
                  select: async () => {
                    if (state.row.catch_up_claimed_at) return { data: [] }
                    state.row.catch_up_claimed_at = values.catch_up_claimed_at
                    return { data: [{ id: row.id }] }
                  },
                }),
                then: (resolve: (v: unknown) => void) => {
                  state.row.catch_up_claimed_at = values.catch_up_claimed_at
                  resolve({ error: null })
                },
              }
              return q
            },
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            neq: async (_c: string, v: string) => ({ data: state.history.filter((h) => h.trigger !== v), error: null }),
          }),
        }),
        insert: (values: Record<string, unknown>) => ({
          select: () => ({ single: async () => {
            // One row, shared between `inserted` (what the test asserts on) and
            // `history` (what alreadyTried reads) and updated in place below.
            const rowObj = { id: `s${state.inserted.length + 1}`, recipients: [], ...values } as Record<string, unknown>
            state.inserted.push(rowObj)
            state.history.push(rowObj as unknown as { trigger: string; recipients: { email: string; status: string }[] })
            return { data: { id: rowObj.id } }
          } }),
        }),
        update: (values: Record<string, unknown>) => ({
          eq: async () => {
            // The authoritative completion write carries finished_at; killAtFinish
            // makes it throw, so recipients recorded incrementally persist but the
            // row is never marked finished — exactly a killed function.
            if (state.killAtFinish && 'finished_at' in values) throw new Error('killed')
            Object.assign(state.inserted[state.inserted.length - 1], values)
            return {}
          },
        }),
      }
    },
  }
  return db
}

const ORIGINAL = { trigger: 'manual', recipients: [{ email: 'al@example.com', status: 'sent' }, { email: 'al.mum@example.com', status: 'sent' }] }

beforeEach(() => {
  vi.clearAllMocks()
  event.date = '2026-10-03'
  resolveAudience.mockResolvedValue({
    recipients: [
      R('al@example.com', 'Al'), R('al.mum@example.com', 'Ann', 'guardian'),
      R('bo@example.com', 'Bo'), R('Bo.Dad@example.com', 'Ben', 'guardian'),
    ],
    docusignParticipantIds: [],
  })
})

describe('catchUpAudiences', () => {
  it('only emails sent to All participants qualify, and only participants + guardians are caught up', () => {
    expect(catchUpAudiences(['participants', 'guardians', 'mentors'])).toEqual(['participants', 'guardians'])
    expect(catchUpAudiences(['participants'])).toEqual(['participants'])
    expect(catchUpAudiences(['guardians'])).toEqual([])
    expect(catchUpAudiences(['docusign_outstanding'])).toEqual([])
  })
})

describe('catchUpOpen', () => {
  it('runs through event day and stops after it', () => {
    expect(catchUpOpen('2026-10-03', '2026-10-02')).toBe(true)
    expect(catchUpOpen('2026-10-03', '2026-10-03')).toBe(true)
    expect(catchUpOpen('2026-10-03', '2026-10-04')).toBe(false)
    expect(catchUpOpen(null, '2026-10-02')).toBe(false)
  })
})

describe('sendCatchUp', () => {
  it('sends only to people who have not had it, as its own History row, to the email’s groups', async () => {
    const db = fakeDb(EMAIL, [ORIGINAL, { trigger: 'test', recipients: [{ email: 'bo@example.com', status: 'sent' }] }])
    const out = await sendCatchUp(db as never, 'e1', { triggeredBy: 'David', spacingMs: 0, today: '2026-10-02' })
    expect(out).toMatchObject({ ok: true, recipients: 2, sent: 2, failed: 0 })
    // A test copy to the same address doesn't count as having had it.
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['bo@example.com', 'Bo.Dad@example.com'])
    expect(sendEmail.mock.calls[0][0].subject).toBe('CO SDC is nearly here')
    expect(db.state.inserted[0]).toMatchObject({ trigger: 'catch_up', triggered_by: 'David', audiences: ['participants', 'guardians'], recipient_count: 2, sent_count: 2 })
    expect(db.state.row.catch_up_claimed_at).toBeNull()
  })

  it('never sends the same person twice, matching addresses case-insensitively', async () => {
    const db = fakeDb(EMAIL, [ORIGINAL])
    await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })
    sendEmail.mockClear()
    const again = await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })
    expect(again).toMatchObject({ ok: true, sendId: null, recipients: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(db.state.inserted).toHaveLength(1)
  })

  // deep review INT-1: a catch-up killed mid-send (the 60s function times out)
  // must not re-email the people it already reached. Because deliver records
  // each recipient as it goes, the next run skips them. With the old code —
  // recipients written only at the end — the kill lost them all and the next
  // run emailed everyone again.
  it('does not re-email recipients of a catch-up that was killed before it finished', async () => {
    const db = fakeDb(EMAIL, [ORIGINAL], { killAtFinish: true })
    const killed = await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })
    // The completion write threw, so the run reports failure…
    expect(killed.ok).toBe(false)
    // …but both owed addresses were emailed and recorded as it went.
    expect(sendEmail.mock.calls.map((c) => c[0].to)).toEqual(['bo@example.com', 'Bo.Dad@example.com'])

    // The function is restarted (next cron slot or a button press).
    db.state.killAtFinish = false
    sendEmail.mockClear()
    const retry = await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })
    expect(retry).toMatchObject({ ok: true, recipients: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('writes no History row when nobody is owed it', async () => {
    resolveAudience.mockResolvedValue({ recipients: [R('al@example.com', 'Al')], docusignParticipantIds: [] })
    const db = fakeDb(EMAIL, [ORIGINAL])
    expect(await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })).toMatchObject({ ok: true, recipients: 0 })
    expect(db.state.inserted).toEqual([])
  })

  it('only catches up the groups the email went to', async () => {
    const db = fakeDb({ ...EMAIL, audiences: ['participants', 'mentors'] }, [ORIGINAL])
    await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })
    expect(resolveAudience).toHaveBeenCalledWith(expect.anything(), expect.anything(), ['participants'])
  })

  it('refuses an email that was not sent to All participants, or not sent yet', async () => {
    expect(await sendCatchUp(fakeDb({ ...EMAIL, audiences: ['guardians'] }, []) as never, 'e1', { today: '2026-10-02' })).toMatchObject({ ok: false, status: 400 })
    expect(await sendCatchUp(fakeDb({ ...EMAIL, status: 'draft' }, []) as never, 'e1', { today: '2026-10-02' })).toMatchObject({ ok: false, status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('stops once the event has passed', async () => {
    const out = await sendCatchUp(fakeDb(EMAIL, [ORIGINAL]) as never, 'e1', { spacingMs: 0, today: '2026-10-04' })
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('backs off while another catch-up holds the lease', async () => {
    const db = fakeDb({ ...EMAIL, catch_up_claimed_at: new Date().toISOString() }, [ORIGINAL])
    expect(await sendCatchUp(db as never, 'e1', { spacingMs: 0, today: '2026-10-02' })).toMatchObject({ ok: false, status: 409 })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('runCatchUps', () => {
  it('catches up sent emails for events that have not passed', async () => {
    const db = fakeDb(EMAIL, [ORIGINAL])
    const out = await runCatchUps(db as never, async () => '2026-10-03', () => true, '2026-10-02')
    expect(out).toMatchObject({ checked: 1, emailed: 2, errors: [] })
  })

  it('skips past events and defers when out of time', async () => {
    expect(await runCatchUps(fakeDb(EMAIL, [ORIGINAL]) as never, async () => '2026-09-20', () => true, '2026-10-02'))
      .toMatchObject({ checked: 0, emailed: 0 })
    expect(await runCatchUps(fakeDb(EMAIL, [ORIGINAL]) as never, async () => '2026-10-03', () => false, '2026-10-02'))
      .toMatchObject({ checked: 0, deferred: 1 })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
