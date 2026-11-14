// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

// S1 monitoring: crons catch their own errors, so Next's onRequestError never
// sees them. A run that finishes with recorded failures reports them to
// app_errors (lib/app-errors reportError) as "CRON <job>", capped per run, so
// they reach the daily "Errors in the last day" email.

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn(async (_err: unknown, _opts: { route: string }) => {}) }))
vi.mock('@/lib/app-errors', () => ({ reportError }))

import { REPORTED_FAILURES_PER_RUN, startCronRun, startTenantRun } from '@/lib/cron-runs'

beforeEach(() => {
  reportError.mockReset()
  reportError.mockImplementation(async () => {})
})

const reported = () => reportError.mock.calls.map(([err, opts]) => ({ message: (err as Error).message, route: opts.route }))

describe('cron failures reach app_errors', () => {
  it('a clean run reports nothing', async () => {
    const fake = fakeSupabase({ cron_runs: [] })
    const run = await startCronRun(fake.client, 'entitlements')
    await run.finish({ ok: 1 })
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports each distinct failure under the fixed label CRON <job>', async () => {
    const fake = fakeSupabase({ cron_runs: [] })
    const run = await startCronRun(fake.client, 'entitlements')
    run.fail('grant', new Error('insert failed'))
    run.fail('grant', 'insert failed') // the same (where, message): once
    run.fail('expire', 'timeout')
    await run.finish({ ok: 0 })
    expect(reported()).toEqual([
      { message: 'grant: insert failed', route: 'CRON entitlements' },
      { message: 'expire: timeout', route: 'CRON entitlements' },
    ])
    // Written with reportError's own service-role client, not the job's.
    expect(reportError.mock.calls[0][1]).toEqual({ route: 'CRON entitlements' })
    // The ledger still records every failure.
    const row = fake.table('cron_runs')[0] as { ok: boolean; errors: unknown[] }
    expect(row.ok).toBe(false)
    expect(row.errors).toHaveLength(3)
  })

  it(`caps a run at ${REPORTED_FAILURES_PER_RUN} distinct failures`, async () => {
    expect(REPORTED_FAILURES_PER_RUN).toBe(5)
    const fake = fakeSupabase({ cron_runs: [] })
    const run = await startCronRun(fake.client, 'email-outbox')
    for (let i = 0; i < 12; i++) run.fail(`item ${i}`, 'send failed')
    await run.finish({})
    expect(reportError).toHaveBeenCalledTimes(REPORTED_FAILURES_PER_RUN)
    expect(reported().map((r) => r.message)).toEqual([0, 1, 2, 3, 4].map((i) => `item ${i}: send failed`))
    expect((fake.table('cron_runs')[0] as { errors: unknown[] }).errors).toHaveLength(12)
  })

  it('reports even when the ledger row could not be written', async () => {
    const fake = fakeSupabase({ cron_runs: [] }, { failOn: (t) => (t === 'cron_runs' ? 'relation does not exist' : null) })
    const run = await startCronRun(fake.client, 'apollo-reconcile')
    expect(run.id).toBeNull()
    run.fail('page', 'rate limited')
    await run.finish({})
    expect(reported()).toEqual([{ message: 'page: rate limited', route: 'CRON apollo-reconcile' }])
  })

  it('a per-tenant child run reports under the same job label', async () => {
    const fake = fakeSupabase({ cron_runs: [] })
    const parent = await startCronRun(fake.client, 'survey-send')
    const child = await startTenantRun(fake.client, parent, 'survey-send', '11111111-1111-4111-8111-111111111111')
    child.fail('send', 'quota')
    await child.finish({})
    expect(reported()).toEqual([{ message: 'send: quota', route: 'CRON survey-send' }])
  })

  it('never throws into the job: not when reporting rejects', async () => {
    reportError.mockRejectedValue(new Error('app_errors down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = fakeSupabase({ cron_runs: [] })
    const run = await startCronRun(fake.client, 'entitlements')
    run.fail('grant', 'x')
    await expect(run.finish({})).resolves.toBeUndefined()
    // The ledger row is still closed.
    expect((fake.table('cron_runs')[0] as { finished_at?: string }).finished_at).toBeTruthy()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('reporting entitlements failures threw'), 'app_errors down')
    errorSpy.mockRestore()
  })
})
