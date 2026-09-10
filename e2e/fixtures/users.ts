/**
 * The fixture users, and where their saved sessions live.
 *
 * These mirror `supabase/seed.sql` exactly. The member ids are the seed's fixed
 * UUIDs, so a spec can navigate straight to a known record rather than creating
 * one through the UI — which is most of the runtime of an E2E suite.
 *
 * The addresses carry Clerk's `+clerk_test` subaddress. On a development
 * instance Clerk treats those as test users: no mail is sent and a fixed
 * verification code is accepted, which is what lets these sign in without an
 * inbox.
 *
 * Passwords come from the environment, never from this file. They are set when
 * the users are created in Clerk and are specific to one development instance,
 * so committing them would both leak a credential and break the suite for
 * anyone with a different instance.
 */

export type FixtureRole = 'member' | 'teacher' | 'admin'

export interface Fixture {
  /** Clerk sign-in address; matches members.email in seed.sql. */
  email: string
  /** Environment variable holding this user's password. */
  passwordVar: string
  /** members.id in seed.sql — stable, so specs can deep-link. */
  memberId: string
  /** What this fixture exists to exercise. */
  covers: string
}

export const FIXTURES: Record<FixtureRole, Fixture> = {
  member: {
    email: 'ada.student+clerk_test@example.com',
    passwordVar: 'E2E_MEMBER_PASSWORD',
    memberId: '00000000-0000-4000-a000-000000000001',
    covers: 'tier gating, community, registration — Pathfinder, active',
  },
  teacher: {
    email: 'grace.teacher+clerk_test@example.com',
    passwordVar: 'E2E_TEACHER_PASSWORD',
    memberId: '00000000-0000-4000-a000-000000000002',
    covers: 'teacher onboarding, group registration — Educator, complimentary',
  },
  admin: {
    email: 'alan.admin+clerk_test@example.com',
    passwordVar: 'E2E_ADMIN_PASSWORD',
    memberId: '00000000-0000-4000-a000-000000000003',
    covers: '/admin routes — carries the staff role',
  },
}

/**
 * Fixtures with no Clerk account. They exist to be *looked at* by an
 * authenticated user, not to sign in themselves — an expired membership and an
 * inactive member are states the access gates must handle, and a suite that
 * only ever sees healthy records is not testing them.
 */
export const UNAUTHENTICATED_FIXTURES = {
  mentor: { memberId: '00000000-0000-4000-a000-000000000004', note: 'Contributor tier, active' },
  lapsed: { memberId: '00000000-0000-4000-a000-000000000005', note: 'inactive, membership expired yesterday' },
} as const

export function storageStatePath(role: FixtureRole): string {
  return `e2e/.auth/${role}.json`
}
