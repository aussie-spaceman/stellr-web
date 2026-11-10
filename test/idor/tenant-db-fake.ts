// A tenantDb transport for the IDOR suites (multi-tenancy plan S5, C12).
//
// The honey database (test/idor/honey-db.ts) stands in for supabase-js. An
// area that reads through tenantDb (lib/tenancy/area-switch.ts, tenant mode)
// never touches supabase-js, so without this it would leave the harness: its
// reads would throw "tenantDb is off" and the case would prove nothing. This
// driver lets lib/tenancy/db.ts run unchanged (the pin, the read-back after
// every statement, the statement checks) and answers each caller statement
// the way row level security would, against the same honey row:
//
//   * a transaction pinned to the honey row's tenant can see it. A statement
//     returns it (a READ of tenant B: the response scan then reports a leak),
//     or, for INSERT / UPDATE / DELETE / MERGE, records a HONEY WRITE, unless
//     the statement binds a value that scopes it to the caller (their member
//     or Clerk id, the event an event manager is assigned to): the same rule
//     honey-db applies to a filter on an identity column
//   * a transaction pinned to any other tenant cannot: reads return nothing,
//     UPDATE and DELETE touch nothing, and an INSERT or MERGE that binds a
//     Canary value is refused with 42501, as the tenant policies refuse a row
//     that names another tenant's parent
//   * a statement before the pin, or as anything but tenant_app, is refused
//     with 42501, as the bare login is
//
// What it cannot see: the statement's WHERE clause. It decides from the pinned
// tenant and the bound values only, so a converted area's own tests (and the
// two-tenant kit, test/integration/two-tenant/kit.ts, on a real database)
// still prove the SQL. What it does prove is the part a route can get wrong
// without any SQL mistake: which tenant it pins, and where that id came from.
//
// It is registered by test/idor/harness.ts. With TENANT_DB_ENABLED off, which
// is how every case runs unless it asks otherwise, no area reaches it.

import { HONEYTOKENS, isCanaryId } from '@/lib/testing/honeytokens'
import {
  PIN_CHECK_SQL,
  READ_ONLY_CHECK_SQL,
  READ_ONLY_SQL,
  TENANT_ROLE,
  type TenantQueryResult,
  type TenantSqlDriver,
  type TenantSqlTx,
} from '@/lib/tenancy/db'
import { carriesHoneytoken, honeySqlRow, type HoneyDbState } from './honey-db'

export interface TenantDbFakeState {
  db: HoneyDbState
  /** Values that, bound in a statement, scope it to the caller: their ids, an event manager's event. */
  scopingValues: readonly string[]
}

/** Every statement a fake transaction saw, for tests of the fake itself. */
export interface FakeStatement {
  tenant: string | null
  text: string
  values: readonly unknown[]
}

const WRITE = /^\s*(?:insert|update|delete|merge)\b/i
const WITH_WRITE = /^\s*with\b[\s\S]*\b(?:insert\s+into|update\s+[\w."]+\s+set|delete\s+from|merge\s+into)\b/i
const TABLE = /\b(?:from|into|update|join)\s+((?:"?[a-z_][\w]*"?\.)?"?[a-z_][\w]*"?)/i

const refused = (message: string) => Object.assign(new Error(message), { code: '42501' })

function namesHoney(db: HoneyDbState, values: readonly unknown[], ignore: readonly string[] = []): boolean {
  return values.some(
    (v) => isCanaryId(v) || carriesHoneytoken(v, ignore) !== null || (typeof v === 'string' && db.honeyTokens.includes(v)),
  )
}

const empty = <R>(): TenantQueryResult<R> => ({ rows: [], rowCount: 0 })

/** A TenantSqlDriver over the honey database. `log`, when given, receives every caller statement. */
export function honeyTenantDriver(state: () => TenantDbFakeState, log?: FakeStatement[]): TenantSqlDriver {
  return {
    async transaction<T>(fn: (tx: TenantSqlTx) => Promise<T>): Promise<T> {
      let role = 'tenant_app_login'
      let tenant: string | null = null
      let readOnly = false
      const tx: TenantSqlTx = {
        async query<R>(text: string, values: readonly unknown[] = []): Promise<TenantQueryResult<R>> {
          if (text === `SET LOCAL ROLE ${TENANT_ROLE}`) {
            role = TENANT_ROLE
            return empty()
          }
          if (/^SELECT set_config\('stellr\.tenant_id', \$1, true\)$/.test(text)) {
            tenant = typeof values[0] === 'string' ? values[0] : null
            return empty()
          }
          if (text === PIN_CHECK_SQL) return { rows: [{ role, tenant } as R], rowCount: 1 }
          if (text === READ_ONLY_SQL) {
            readOnly = true
            return empty()
          }
          if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as R], rowCount: 1 }

          const { db, scopingValues } = state()
          log?.push({ tenant, text, values })
          if (role !== TENANT_ROLE || tenant === null) throw refused('permission denied (no tenant pinned)')
          if (namesHoney(db, values)) db.touched = true

          const table = (TABLE.exec(text)?.[1] ?? 'unknown').replace(/"/g, '')
          const isWrite = WRITE.test(text) || WITH_WRITE.test(text)
          // As Postgres refuses a write in a READ ONLY transaction.
          if (readOnly && isWrite) throw Object.assign(new Error('cannot execute in a read-only transaction'), { code: '25006' })
          const visible = !db.honeyAbsent && tenant === db.honeyTenantId
          const scoped = values.some((v) => typeof v === 'string' && scopingValues.includes(v))

          if (visible && !scoped) {
            if (isWrite) {
              db.writes.push({ table, op: 'tenantdb', detail: 'a write ran while pinned to the Canary row’s tenant, not scoped to the caller' })
            } else {
              db.honeyReads.push(table)
            }
            const returns = !isWrite || /\breturning\b/i.test(text)
            return { rows: returns ? [honeySqlRow(db) as R] : [], rowCount: 1 }
          }
          // Storing an address the caller typed is not a reference to tenant B's row.
          if (isWrite && /^\s*(?:insert|merge)\b/i.test(text) && namesHoney(db, values, [HONEYTOKENS.email])) {
            throw refused('new row violates row-level security policy')
          }
          return empty()
        },
      }
      return fn(tx)
    },
  }
}
