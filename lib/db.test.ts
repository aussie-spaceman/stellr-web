// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { rows, one } from './db'

// deep review QUAL-6: a read must fail LOUD, not read an outage as "no rows".

const ok = <T>(data: T) => Promise.resolve({ data, error: null })
const fail = (message: string) => Promise.resolve({ data: null, error: { message } })

describe('rows', () => {
  it('returns the rows on success', async () => {
    expect(await rows(ok([{ id: 1 }, { id: 2 }]), 'x')).toEqual([{ id: 1 }, { id: 2 }])
  })
  it('returns [] when data is null and there is no error', async () => {
    expect(await rows(ok(null as unknown as unknown[]), 'x')).toEqual([])
  })
  it('throws (fails closed) on an error instead of reading it as no rows', async () => {
    await expect(rows(fail('timeout'), 'session participants')).rejects.toThrow(/session participants: timeout/)
  })
})

describe('one', () => {
  it('returns the row on success and null on empty', async () => {
    expect(await one(ok({ id: 1 }), 'x')).toEqual({ id: 1 })
    expect(await one(ok(null), 'x')).toBeNull()
  })
  it('throws on an error', async () => {
    await expect(one(fail('5xx'), 'member')).rejects.toThrow(/member: 5xx/)
  })
})
