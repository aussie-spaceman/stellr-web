// How TENANT_DB_ENABLED and TENANT_DB_AREAS are read (S5, C11 and C12). Pure and
// dependency-free: lib/tenancy/db.ts and lib/tenancy/area-switch.ts read the two
// variables through this module and re-export what they always exported, so the
// switch registry (lib/tenancy/flags.ts) can resolve them without importing
// either of those. Both hand out a tenant database, and lib/tenancy/db.test.ts
// holds their importers to lib/tenancy/db-callers.ts.
//
// Moved here unchanged in wave 7 (O1): nothing about how either variable is read
// changed. Like area-switch.ts, this file is in .github/CODEOWNERS: a change to
// which areas can be switched, how an entry parses, or what turns the tenant
// database on needs the owner's review (lib/tenancy/flags.test.ts pins that).

/** The env flag that turns the tenant database on. Anything but exactly 'true' is off. */
export const TENANT_DB_FLAG = 'TENANT_DB_ENABLED'

export function isTenantDbEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[TENANT_DB_FLAG] === 'true'
}

/** The variable that names the areas reading through tenantDb. */
export const TENANT_DB_AREAS_ENV = 'TENANT_DB_AREAS'

/**
 * Every area that may be switched. A name not listed here is ignored in
 * TENANT_DB_AREAS and is a type error at a call site. C18 owns the first one;
 * nothing calls dataPath, readArea or writeArea with it yet.
 */
export const DATA_AREAS = ['events-config'] as const
export type DataArea = (typeof DATA_AREAS)[number]

export type DataPath = 'service' | 'shadow' | 'tenant'
export const DATA_PATHS: readonly DataPath[] = ['service', 'shadow', 'tenant']

export interface AreaSetting {
  path: Exclude<DataPath, 'service'>
  /** Shadow only: the share of calls that also run the tenantDb read, 0 to 1. */
  sample: number
}

export interface AreaConfig {
  /** Per area, for the areas set to shadow or tenant. Absent means service. */
  areas: ReadonlyMap<string, AreaSetting>
  /** How many entries were ignored. Never the entries themselves. */
  ignored: number
}

const ENTRY = /^([a-z][a-z0-9-]{0,63}):(shadow|tenant)(?::(0(?:\.\d{1,6})?|1(?:\.0{1,6})?))?$/

/**
 * Parse a TENANT_DB_AREAS value. Pure. An entry that does not parse, names an
 * area outside `known`, gives a rate to `tenant`, or repeats an area is
 * ignored; a repeated area is dropped altogether (both entries), so a
 * conflicting list leaves it on the service path.
 */
export function parseAreas(raw: string | undefined, known: readonly string[] = DATA_AREAS): AreaConfig {
  const areas = new Map<string, AreaSetting>()
  const repeated = new Set<string>()
  let ignored = 0
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim()
    if (entry === '') continue
    const m = ENTRY.exec(entry)
    if (!m || !known.includes(m[1]) || (m[2] === 'tenant' && m[3] !== undefined)) {
      ignored++
      continue
    }
    const [, area, path, rate] = m
    if (areas.has(area) || repeated.has(area)) {
      if (areas.delete(area)) ignored++
      repeated.add(area)
      ignored++
      continue
    }
    areas.set(area, { path: path as AreaSetting['path'], sample: rate === undefined ? 1 : Number(rate) })
  }
  return { areas, ignored }
}
