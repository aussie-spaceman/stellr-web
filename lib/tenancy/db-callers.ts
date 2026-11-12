// The allow-list for lib/tenancy/db.ts (multi-tenancy plan S4, Option B:
// "an allow-listed forTenant() server path").
//
// Every file that imports lib/tenancy/db is named here, and
// lib/tenancy/db.test.ts fails on any other importer. S5 adds files one
// feature area per PR, each with its two-tenant tests. Browser code can
// never be on this list: tenantDb holds a database connection that may
// become tenant_app, and that credential is server-only.
//
// Dependency-free: the test reads it as data.

export const TENANT_DB_CALLERS: readonly string[] = [
  // The module's own tests.
  'lib/tenancy/db.test.ts',
  // The Postgres transport (C11). db.ts loads it, never the other way round:
  // its import of db.ts is type-only. Its unit tests drive tenantDb over a
  // stand-in postgres.js.
  'lib/tenancy/driver.ts',
  'lib/tenancy/driver.test.ts',
  // The two-tenant test through the real driver, run by CI's tenant-db job
  // against a throwaway local database (vitest.integration.config.mts).
  'test/integration/tenant-db.int.test.ts',
  // The per-area switch (C12) and its tests. It hands its callers a tenantDb,
  // so lib/tenancy/db.test.ts holds ITS importers to this list as well: an area
  // that adopts readArea or writeArea is named here, with its two-tenant tests.
  'lib/tenancy/area-switch.ts',
  'lib/tenancy/area-switch.test.ts',
  // The IDOR harness's tenantDb transport over the honey database (C12), so a
  // converted area's tenantDb reads stay inside test/idor. The harness
  // registers it; it answers nothing until a case turns tenantDb on.
  'test/idor/harness.ts',
  'test/idor/tenant-db-fake.ts',
  'test/idor/tenant-db-fake.test.ts',
  // The two-tenant kit (C12): a seed and helpers, on a real database in CI's
  // tenant-db job, that prove an area returns only its tenant's rows on both
  // paths.
  'test/integration/two-tenant/kit.ts',
  'test/integration/two-tenant/kit.int.test.ts',
  // The first converted area (C18): events admin configuration ('events-config'),
  // through readArea and writeArea. The routes reach it only through this module.
  // Its unit test registers a stand-in driver. Its two-tenant test
  // (test/integration/two-tenant/events-config.int.test.ts) reaches tenantDb only
  // through the kit and this module, so it is not listed itself.
  'lib/events/admin-config.ts',
  'lib/events/admin-config.test.ts',
]
