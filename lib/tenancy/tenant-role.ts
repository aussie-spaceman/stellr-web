// What the tenant_app role may do beyond "rows of its own tenant"
// (multi-tenancy plan S4, docs/TENANCY-S4.md "What tenant_app may write").
//
// Two rules sit on top of the per-table tenant policies in
// supabase/migrations/20261104200000_tenant_isolation_policies.sql:
//
// 1. Routing, ownership and role tables are READ-ONLY to tenant_app. Platform
//    code (service_role) writes them. Otherwise a tenant could:
//      * claim another tenant's event slug in public.events (slugs are
//        globally unique, and tenancy_derive_tenant_id() finds a row's tenant
//        by its slug, so the squatter would be handed the other tenant's
//        registrations);
//      * claim any host in public.tenant_domains (S5 routes Host -> tenant
//        from it);
//      * grant itself, or anyone, the 'owner' role in public.tenant_memberships.
//
// 2. A row a tenant writes may point only at its own tenant's rows. The
//    tenant_isolation_guard policy's WITH CHECK requires every foreign key to
//    a tenant table, and the row's event key, to name a row tenant_app can
//    see (its own tenant's, through RLS on the parent). Without it a tenant
//    could attach its row to another tenant's registration or module: the FK
//    check runs as the table owner, so it succeeds, and its 23503 error would
//    also reveal whether another tenant's id exists. A key to a via_parent
//    table (no tenant_id yet, so no grant to tenant_app) must be NULL until
//    that table gets its own column.
//
// supabase/tests/database/tenant_isolation.test.sql (generated) checks
// TENANT_PARENT_REFS against the real foreign keys, so a new foreign key
// between tenant tables fails the db job until it is listed here and guarded.
//
// Dependency-free: Node imports this file directly from the generator.

/** Tenant tables tenant_app may read (own tenant only) but never write. */
export const TENANT_APP_READ_ONLY_TABLES: readonly string[] = [
  'public.events',
  'public.tenant_domains',
  'public.tenant_memberships',
]

/**
 * Platform-level tables that carry a tenant_id but are classified platform in
 * lib/tenancy/registry.ts, so tenant_app gets no policy and no grant on them.
 * The matrix (supabase/tests/database/tenant_isolation.test.sql) asserts
 * tenant_app holds no privilege at all on each. Key: table. Value: why.
 */
export const TENANT_APP_NO_ACCESS_TABLES: Readonly<Record<string, string>> = {
  'public.platform_audit_events':
    'hash-chained audit (S4 audit lane): written by service_role through lib/audit/platform.ts; a tenant must not read or rewrite the chain, and tenant_id is nullable (NULL = the platform chain)',
  'public.tenant_data_keys':
    'wrapped field-encryption data keys (S4 field-crypto lane): read only by service_role through lib/field-crypto-store.ts; a tenant session never needs key material, and deleting a row crypto-shreds the tenant',
}

export interface TenantParentRef {
  /** The referencing tenant table (own/derived). */
  table: string
  /** Its foreign-key column. */
  column: string
  /** The referenced tenant table. */
  parent: string
}

/** Every single-column foreign key from an own/derived tenant table to a tenant table (tenant_id itself excluded). */
export const TENANT_PARENT_REFS: readonly TenantParentRef[] = [
  { table: 'public.agreements', column: 'participant_id', parent: 'public.participants' },
  { table: 'public.agreements', column: 'reused_from', parent: 'public.agreements' },
  { table: 'public.community_resources', column: 'space_id', parent: 'public.community_spaces' },
  { table: 'public.credentials', column: 'module_id', parent: 'public.training_modules' },
  { table: 'public.credentials', column: 'participant_id', parent: 'public.participants' },
  { table: 'public.event_award_assignments', column: 'company_id', parent: 'public.event_companies' },
  { table: 'public.event_award_assignments', column: 'participant_id', parent: 'public.participants' },
  { table: 'public.event_badge_templates', column: 'company_id', parent: 'public.event_companies' },
  { table: 'public.event_email_sends', column: 'event_email_id', parent: 'public.event_emails' },
  { table: 'public.event_refunds', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.group_invoices', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.group_join_tokens', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.mentoring_cohorts', column: 'parent_container_id', parent: 'public.mentoring_cohorts' },
  { table: 'public.mentoring_cohorts', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.scholarship_applications', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.store_orders', column: 'registration_id', parent: 'public.registrations' },
  { table: 'public.store_orders', column: 'source_order_id', parent: 'public.store_orders' },
  { table: 'public.survey_responses', column: 'distribution_id', parent: 'public.survey_distributions' },
  { table: 'public.survey_responses', column: 'invitation_id', parent: 'public.survey_invitations' },
  { table: 'public.survey_responses', column: 'participant_id', parent: 'public.participants' },
  { table: 'public.team_profiles', column: 'participant_id', parent: 'public.participants' },
  { table: 'public.team_profiles', column: 'prefilled_from', parent: 'public.team_profiles' },
  { table: 'public.training_assignments', column: 'module_id', parent: 'public.training_modules' },
]

/**
 * Tables with a foreign key to themselves. A policy may not query its own
 * table (Postgres reports infinite recursion, 42P17), so for these the guard
 * calls public.tenant_self_ref_visible(table, id) instead: a SECURITY INVOKER
 * function whose own query is planned separately, so RLS still limits it to
 * the tenant's rows. Derived from TENANT_PARENT_REFS.
 */
export const SELF_REF_TABLES: readonly string[] = [
  ...new Set(TENANT_PARENT_REFS.filter((r) => r.parent === r.table).map((r) => r.table)),
].sort()

/** The registry fields guardWithCheck needs (a TableEntry satisfies it). */
export interface GuardEntry {
  tenantColumn: string
  eventKey?: { column: string; kind: 'slug' | 'sanity_id' }
}

const bare = (qualified: string) => qualified.split('.').pop() as string

/**
 * The exact WITH CHECK of a table's tenant_isolation_guard policy.
 * `viaParent` names the tenant tables that have no tenant_id yet (so a key to
 * them must be NULL for tenant_app).
 */
export function guardWithCheck(
  table: string,
  entry: GuardEntry,
  viaParent: ReadonlySet<string>,
  refs: readonly TenantParentRef[] = TENANT_PARENT_REFS,
): string {
  const self = bare(table)
  const parts = ['tenant_id = (SELECT public.app_tenant_id())']
  if (entry.tenantColumn === 'derived' && entry.eventKey) {
    const key = entry.eventKey.column
    const eventCol = entry.eventKey.kind === 'slug' ? 'slug' : 'sanity_id'
    parts.push(`(${self}.${key} IS NULL OR EXISTS (SELECT 1 FROM public.events e WHERE e.${eventCol} = ${self}.${key}))`)
  }
  for (const r of refs.filter((x) => x.table === table)) {
    if (viaParent.has(r.parent)) parts.push(`${self}.${r.column} IS NULL`)
    else if (r.parent === table) parts.push(`(${self}.${r.column} IS NULL OR public.tenant_self_ref_visible('${self}', ${self}.${r.column}))`)
    else parts.push(`(${self}.${r.column} IS NULL OR EXISTS (SELECT 1 FROM ${r.parent} p WHERE p.id = ${self}.${r.column}))`)
  }
  return parts.join('\n    AND ')
}
