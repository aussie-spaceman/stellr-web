// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { rows, one, allRows } from './db'

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

describe('allRows', () => {
  // deep review QUAL-9: a single page capped at `size` is exactly the silent
  // truncation `.limit(2000)` hid — allRows must keep paging until a short page.
  it('pages past the 1,000-row cap instead of stopping at one full page', async () => {
    const all = Array.from({ length: 1003 }, (_, i) => ({ id: i }))
    const calls: Array<[number, number]> = []
    const got = await allRows(
      (from, to) => {
        calls.push([from, to])
        return Promise.resolve({ data: all.slice(from, to + 1), error: null })
      },
      'regs',
    )
    expect(got).toHaveLength(1003) // a non-paging read would return 1000
    expect(calls).toEqual([[0, 999], [1000, 1999]])
  })

  it('stops after the first short page', async () => {
    const calls: number[] = []
    const got = await allRows(
      (from, to) => {
        calls.push(from)
        return Promise.resolve({ data: from === 0 ? [{ id: 1 }, { id: 2 }] : [], error: null })
      },
      'small',
    )
    expect(got).toEqual([{ id: 1 }, { id: 2 }])
    expect(calls).toEqual([0]) // only one request
  })

  it('throws (fails loud) on an error mid-paging rather than returning a short list', async () => {
    await expect(
      allRows((from) => (from === 0 ? ok(Array.from({ length: 1000 }, (_, i) => ({ id: i }))) : fail('timeout')), 'regs'),
    ).rejects.toThrow(/regs: timeout/)
  })
})
