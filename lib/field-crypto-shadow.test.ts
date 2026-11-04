// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The write-site entry point must be inert by default and unable to fail the
// caller's write in any mode.

const supabaseServer = vi.fn()
const runAfterResponse = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => supabaseServer() }))
vi.mock('@/lib/after-response', () => ({ runAfterResponse: (l: string, t: () => Promise<unknown>) => runAfterResponse(l, t) }))

const KEYS = ['FIELD_CRYPTO_MODE', 'FIELD_CRYPTO_MASTER_KEY', 'FIELD_CRYPTO_KEY_ID', 'FIELD_CRYPTO_PREVIOUS_MASTER_KEY', 'FIELD_CRYPTO_PREVIOUS_KEY_ID']
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  supabaseServer.mockReset()
  runAfterResponse.mockReset()
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const load = async () => import('@/lib/field-crypto-shadow')

describe('shadowSyncFields', () => {
  it('does nothing at all with no configuration', async () => {
    const { shadowSyncFields, shadowWritesEnabled } = await load()
    expect(shadowWritesEnabled()).toBe(false)
    shadowSyncFields('participants', ['11111111-2222-4333-8444-555555555555'])
    expect(runAfterResponse).not.toHaveBeenCalled()
    expect(supabaseServer).not.toHaveBeenCalled()
  })

  it('does nothing in shadow mode without a master key', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    const { shadowSyncFields } = await load()
    shadowSyncFields('members', ['m1'])
    expect(runAfterResponse).not.toHaveBeenCalled()
  })

  it('does nothing in off mode even with a key', async () => {
    process.env.FIELD_CRYPTO_MASTER_KEY = randomBytes(32).toString('base64')
    process.env.FIELD_CRYPTO_KEY_ID = 'k-test'
    const { shadowSyncFields } = await load()
    shadowSyncFields('members', ['m1'])
    expect(runAfterResponse).not.toHaveBeenCalled()
  })

  it('does nothing with a malformed key, and does not throw', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    process.env.FIELD_CRYPTO_MASTER_KEY = 'short'
    process.env.FIELD_CRYPTO_KEY_ID = 'k-test'
    const { shadowSyncFields } = await load()
    expect(() => shadowSyncFields('members', ['m1'])).not.toThrow()
    expect(runAfterResponse).not.toHaveBeenCalled()
  })

  it('ignores empty id lists', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    process.env.FIELD_CRYPTO_MASTER_KEY = randomBytes(32).toString('base64')
    process.env.FIELD_CRYPTO_KEY_ID = 'k-test'
    const { shadowSyncFields } = await load()
    shadowSyncFields('members', [null, undefined, ''])
    expect(runAfterResponse).not.toHaveBeenCalled()
  })

  it('in shadow mode schedules after the response, and a failing task never rejects', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    process.env.FIELD_CRYPTO_MASTER_KEY = randomBytes(32).toString('base64')
    process.env.FIELD_CRYPTO_KEY_ID = 'k-test'
    supabaseServer.mockImplementation(() => {
      throw new Error('db unavailable')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { shadowSyncFields } = await load()
    shadowSyncFields('participants', ['11111111-2222-4333-8444-555555555555'])
    expect(runAfterResponse).toHaveBeenCalledTimes(1)
    const [label, task] = runAfterResponse.mock.calls[0]
    expect(label).toBe('field-crypto')
    await expect(task()).resolves.toBeUndefined()
    // Logged by code only: no key material.
    const logged = warn.mock.calls.flat().join(' ')
    expect(logged).toContain('[field-crypto]')
    expect(logged).not.toContain(process.env.FIELD_CRYPTO_MASTER_KEY!)
    warn.mockRestore()
  })

  it('in shadow mode writes ciphertext for the row, end to end through the store', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    process.env.FIELD_CRYPTO_MASTER_KEY = randomBytes(32).toString('base64')
    process.env.FIELD_CRYPTO_KEY_ID = 'k-e2e'
    const pid = '11111111-2222-4333-8444-555555555555'
    const row: Record<string, unknown> = {
      id: pid,
      health_conditions: 'Asthma',
      dietary_requirements: [],
      emergency_contact_first_name: null,
      emergency_contact_last_name: null,
      emergency_contact_email: 'guardian@example.test',
      emergency_contact_phone: null,
      emergency_contact_relationship: null,
      registrations: { tenant_id: '00000000-0000-4000-8000-000000000001' },
    }
    const keys: Record<string, unknown>[] = []
    // Just enough of the query builder for the DEK store and the shadow sync.
    const db = {
      from(table: string) {
        if (table === 'tenant_data_keys') {
          return {
            select: () => ({ eq: (_c: string, t: string) => ({ order: async () => ({ data: keys.filter((k) => k.tenant_id === t), error: null }) }) }),
            insert: async (r: Record<string, unknown>) => {
              keys.push({ ...r, created_at: new Date().toISOString(), retired_at: null })
              return { error: null }
            },
          }
        }
        return {
          select: () => ({ in: async () => ({ data: [{ ...row }], error: null }) }),
          // The shadow UPDATE is guarded on every plaintext column; it lands
          // only when .select() runs and every filter still matches.
          update: (patch: Record<string, unknown>) => {
            const preds: Array<() => boolean> = []
            const b = {
              eq: (c: string, v: unknown) => (preds.push(() => row[c] === v), b),
              is: (c: string, v: unknown) => (preds.push(() => row[c] === v), b),
              filter: (c: string, _op: string, v: string) => (preds.push(() => v === '{}' && Array.isArray(row[c]) && (row[c] as unknown[]).length === 0), b),
              select: async () => {
                if (!preds.every((p) => p())) return { data: [], error: null }
                Object.assign(row, patch)
                return { data: [{ id: row.id }], error: null }
              },
            }
            return b
          },
        }
      },
    }
    supabaseServer.mockReturnValue(db)
    const { shadowSyncFields } = await load()
    shadowSyncFields('participants', [pid])
    const [, task] = runAfterResponse.mock.calls[0]
    await task()
    expect(keys).toHaveLength(1)
    expect(String(keys[0].wrapped_dek).startsWith('wk1.k-e2e.')).toBe(true)
    expect(String(row.health_conditions_enc)).toMatch(/^sf1\./)
    expect(String(row.emergency_contact_email_bidx)).toMatch(/^bi1\./)
    expect(row.dietary_requirements_enc).toBeUndefined()
    // The plaintext is untouched.
    expect(row.health_conditions).toBe('Asthma')
  })

  it('swallows a scheduling failure', async () => {
    process.env.FIELD_CRYPTO_MODE = 'shadow'
    process.env.FIELD_CRYPTO_MASTER_KEY = randomBytes(32).toString('base64')
    process.env.FIELD_CRYPTO_KEY_ID = 'k-test'
    runAfterResponse.mockImplementation(() => {
      throw new Error('boom')
    })
    const { shadowSyncFields } = await load()
    expect(() => shadowSyncFields('members', ['m1'])).not.toThrow()
  })
})
