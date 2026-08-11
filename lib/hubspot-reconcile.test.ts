import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}))
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => fn(),
  NextResponse: { json: (b: unknown) => b },
}))

// The module reads the token once at import, so it must be set beforehand.
vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'test-token')

const { reconcileLogEntry } = await import('./hubspot')

const ENTRY = '2026-08-11 · Event Notify · nevada-2027 · Group'
const EMAIL = 'probe@example.com'

/** Minimal stand-in for the contact record the repair reads and writes. */
function stubHubSpot(initialLog: string) {
  const state = { log: initialLog, writes: [] as string[] }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'

      if (method === 'GET') {
        return new Response(
          JSON.stringify({ id: '123', properties: { event_notify_log: state.log } }),
          { status: 200 },
        )
      }

      const body = JSON.parse(String(init?.body ?? '{}'))
      const written = body.properties?.event_notify_log
      if (typeof written === 'string') {
        state.log = written
        state.writes.push(written)
      }
      return new Response(JSON.stringify({ id: '123' }), { status: 200 })
    }),
  )

  return state
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Let the backoff delays elapse while the async work proceeds. */
async function run(promise: Promise<boolean>) {
  await vi.runAllTimersAsync()
  return promise
}

describe('reconcileLogEntry', () => {
  it('does nothing when the entry is already present', async () => {
    const state = stubHubSpot(`older line\n${ENTRY}`)

    await expect(run(reconcileLogEntry(EMAIL, ENTRY))).resolves.toBe(true)
    expect(state.writes).toEqual([])
  })

  /**
   * The failure found in production: four submissions, three log lines. Two
   * requests read the same log, and the second write erased the first one's
   * entry. The repair must restore it without discarding what won the race.
   */
  it('restores an entry erased by a concurrent write', async () => {
    const state = stubHubSpot('earlier line\nthe entry that won the race')

    await expect(run(reconcileLogEntry(EMAIL, ENTRY))).resolves.toBe(true)

    expect(state.log.split('\n')).toEqual([
      'earlier line',
      'the entry that won the race',
      ENTRY,
    ])
    expect(state.writes).toHaveLength(1)
  })

  it('appends onto an empty log', async () => {
    const state = stubHubSpot('')
    await run(reconcileLogEntry(EMAIL, ENTRY))
    expect(state.log).toBe(ENTRY)
  })

  it('does not duplicate when the repair itself is retried', async () => {
    const state = stubHubSpot('other')
    await run(reconcileLogEntry(EMAIL, ENTRY))
    await run(reconcileLogEntry(EMAIL, ENTRY))

    expect(state.log.split('\n').filter((l) => l === ENTRY)).toHaveLength(1)
  })
})
