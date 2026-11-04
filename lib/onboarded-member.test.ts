import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state } = vi.hoisted(() => ({ state: { member: null as Record<string, unknown> | null } }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => state.member }))

const { getOnboardedMember } = await import('./onboarded-member')

beforeEach(() => {
  state.member = null
})

describe('getOnboardedMember', () => {
  it('is null when nobody is signed in', async () => {
    expect(await getOnboardedMember()).toBeNull()
  })

  it('is null for an account that still needs onboarding (no DOB yet)', async () => {
    state.member = { id: 'm1', date_of_birth: null, needsOnboarding: true }
    expect(await getOnboardedMember()).toBeNull()
  })

  it('returns an onboarded member unchanged', async () => {
    state.member = { id: 'm2', date_of_birth: '1990-01-01', needsOnboarding: false }
    expect(await getOnboardedMember()).toBe(state.member)
  })
})
