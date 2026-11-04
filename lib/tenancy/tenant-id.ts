// Tenant id validation, shared by lib/tenancy/db.ts and lib/tenancy/storage.ts.
// Kept apart from db.ts so a module can validate a tenant id without being an
// importer of the database path (lib/tenancy/db-callers.ts).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

/** Thrown when tenant-scoped code runs without a valid tenant (or tenantDb cannot run). */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantContextError'
  }
}

/** The canonical (lower-case) tenant id, or throws. Never echoes the bad value. */
export function assertTenantId(tenantId: unknown): string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new TenantContextError('tenantDb needs a tenant id: none was given')
  }
  const id = tenantId.trim().toLowerCase()
  if (!UUID.test(id) || id === NIL_UUID) {
    throw new TenantContextError('tenantDb needs a tenant id: the value given is not a tenant uuid')
  }
  return id
}
