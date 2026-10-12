// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeDb } from './fake-supabase'

// FakeDb.client is typed `never` so it can stand in for a real SupabaseClient in
// a vi.mock; drive it directly here through a minimal query-builder shape.
type Chain = {
  select: (c?: string) => Chain
  is: (c: string, v: unknown) => Chain
  insert: (p: Record<string, unknown>) => Chain
  then: (res: (v: { data: unknown; error: unknown }) => unknown) => Promise<unknown>
}
const sb = (db: FakeDb) => db.client as unknown as { from: (t: string) => Chain }

// deep review TEST-7: the Supabase double never checked query shape, so a broken
// query passed its test — notably `.is('revoke_at', null)` (a misspelled column)
// matched EVERY row (`undefined ?? null === null`). An opt-in per-table schema
// now makes a filter or a write against an undeclared column throw.

describe('fakeSupabase schema validation (TEST-7)', () => {
  it('throws on a filter against a column the schema does not declare', async () => {
    const db = fakeSupabase(
      { credentials: [{ id: 'c1', revoked_at: null }] },
      { schema: { credentials: ['id', 'revoked_at'] } },
    )
    await expect(
      sb(db).from('credentials').select('id').is('revoke_at', null) as unknown as Promise<unknown>,
    ).rejects.toThrow(/unknown column "revoke_at"/)
  })

  it('allows the correctly-spelled column and returns the right rows', async () => {
    const db = fakeSupabase(
      { credentials: [{ id: 'c1', revoked_at: null }, { id: 'c2', revoked_at: '2026-01-01' }] },
      { schema: { credentials: ['id', 'revoked_at'] } },
    )
    const { data } = await sb(db).from('credentials').select('id').is('revoked_at', null)
    // The matched set is the right one — only the row whose revoked_at IS null.
    expect((data as { id: string }[]).map((r) => r.id)).toEqual(['c1'])
  })

  it('throws on a write to an undeclared column', async () => {
    const db = fakeSupabase({ credentials: [] }, { schema: { credentials: ['id', 'revoked_at'] } })
    await expect(
      sb(db).from('credentials').insert({ revokd_at: '2026-01-01' }) as unknown as Promise<unknown>,
    ).rejects.toThrow(/unknown column "revokd_at"/)
  })

  it('leaves tables without a declared schema loose, so existing suites are unaffected', async () => {
    const db = fakeSupabase({ things: [{ id: 't1' }] }) // no schema given
    const { data } = await sb(db).from('things').select('id').is('mispelled', null)
    expect(Array.isArray(data)).toBe(true)
  })
})
