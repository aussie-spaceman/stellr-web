// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ id: 're_1' })) }))
vi.mock('@/lib/email', () => ({ sendEmail, teamInboxEmail: () => 'staff@example.test' }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('no env in tests') } }))

import {
  captureRequestError,
  errorDigest,
  MAX_MESSAGE,
  MAX_WRITES_PER_MINUTE,
  recordBuiltAppError,
  renderErrorDigest,
  resetErrorCaptureState,
  routeLabel,
  scrubMessage,
  sendDailyErrorDigest,
  takeWrite,
  WRITE_WINDOW_MS,
} from './app-errors'

beforeEach(() => {
  resetErrorCaptureState()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('scrubMessage', () => {
  it('strips emails, phone numbers and tokens', () => {
    const out = scrubMessage(
      'Insert failed for pat.lee+x@example.test, phone +1 (303) 555-0142 / 0412 345 678, ' +
      'Bearer abc.def.ghi, key sk_live_51Habcdefghijkl, jwt eyJhbGciOi.eyJzdWIiOi.sig_part, ' +
      'session 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b, url /x?email=a%40b.c&token=zzz password=hunter2',
    )
    expect(out).not.toMatch(/pat\.lee|example\.test/)
    expect(out).not.toMatch(/555-0142|345 678/)
    expect(out).not.toMatch(/sk_live|eyJhbGci|9f86d081|hunter2|zzz|abc\.def/)
    expect(out).toContain('[email]')
    expect(out).toContain('[phone]')
    expect(out).toContain('[token]')
    expect(out).toContain('?email=[redacted]&token=[redacted]')
  })

  it('keeps dates, short numbers and ordinary words', () => {
    expect(scrubMessage('Row 42 of event 2026-11-03 not found: invalid input syntax'))
      .toBe('Row 42 of event 2026-11-03 not found: invalid input syntax')
  })

  it('truncates after scrubbing', () => {
    const out = scrubMessage(`${'word '.repeat(400)}`)
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('routeLabel and errorDigest', () => {
  it('uses the route pattern and drops any query string', () => {
    expect(routeLabel('post', '/api/register/[slug]', '/api/register/co-sdc?x=1')).toBe('POST /api/register/[slug]')
    expect(routeLabel('GET', undefined, '/events/abc?email=a@b.co')).toBe('GET /events/abc')
  })

  it('groups the same error with different ids and numbers', () => {
    const a = errorDigest('GET /x', 'Row 41 missing for 3f1c2b9e-1111-4222-8333-444455556666')
    const b = errorDigest('GET /x', 'Row 42 missing for 9a8b7c6d-1111-4222-8333-444455556666')
    expect(a).toBe(b)
    expect(errorDigest('GET /y', 'Row 41 missing')).not.toBe(errorDigest('GET /x', 'Row 41 missing'))
  })
})

describe('takeWrite (per-digest rate limit)', () => {
  it('writes the first, batches repeats inside the window, then folds them in', () => {
    expect(takeWrite('d1', 1_000)).toBe(1)
    expect(takeWrite('d1', 2_000)).toBe(0)
    expect(takeWrite('d1', 3_000)).toBe(0)
    expect(takeWrite('d1', 1_000 + WRITE_WINDOW_MS)).toBe(3)
  })

  it('caps writes per minute across digests and keeps the overflow counted', () => {
    for (let i = 0; i < MAX_WRITES_PER_MINUTE; i++) expect(takeWrite(`d${i}`, 5_000)).toBe(1)
    expect(takeWrite('overflow', 5_000)).toBe(0)
    expect(takeWrite('overflow', 5_000 + 60_000)).toBe(2)
  })
})

describe('captureRequestError', () => {
  function db() {
    const fake = fakeSupabase()
    const calls: Record<string, unknown>[] = []
    fake.rpcs.record_app_error = (args) => { calls.push(args); return null }
    return { fake, calls }
  }

  it('records a scrubbed error with its route pattern', async () => {
    const { fake, calls } = db()
    await captureRequestError(new Error('No member for kid@example.test'), { path: '/api/x/1?k=v', method: 'POST' }, { routePath: '/api/x/[id]' }, { db: fake.client, now: 10 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ p_route: 'POST /api/x/[id]', p_message: 'Error: No member for [email]', p_count: 1 })
    expect(String(calls[0].p_digest)).toMatch(/^[0-9a-f]{32}$/)
  })

  it('writes a repeated error once per window', async () => {
    const { fake, calls } = db()
    for (let i = 0; i < 5; i++) await captureRequestError(new Error('boom'), { method: 'GET' }, { routePath: '/a' }, { db: fake.client, now: 100 + i })
    expect(calls).toHaveLength(1)
  })

  it('ignores Next control flow (redirect, notFound)', async () => {
    const { fake, calls } = db()
    await captureRequestError(Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/x;307;' }), {}, {}, { db: fake.client })
    await captureRequestError(Object.assign(new Error('nf'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' }), {}, {}, { db: fake.client })
    expect(calls).toHaveLength(0)
  })

  it('never throws: not when the write fails, not when there is no database', async () => {
    const { fake } = db()
    fake.rpcs.record_app_error = () => { throw new Error('db down') }
    await expect(captureRequestError(new Error('a'), {}, {}, { db: fake.client })).resolves.toBeUndefined()
    // No injected db → supabaseServer() throws (mocked) → swallowed.
    await expect(captureRequestError('plain string', {}, {})).resolves.toBeUndefined()
    await expect(captureRequestError(null, {}, {})).resolves.toBeUndefined()
  })
})

describe('recordBuiltAppError', () => {
  it('never throws, and says a failed write failed', async () => {
    // supabaseServer() throws (mocked). lib/authz/authz.test.ts covers the write itself.
    await expect(recordBuiltAppError('AUTHZ /x', 'authz_mismatch', 'digest-a')).resolves.toBe(false)
  })

  it('a write the rate limit holds back is not a failure', async () => {
    takeWrite('digest-b', Date.now())
    await expect(recordBuiltAppError('AUTHZ /x', 'authz_mismatch', 'digest-b')).resolves.toBe(true)
  })
})

describe('daily digest', () => {
  const now = new Date('2026-11-03T05:00:00Z')
  const row = (over: Record<string, unknown>) => ({
    id: String(Math.random()), digest: 'x', route: 'GET /a', message: 'Error: boom', count: 1,
    occurred_at: '2026-11-01T00:00:00Z', last_seen: '2026-11-03T01:00:00Z', ...over,
  })

  it('renders the section heading and escapes messages', () => {
    const email = renderErrorDigest([{ route: 'GET /a', message: '<script>x</script>', count: 3, occurred_at: '2026-11-02T10:00:00Z', last_seen: '2026-11-03T01:00:00Z' }])
    expect(email.subject).toBe('[Stellr] 1 server error in the last day')
    expect(email.html).toContain('Errors in the last day')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).not.toContain('<script>x')
    expect(email.text).toContain('GET /a · 3× total')
  })

  it('emails staff about errors seen in the last 24 hours, and prunes old rows', async () => {
    const fake = fakeSupabase({
      cron_runs: [],
      app_errors: [
        row({ digest: 'recent', count: 4 }),
        row({ digest: 'yesterday', last_seen: '2026-11-01T00:00:00Z' }),
        row({ digest: 'ancient', last_seen: '2026-07-01T00:00:00Z' }),
      ],
    })
    expect(await sendDailyErrorDigest(fake.client, now)).toEqual({ errors: 1, alerted: true })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const sent = (sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string }])[0]
    expect(sent.to).toBe('staff@example.test')
    expect(sent.subject).toBe('[Stellr] 1 server error in the last day')
    expect(fake.table('app_errors').map((r) => r.digest)).toEqual(['recent', 'yesterday'])
    expect(fake.table('cron_runs').some((r) => r.job === 'error-digest')).toBe(true)
  })

  it('sends nothing on a quiet day', async () => {
    const fake = fakeSupabase({ cron_runs: [], app_errors: [row({ last_seen: '2026-11-01T00:00:00Z' })] })
    expect(await sendDailyErrorDigest(fake.client, now)).toEqual({ errors: 0, alerted: false })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('never throws when the read fails', async () => {
    const fake = fakeSupabase({ cron_runs: [] }, { failOn: (t, a) => (t === 'app_errors' && a === 'select' ? 'db down' : null) })
    await expect(sendDailyErrorDigest(fake.client, now)).resolves.toEqual({ errors: 0, alerted: false })
  })
})
