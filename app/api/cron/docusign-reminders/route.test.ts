import { describe, it, expect, vi, beforeEach } from 'vitest'

// 28 Sept 2026: this cron had chased nothing since 4 Sept and there was no way to
// tell "never invoked" from "ran and failed" — the query error was discarded
// and each envelope's failure was only console.logged into Hobby's one-hour
// log window. Every run now lands in cron_runs with its failures.

const { query, resendEnvelope, runs } = vi.hoisted(() => ({
  query: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })),
  resendEnvelope: vi.fn(async (_id: string) => 1),
  runs: { fails: [] as string[], finished: [] as Record<string, unknown>[] },
}))

vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({
    fail: (where: string) => { runs.fails.push(where) },
    finish: async (r: Record<string, unknown>) => { runs.finished.push(r) },
  }),
}))
vi.mock('@/lib/docusign', () => ({ resendEnvelope }))
vi.mock('@/lib/docusign-agreements', () => ({ AGREEMENT_LABEL: { minor: 'Parental Consent Form' } }))
vi.mock('@/lib/docusign-recipients', () => ({
  syncEnvelopeRecipients: async () => [
    { name: 'Parent', email: 'p@example.com', roleName: 'Guardian', status: 'sent', deliveredAt: null },
  ],
}))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async () => {}),
  docusignReminderToMinorEmail: () => ({ subject: 's', html: 'h', text: 't' }),
  docusignReminderToSignerEmail: () => ({ subject: 's', html: 'h', text: 't' }),
  docusignSentToGuardianEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'lt', 'or', 'eq']) chain[m] = () => chain
      chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        (table === 'docusign_envelopes' ? query() : Promise.resolve({ data: [], error: null })).then(resolve, reject)
      chain.update = () => ({ eq: async () => ({ error: null }) })
      return chain
    },
  }),
}))

const { GET } = await import('./route')
const call = () => GET(new Request('https://x/api/cron/docusign-reminders') as never)

const ENVELOPE = {
  id: 'row-1', envelope_id: 'env-1', envelope_type: 'minor', minor_name: 'Lily', signer_name: 'Parent',
  signer_email: 'p@example.com', event_title: 'CO SDC', member_id: null, status: 'sent',
  signers_total: 2, signers_completed: 1, reused_from: null, reminder_count: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  runs.fails.length = 0
  runs.finished.length = 0
})

describe('GET /api/cron/docusign-reminders', () => {
  it('surfaces a failed query instead of reporting nothing to chase', async () => {
    query.mockResolvedValueOnce({ data: null, error: { message: 'bad filter' } })
    const res = await call()
    expect(res.status).toBe(500)
    expect(runs.fails).toEqual(['query'])
    expect(runs.finished).toHaveLength(1)
  })

  it('records a per-envelope DocuSign failure in the run', async () => {
    query.mockResolvedValueOnce({ data: [ENVELOPE], error: null })
    resendEnvelope.mockRejectedValueOnce(new Error('DocuSign resend failed'))
    const res = await call()
    expect(await res.json()).toMatchObject({ processed: 0 })
    expect(runs.fails).toEqual(['row-1'])
    expect(runs.finished[0]).toMatchObject({ processed: 0, eligible: 1 })
  })

  it('chases an eligible envelope and closes the run', async () => {
    query.mockResolvedValueOnce({ data: [ENVELOPE], error: null })
    expect(await (await call()).json()).toMatchObject({ processed: 1 })
    expect(resendEnvelope).toHaveBeenCalledWith('env-1')
    expect(runs.fails).toEqual([])
    expect(runs.finished[0]).toMatchObject({ processed: 1, eligible: 1 })
  })
})
