import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMemberOnFileByMembershipId } from './member-onfile'

// A fake client: the canonical id read and the member row come from `member`, the
// latest participant read (.maybeSingle) from `latest`, and the read of every
// participant row (awaited directly) from `allDobs`.
function makeDb(opts: {
  member: Record<string, unknown>
  latest?: Record<string, unknown> | null
  allDobs?: Array<string | null>
  allDobsError?: { message: string } | null
  /** Collects every filter the reads apply, as [table, column, value]. */
  filters?: Array<[string, string, unknown]>
}): SupabaseClient {
  const from = (table: string) => {
    const single = async () => ({
      data: table === 'members' ? { id: 'm-1', ...opts.member } : (opts.latest ?? null),
      error: null,
    })
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        opts.filters?.push([table, column, value])
        return chain
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: single,
      then: (onDone: (v: unknown) => unknown) =>
        Promise.resolve({
          data: opts.allDobsError ? null : (opts.allDobs ?? []).map((date_of_birth) => ({ date_of_birth })),
          error: opts.allDobsError ?? null,
        }).then(onDone),
    }
    return chain
  }
  return { from } as unknown as SupabaseClient
}

const MEMBER = { first_name: 'Mem', last_name: 'Ber', email: 'member@example.com', date_of_birth: '2000-05-05' }

describe('getMemberOnFileByMembershipId', () => {
  it.each([
    ['a short ID', '18'],
    ['a short ID with stray spaces', ' 18 '],
    ['the stored form', '0000018'],
  ])('%s resolves through the stored form', async (_l, submitted) => {
    const filters: Array<[string, string, unknown]> = []
    const onFile = await getMemberOnFileByMembershipId(makeDb({ member: MEMBER, filters }), submitted)
    expect(onFile).toMatchObject({ memberId: 'm-1', member_last_name: 'Ber' })
    expect(filters[0]).toEqual(['members', 'membership_id', '0000018'])
  })

  it.each([
    ['blank', '  '],
    ['not digits', 'STL-1'],
    ['longer than 7 digits', '12345678'],
  ])('an ID that is %s resolves to nothing, with no read', async (_l, submitted) => {
    const filters: Array<[string, string, unknown]> = []
    expect(await getMemberOnFileByMembershipId(makeDb({ member: MEMBER, filters }), submitted)).toBeNull()
    expect(filters).toEqual([])
  })

  it('keeps the member row’s surname apart from the latest participant row’s', async () => {
    const onFile = await getMemberOnFileByMembershipId(
      makeDb({ member: MEMBER, latest: { first_name: 'Par', last_name: 'Ticipant' } }),
      '0000001',
    )
    expect(onFile).toMatchObject({ first_name: 'Par', last_name: 'Ticipant', member_last_name: 'Ber' })
  })

  it('has no member surname when the member row has none', async () => {
    const onFile = await getMemberOnFileByMembershipId(
      makeDb({ member: { ...MEMBER, last_name: '' }, latest: { last_name: 'Ticipant' } }),
      '0000001',
    )
    expect(onFile).toMatchObject({ last_name: 'Ticipant', member_last_name: null })
  })

  it.each([
    ['a newer participant row carries an older date', '2010-03-03', { date_of_birth: '1990-01-01' }, ['1990-01-01', '2010-03-03'], '2010-03-03'],
    ['an older participant row carries the younger date', '1990-01-01', { date_of_birth: '1990-01-01' }, ['2010-03-03', '1990-01-01'], '2010-03-03'],
    ['only a participant row has a date', null, { date_of_birth: '2011-04-04' }, ['2011-04-04'], '2011-04-04'],
    ['the youngest date is unusable, so it does not count', '2000-05-05', null, ['2999-01-01'], '2000-05-05'],
    ['no date is usable', null, null, ['2999-01-01', null], null],
  ])('reads the youngest usable date of birth when %s', async (_l, memberDob, latest, allDobs, expected) => {
    const onFile = await getMemberOnFileByMembershipId(
      makeDb({ member: { ...MEMBER, date_of_birth: memberDob }, latest, allDobs }),
      '0000001',
    )
    expect(onFile?.date_of_birth).toBe(expected)
  })

  it('has no date of birth when the participant rows cannot be read', async () => {
    const onFile = await getMemberOnFileByMembershipId(
      makeDb({ member: MEMBER, allDobsError: { message: 'boom' } }),
      '0000001',
    )
    expect(onFile?.date_of_birth).toBeNull()
  })
})
