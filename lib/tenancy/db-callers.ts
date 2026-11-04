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
]
