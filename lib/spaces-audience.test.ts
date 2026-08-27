import { describe, it, expect, vi } from 'vitest'

// The three space-access resolvers have to agree. They did not before: the admin
// Members tab read community_space_members directly while the member count read
// the derived audience, so every tier and role Space showed a roster of nobody
// next to a non-zero count. These tests pin the agreement down.
//
// The dataset below is deliberately awkward — an expired membership, a
// deactivated member, an unaccepted invite, a revocation sitting on top of a
// tier grant — because those are the cases the two implementations disagreed on.

const DATA: Record<string, Record<string, unknown>[]> = {
  members: [
    { id: 'm1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x.test', is_active: true, deleted_at: null },
    { id: 'm2', first_name: 'Bo', last_name: 'Reed', email: 'bo@x.test', is_active: true, deleted_at: null },
    { id: 'm3', first_name: 'Cy', last_name: 'Nolan', email: 'cy@x.test', is_active: true, deleted_at: null },
    { id: 'm4', first_name: 'Di', last_name: 'Park', email: 'di@x.test', is_active: true, deleted_at: null },
    { id: 'm5', first_name: 'Ely', last_name: 'Fox', email: 'ely@x.test', is_active: true, deleted_at: null },
    // Deactivated: keeps every tier and role row, must appear in no audience.
    { id: 'm6', first_name: 'Gone', last_name: 'Away', email: 'gone@x.test', is_active: false, deleted_at: null },
  ],
  community_spaces: [
    { id: 'sp-open', slug: 'general', name: 'General', access_type: 'open', is_archived: false, display_order: 0 },
    { id: 'sp-tier', slug: 'scholars', name: 'Scholars', access_type: 'private', is_archived: false, display_order: 1 },
    { id: 'sp-role', slug: 'volunteers', name: 'Volunteers', access_type: 'private', is_archived: false, display_order: 2 },
    { id: 'sp-secret', slug: 'inner', name: 'Inner Circle', access_type: 'secret', is_archived: false, display_order: 3 },
    // Linked to an event AND carrying a tier and a role grant. That combination
    // is the bug this suite now pins: the grants must count for nothing.
    { id: 'sp-event', slug: 'nevada', name: 'Nevada Challenge', access_type: 'private', is_archived: false, display_order: 4 },
  ],
  community_space_tiers: [
    { space_id: 'sp-tier', tier_id: 'T1' },
    { space_id: 'sp-secret', tier_id: 'T2' },
    { space_id: 'sp-event', tier_id: 'T1' },
  ],
  community_space_roles: [
    { space_id: 'sp-role', role: 'volunteer' },
    { space_id: 'sp-event', role: 'volunteer' },
  ],
  community_space_sources: [{ space_id: 'sp-event', object_type: 'event', object_ref: 'ev-1' }],
  community_space_members: [
    { space_id: 'sp-tier', member_id: 'm5', role: 'moderator', status: 'active', muted: false, invited_by: null, added_at: '2026-01-01' },
    // Invited but never accepted — an admin must see them, an audience must not.
    { space_id: 'sp-role', member_id: 'm2', role: 'moderator', status: 'invited', muted: false, invited_by: 'admin-1', added_at: '2026-02-01' },
    // Written by syncObjectSpaceRoster when m3 registered for the event.
    { space_id: 'sp-event', member_id: 'm3', role: 'member', status: 'active', muted: false, invited_by: null, added_at: '2026-03-01' },
  ],
  member_memberships: [
    { member_id: 'm1', tier_id: 'T1', expires_at: null, renewal_status: 'active' },
    { member_id: 'm2', tier_id: 'T2', expires_at: null, renewal_status: 'active' },
    // Lapsed: renewal_status still says active, the date says otherwise.
    { member_id: 'm3', tier_id: 'T1', expires_at: '2020-01-01', renewal_status: 'active' },
    { member_id: 'm6', tier_id: 'T1', expires_at: null, renewal_status: 'active' },
  ],
  member_roles: [
    { member_id: 'm4', role: 'volunteer', scope: 'global' },
    { member_id: 'm6', role: 'volunteer', scope: 'global' },
  ],
  community_space_suspensions: [
    // Revoked despite holding the granting tier — the case a roster delete cannot express.
    { space_id: 'sp-tier', member_id: 'm1', scope: 'access', expires_at: null },
    // Suspended from posting: still in the audience, still reads.
    { space_id: 'sp-role', member_id: 'm4', scope: 'posting', expires_at: null },
    // Already expired — must read as lifted, not as an active block.
    { space_id: 'sp-open', member_id: 'm3', scope: 'access', expires_at: '2020-01-01T00:00:00Z' },
  ],
}

/** Chainable Supabase stub that actually applies eq/in/is filters. */
function makeDb() {
  return {
    from(table: string) {
      let rows = [...(DATA[table] ?? [])]
      const chain: Record<string, unknown> = {}
      const settle = () => ({ data: rows, error: null })
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val)
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]))
          return chain
        },
        is: (col: string, val: unknown) => {
          rows = rows.filter((r) => (r[col] ?? null) === val)
          return chain
        },
        order: () => chain,
        range: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        single: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(settle()),
      })
      return chain
    },
  }
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => makeDb() }))
vi.mock('@/lib/tiers-server', () => ({
  getActiveTierNames: async () => new Map<string, string>(),
  resolveTierMap: async () => ({ nameById: {} }),
}))
vi.mock('@/lib/space-inheritance', () => ({
  objectActiveMemberIds: async (_db: unknown, _type: string, ref: string) =>
    (ref === 'ev-1' ? ['m3'] : []),
}))
vi.mock('@/lib/member-roles', () => ({
  ROLE_LABELS: { volunteer: 'Volunteer' },
  getGlobalRoleNames: async (id: string) =>
    DATA.member_roles.filter((r) => r.member_id === id).map((r) => r.role as string),
}))

const {
  resolveSpaceAccess,
  resolveSpaceAudiences,
  resolveSpaceAudience,
  resolveMemberSpaces,
  resolveDerivedGrant,
  NO_SUSPENSIONS,
} = await import('@/lib/spaces')

const ids = (rows: { memberId: string }[]) => rows.map((r) => r.memberId).sort()

const memberStub = (over: Partial<{ id: string; isAdmin: boolean; activeTierIds: string[] }> = {}) => ({
  id: 'm1',
  first_name: null,
  last_name: null,
  email: null,
  isAdmin: false,
  hasPaidTier: false,
  activeTierName: null,
  activeTierIds: [] as string[],
  event_role: null,
  age_bracket: null,
  ...over,
})

describe('resolveSpaceAccess — revocation outranks every positive grant', () => {
  const revoked = { access: true, posting: false }

  it('beats an open space', () => {
    const a = resolveSpaceAccess(memberStub(), { access_type: 'open' }, [], null, [], [], revoked)
    expect(a.canAccess).toBe(false)
    expect(a.reason).toBe('revoked')
  })

  it('beats a tier grant', () => {
    const a = resolveSpaceAccess(
      memberStub({ activeTierIds: ['T1'] }), { access_type: 'private' }, ['T1'], null, [], [], revoked
    )
    expect(a.canAccess).toBe(false)
    expect(a.revoked).toBe(true)
  })

  it('beats a role grant', () => {
    const a = resolveSpaceAccess(
      memberStub(), { access_type: 'private' }, [], null, ['volunteer'], ['volunteer'], revoked
    )
    expect(a.canAccess).toBe(false)
  })

  it('beats an active roster row — the case deleting the row cannot express', () => {
    const a = resolveSpaceAccess(
      memberStub(), { access_type: 'private' }, [], { role: 'member', status: 'active', muted: false }, [], [], revoked
    )
    expect(a.canAccess).toBe(false)
  })

  it('never blocks a platform admin, who is the one moderating', () => {
    const a = resolveSpaceAccess(memberStub({ isAdmin: true }), { access_type: 'private' }, [], null, [], [], revoked)
    expect(a.canAccess).toBe(true)
    expect(a.reason).toBe('admin')
  })

  it('stays invisible on a secret space, visible-but-restricted elsewhere', () => {
    expect(resolveSpaceAccess(memberStub(), { access_type: 'secret' }, [], null, [], [], revoked).visible).toBe(false)
    expect(resolveSpaceAccess(memberStub(), { access_type: 'private' }, [], null, [], [], revoked).visible).toBe(true)
    expect(resolveSpaceAccess(memberStub(), { access_type: 'open' }, [], null, [], [], revoked).visible).toBe(true)
  })
})

describe('resolveSpaceAccess — posting suspension', () => {
  it('leaves access intact and only flags posting', () => {
    const a = resolveSpaceAccess(
      memberStub(), { access_type: 'open' }, [], null, [], [], { access: false, posting: true }
    )
    expect(a.canAccess).toBe(true)
    expect(a.postingSuspended).toBe(true)
  })

  it('is absent by default, so existing callers are unchanged', () => {
    const a = resolveSpaceAccess(memberStub(), { access_type: 'open' }, [], null)
    expect(a).toMatchObject({ canAccess: true, reason: 'open', revoked: false, postingSuspended: false })
    expect(NO_SUSPENSIONS).toEqual({ access: false, posting: false })
  })
})

describe('resolveSpaceAudiences', () => {
  it('drops revoked, lapsed and deactivated members but keeps posting-suspended ones', async () => {
    const audiences = await resolveSpaceAudiences()

    // m1 holds T1 but is revoked; m3's T1 membership expired; m6 is deactivated.
    expect(ids(audiences.get('sp-tier') ?? [])).toEqual(['m5'])

    // m4 is role-granted and posting-suspended — still in the audience.
    const role = audiences.get('sp-role') ?? []
    expect(ids(role)).toEqual(['m4'])
    expect(role[0].postingSuspended).toBe(true)

    // Open: every live member, including m3 whose revocation has expired.
    expect(ids(audiences.get('sp-open') ?? [])).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])

    expect(ids(audiences.get('sp-secret') ?? [])).toEqual(['m2'])
  })
})

describe('resolveSpaceAudience — the admin roster is a superset, not a second answer', () => {
  it('reduces to resolveSpaceAudiences once invited and revoked rows are removed', async () => {
    const audiences = await resolveSpaceAudiences()
    for (const spaceId of ['sp-open', 'sp-tier', 'sp-role', 'sp-secret']) {
      const detail = await resolveSpaceAudience(spaceId)
      const reduced = detail.filter((r) => r.status === 'active' && !r.revoked)
      expect(ids(reduced), `space ${spaceId}`).toEqual(ids(audiences.get(spaceId) ?? []))
    }
  })

  it('surfaces the revoked and the invited that the audience hides', async () => {
    const tier = await resolveSpaceAudience('sp-tier')
    const m1 = tier.find((r) => r.memberId === 'm1')
    expect(m1?.revoked).toBe(true)
    expect(m1?.reason).toBe('tier')

    const role = await resolveSpaceAudience('sp-role')
    expect(role.find((r) => r.memberId === 'm2')?.status).toBe('invited')
  })

  it('names the specific grant, so revoke copy can explain itself', async () => {
    const tier = await resolveSpaceAudience('sp-tier')
    expect(tier.find((r) => r.memberId === 'm1')?.grantRef).toBe('T1')
    const role = await resolveSpaceAudience('sp-role')
    expect(role.find((r) => r.memberId === 'm4')?.grantRef).toBe('volunteer')
  })

  it('trims an open space to its exceptions', async () => {
    const all = await resolveSpaceAudience('sp-open')
    expect(all).toHaveLength(5)
    // Nobody on the open space holds a role, a suspension or a roster row.
    expect(await resolveSpaceAudience('sp-open', { exceptionsOnly: true })).toHaveLength(0)
  })
})

describe('resolveMemberSpaces — the inverse view agrees with the roster view', () => {
  it('reports each space with the same reason the roster gives', async () => {
    for (const memberId of ['m1', 'm2', 'm3', 'm4', 'm5']) {
      const mine = await resolveMemberSpaces(memberId)
      for (const grant of mine) {
        const roster = await resolveSpaceAudience(grant.spaceId)
        const row = roster.find((r) => r.memberId === memberId)
        expect(row, `${memberId} in ${grant.slug}`).toBeTruthy()
        expect(row!.reason, `${memberId} in ${grant.slug}`).toBe(grant.reason)
        expect(row!.revoked).toBe(grant.revoked)
      }
    }
  })

  it('keeps a revoked space listed so an admin can lift it', async () => {
    const mine = await resolveMemberSpaces('m1')
    const tier = mine.find((g) => g.spaceId === 'sp-tier')
    expect(tier?.revoked).toBe(true)
  })

  it('includes open spaces — the gap that made the Person 360 under-report', async () => {
    const mine = await resolveMemberSpaces('m5')
    expect(mine.map((g) => g.spaceId)).toContain('sp-open')
    expect(mine.find((g) => g.spaceId === 'sp-open')?.reason).toBe('open')
  })
})

describe('resolveDerivedGrant — what demoting a moderator must not destroy', () => {
  // The Space role is an overlay carried by a roster row, but access is usually
  // derived. Demotion deletes the row, which is right for someone who is also
  // tier- or role-granted and catastrophic for someone whose row is their only
  // way in. This is the check that tells those two apart.

  it('names the tier that would still let them in', async () => {
    // m1 holds T1, which grants sp-tier.
    expect(await resolveDerivedGrant('sp-tier', 'm1')).toEqual({ reason: 'tier', grantRef: 'T1' })
  })

  it('names the web-app role that would still let them in', async () => {
    expect(await resolveDerivedGrant('sp-role', 'm4')).toEqual({ reason: 'role', grantRef: 'volunteer' })
  })

  it('treats an open space as a grant for everyone', async () => {
    expect(await resolveDerivedGrant('sp-open', 'm5')).toEqual({ reason: 'open', grantRef: null })
  })

  it('returns null when the roster row is the ONLY way in — deleting it would remove access', async () => {
    // m5 is a moderator on sp-tier by roster and holds no granting tier or role.
    expect(await resolveDerivedGrant('sp-tier', 'm5')).toBeNull()
  })

  it('ignores a lapsed membership, which is not a grant', async () => {
    // m3's T1 membership expired in 2020.
    expect(await resolveDerivedGrant('sp-tier', 'm3')).toBeNull()
  })
})


describe('an event Space admits its registrants and nobody else', () => {
  // sp-event is linked to an event AND still carries a tier grant (T1) and a
  // role grant (volunteer) in the tables. Those are exactly the rows migration
  // 145 deleted from the six real event Spaces, and they are left here on
  // purpose: the resolvers must reach the right answer even when the rows exist,
  // because a Space linked to an event afterwards would otherwise keep its old,
  // wider audience.
  //
  // Before this rule, community_space_roles matched a member's GLOBAL role, so
  // 'teacher' on an event Space admitted every teacher in the organisation
  // rather than the teachers at that event — 7 members held access to all 6
  // event Spaces in prod without registering for any of them.

  it('ignores the tier grant: m1 holds T1 and is still not in the audience', async () => {
    const audiences = await resolveSpaceAudiences()
    expect(ids(audiences.get('sp-event') ?? [])).toEqual(['m3'])
  })

  it('ignores the role grant: m4 is a volunteer and is still not in the audience', async () => {
    const roster = await resolveSpaceAudience('sp-event')
    expect(roster.map((r) => r.memberId)).not.toContain('m4')
  })

  it('does not offer the event Space to a member who only holds the tier', async () => {
    const mine = await resolveMemberSpaces('m1')
    expect(mine.map((g) => g.spaceId)).not.toContain('sp-event')
  })

  it('admits the registrant, attributed to the event rather than to a rule', async () => {
    const mine = await resolveMemberSpaces('m3')
    const grant = mine.find((g) => g.spaceId === 'sp-event')
    expect(grant).toBeTruthy()
    expect(grant!.reason).toBe('object')
    expect(grant!.grantRef).toBe('event:ev-1')
  })

  it('will not name a tier or role as the fallback that survives a demotion', async () => {
    // The dangerous version: resolveDerivedGrant answering 'tier' here would let
    // an admin delete m3's roster row believing T1 would still let them in.
    expect(await resolveDerivedGrant('sp-event', 'm1')).toBeNull()
    expect(await resolveDerivedGrant('sp-event', 'm4')).toBeNull()
    expect(await resolveDerivedGrant('sp-event', 'm3')).toEqual({ reason: 'object', grantRef: 'event:ev-1' })
  })
})
