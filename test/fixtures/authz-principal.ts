/**
 * Test fixtures for lib/authz (multi-tenancy plan S5, slice C1): an in-memory
 * stand-in for the service-role Supabase client over the role tables, and a
 * truth-table of Stellr role scenarios with the S3 mapping applied.
 *
 * Synthetic ids only (the repo is public).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { planRoleMapping } from '@/lib/tenancy/role-mapping'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { Membership, Principal } from '@/lib/authz/decide'

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

export interface FakeDb {
  client: SupabaseClient
  /** Tables whose every read returns an error. */
  fail: Set<string>
  /** Every table read, in order. */
  reads: string[]
  /** Every rpc call, in order. */
  rpcs: { fn: string; args: Record<string, unknown> }[]
  tables: Tables
}

/**
 * A minimal query builder: from(t).select(cols).eq(col, v)…, awaited for a
 * list or ended with maybeSingle(). Enough for the reads lib/admin-auth,
 * lib/event-access and lib/authz make.
 */
export function fakeDb(tables: Tables = {}): FakeDb {
  const state: FakeDb = { client: null as unknown as SupabaseClient, fail: new Set(), reads: [], rpcs: [], tables }
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = []
    let columns: string[] = []
    const result = () => {
      state.reads.push(table)
      if (state.fail.has(table)) return { data: null, error: { message: `simulated failure on ${table}` } }
      const rows = (state.tables[table] ?? []).filter((r) => filters.every((keep) => keep(r)))
      // Only the selected columns come back, as from PostgREST: a read that
      // does not select tenant_id must not see one.
      return { data: rows.map((r) => Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]]))), error: null }
    }
    const builder = {
      select: (cols: string) => {
        columns = cols.split(',').map((c) => c.trim())
        return builder
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val)
        return builder
      },
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]))
        return builder
      },
      // The PostgREST `or` forms the readers use: "<col>.is.null" and
      // "<col>.gt.<value>" (lib/event-manager-active.ts). A missing column is null.
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => {
          const [col, op, ...rest] = p.split('.')
          const val = rest.join('.')
          return (r: Row) => {
            const v = r[col] ?? null
            if (op === 'is' && val === 'null') return v === null
            if (op === 'gt') return v !== null && String(v) > val
            throw new Error(`fakeDb.or: unsupported ${p}`)
          }
        })
        filters.push((r) => parts.some((keep) => keep(r)))
        return builder
      },
      maybeSingle: async () => {
        const r = result()
        return r.error ? r : { data: (r.data as Row[])[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject),
    }
    return builder
  }
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    state.rpcs.push({ fn, args })
    return { data: null, error: null }
  }
  state.client = { from, rpc } as unknown as SupabaseClient
  return state
}

export const USER = 'user_test_principal'
export const MEMBER = '11111111-1111-4111-8111-111111111111'
export const CANARY_TENANT_ID = '00000000-0000-4000-8000-0000000000c2'

/** One Stellr role situation, as today's authorities hold it. */
export interface Scenario {
  name: string
  signedIn: boolean
  /** Clerk publicMetadata.role surfaced into the session claim. */
  claimsRole: string | undefined
  /** event_manager_assignments.event_slug rows for the user. */
  assignments: string[]
  /** staff_roles.scopes for the member, or null for no staff_roles row. */
  staffScopes: string[] | null
  /** A members row exists for the Clerk user. */
  hasMember: boolean
  /** The owner's --platform-admins flag was passed to the S3 mapping. */
  platformFlag: boolean
}

/**
 * Today's data is "synced" when the Clerk event_manager role and holding an
 * assignment go together (an admin may hold assignments too). Only for synced
 * data does the S3 mapping reproduce today's answers exactly.
 */
export function isSynced(s: Scenario): boolean {
  if (!s.signedIn || s.claimsRole === 'admin') return true
  return (s.claimsRole === 'event_manager') === s.assignments.length > 0
}

export const CLAIM_ROLES: (string | undefined)[] = [undefined, 'admin', 'event_manager', 'student', 'staff']
export const ASSIGNMENT_SETS: string[][] = [[], ['ev-a'], ['ev-a', 'ev-b']]
export const SCOPE_SETS: (string[] | null)[] = [null, [], ['events'], ['all']]

/** Every combination, plus the signed-out case. */
export function allScenarios(): Scenario[] {
  const out: Scenario[] = [
    { name: 'signed out', signedIn: false, claimsRole: undefined, assignments: [], staffScopes: null, hasMember: false, platformFlag: false },
  ]
  for (const claimsRole of CLAIM_ROLES)
    for (const assignments of ASSIGNMENT_SETS)
      for (const hasMember of [true, false])
        for (const staffScopes of hasMember ? SCOPE_SETS : [null])
          for (const platformFlag of [false, true])
            out.push({
              name: `role=${claimsRole ?? '-'} assigned=${assignments.join('+') || '-'} member=${hasMember} scopes=${staffScopes === null ? '-' : staffScopes.join('+') || 'none'} platform=${platformFlag}`,
              signedIn: true,
              claimsRole,
              assignments,
              staffScopes,
              hasMember,
              platformFlag,
            })
  return out
}

/**
 * The role tables for a scenario: today's (members, staff_roles,
 * event_manager_assignments) plus the S3 mapping's output (tenant_memberships,
 * platform_admins), exactly as scripts/map-tenancy-roles.ts would write them.
 */
export function scenarioTables(s: Scenario): Tables {
  if (!s.signedIn) return {}
  const plan = planRoleMapping({
    clerkAdminIds: s.claimsRole === 'admin' ? [USER] : [],
    eventManagers: s.assignments.map(() => ({ clerk_user_id: USER })),
    staff: s.staffScopes !== null && s.hasMember ? [{ member_id: MEMBER, clerk_user_id: USER }] : [],
    existingMemberships: [],
    existingPlatformAdmins: [],
  })
  return {
    members: s.hasMember ? [{ id: MEMBER, clerk_user_id: USER }] : [],
    staff_roles: s.staffScopes !== null && s.hasMember ? [{ member_id: MEMBER, scopes: s.staffScopes }] : [],
    event_manager_assignments: s.assignments.map((slug) => ({ clerk_user_id: USER, event_slug: slug, tenant_id: STELLR_TENANT_ID })),
    platform_admins: s.platformFlag ? plan.platformAdmins.map((id) => ({ clerk_user_id: id, granted_by: 'owner' })) : [],
    tenant_memberships: plan.memberships.map((m) => ({ ...m })),
  }
}

/** The Clerk auth() result for a scenario. */
export function scenarioAuth(s: Scenario): { userId: string | null; sessionClaims: Record<string, unknown> | null } {
  if (!s.signedIn) return { userId: null, sessionClaims: null }
  return { userId: USER, sessionClaims: s.claimsRole === undefined ? { metadata: {} } : { metadata: { role: s.claimsRole } } }
}

/** A principal literal for pure decision tests. */
export function principal(over: Partial<Principal> = {}): Principal {
  return { userId: USER, claimsRole: undefined, memberId: MEMBER, platformAdmin: false, memberships: [], mode: 'normal', ...over }
}

export function membership(role: Membership['role'], tenantId: string = STELLR_TENANT_ID): Membership {
  return { tenantId, role }
}
