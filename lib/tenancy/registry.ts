// The table registry (multi-tenancy plan S3): every table in the `public` and
// `entitlements` schemas, classified by who owns its rows.
//
//   tenant_scoped  belongs to one tenant, not to a particular event
//   event_scoped   belongs to one event, and so to that event's tenant
//   platform       platform-wide reference or control data (no tenant)
//   stellr_only    Stellr's own products — community, academy, coaching,
//                  membership, store catalogue, marketing. Blocked on tenant
//                  hosts (plan, Target architecture); never tenant data
//   identity       a person's own record, shared across tenants (S7 identity)
//   system         operational plumbing: crons, budgets, webhook idempotency,
//                  error capture
//
// tenantColumn says how a tenant/event-scoped row knows its tenant:
//
//   own         the table carries tenant_id NOT NULL, written directly
//   derived     nullable tenant_id set by the zz_tenancy_derive_tenant_id
//               trigger from the row's event key (S3 expand,
//               20261104130000); NOT NULL after the enforce cut-over
//   inherited   nullable tenant_id copied from its `parent` row (through
//               `parentKey`) by the zz_tenancy_derive_tenant_id trigger calling
//               tenancy_inherit_tenant_id (S5 C0b). The composite FK is held
//               back: see the note on the child() block below
//   via_parent  reaches its tenant only through `parent`, with no column. Only
//               tables that pre-date S3 may use this. None does since S5 C0b
//   none        platform / stellr_only / identity / system tables
//
// Enforced by lib/tenancy/registry.test.ts (against the CREATE TABLEs in
// supabase/baseline.sql + timestamped migrations) and, for new migrations, by
// scripts/check-migration-tenancy.mjs (npm run lint:migrations). A new table
// must be added here in the same change that creates it.
//
// Dependency-free on purpose: Node imports this file directly from the lint.

export type TableClass = 'tenant_scoped' | 'event_scoped' | 'platform' | 'stellr_only' | 'identity' | 'system'
export type TenantColumn = 'own' | 'derived' | 'inherited' | 'via_parent' | 'none'
export type EventKeyKind = 'slug' | 'sanity_id'

export interface TableEntry {
  class: TableClass
  tenantColumn: TenantColumn
  /** For `derived`: the column holding the event key and what it holds. */
  eventKey?: { column: string; kind: EventKeyKind }
  /** For `inherited` and `via_parent`: the table (schema-qualified) the row belongs to. */
  parent?: string
  /** For `inherited`: the column on this table holding the parent's id. */
  parentKey?: string
  /** For `inherited`: parentKey is deliberately not a foreign key, so the row can outlive its parent. */
  noForeignKey?: boolean
  note?: string
}

/** The event-key column names that make a table event-scoped. */
export const EVENT_KEY_COLUMNS: Record<string, EventKeyKind> = {
  event_slug: 'slug',
  event_ref: 'sanity_id',
  sanity_event_id: 'sanity_id',
}

const slug = (note?: string): TableEntry => ({
  class: 'event_scoped',
  tenantColumn: 'derived',
  eventKey: { column: 'event_slug', kind: 'slug' },
  ...(note ? { note } : {}),
})
const sanity = (column: 'event_ref' | 'sanity_event_id', note?: string): TableEntry => ({
  class: 'event_scoped',
  tenantColumn: 'derived',
  eventKey: { column, kind: 'sanity_id' },
  ...(note ? { note } : {}),
})
const child = (parent: string, parentKey: string, opts: { noForeignKey?: boolean; note?: string } = {}): TableEntry => ({
  class: 'event_scoped',
  tenantColumn: 'inherited',
  parent,
  parentKey,
  ...opts,
})
const own = (note?: string): TableEntry => ({ class: 'tenant_scoped', tenantColumn: 'own', ...(note ? { note } : {}) })
const plain = (cls: 'platform' | 'stellr_only' | 'identity' | 'system', note?: string): TableEntry => ({
  class: cls,
  tenantColumn: 'none',
  ...(note ? { note } : {}),
})
const platform = (note?: string) => plain('platform', note)
const stellr = (note?: string) => plain('stellr_only', note)
const identity = (note?: string) => plain('identity', note)
const system = (note?: string) => plain('system', note)

export const TABLE_REGISTRY: Record<string, TableEntry> = {
  // ── entitlements schema: the coaching / mentoring allowance ledger ────────
  'entitlements.account_credit_ledger': stellr('membership allowance ledger'),
  'entitlements.bookings': stellr(),
  'entitlements.coupon_redemptions': stellr(),
  'entitlements.discounts': stellr(),
  'entitlements.entitlements': stellr(),
  'entitlements.member_grant_runs': stellr(),
  'entitlements.offerings': stellr(),
  'entitlements.prices': stellr(),
  'entitlements.processed_events': system('Stripe webhook idempotency (event_id is a Stripe event id, not an event)'),
  'entitlements.tier_benefits': stellr(),
  'entitlements.tiers': stellr(),

  // ── S3 tenancy model ─────────────────────────────────────────────────────
  'public.tenants': platform('the tenant list itself'),
  'public.tenant_domains': own('host -> tenant'),
  'public.tenant_memberships': own('roles inside a tenant'),
  'public.platform_admins': platform(),
  'public.events': own('mirror of Sanity events'),
  'public.tenancy_settings': system('derivation mode'),
  'public.tenancy_derivation_log': system('derivation orphan counts'),

  // ── S4 field encryption ──────────────────────────────────────────────────
  'public.tenant_data_keys': platform(
    'wrapped per-tenant field-encryption data keys (lib/field-crypto.ts). Platform-level although it carries tenant_id NOT NULL: key material is read only by service_role through lib/field-crypto-store.ts, never by tenant_app (lib/tenancy/tenant-role.ts TENANT_APP_NO_ACCESS_TABLES)',
  ),

  // ── Event-scoped, tenant derived from event_slug ─────────────────────────
  'public.agreements': slug('e-sign envelopes (renamed from docusign_envelopes)'),
  'public.credentials': slug(),
  'public.event_award_assignments': slug(),
  'public.event_badge_templates': slug(),
  'public.event_certificate_templates': slug(),
  'public.event_companies': slug(),
  'public.event_email_sends': slug(),
  'public.event_emails': slug(),
  'public.event_manager_assignments': slug(),
  'public.event_participations': slug(),
  'public.event_refunds': slug(),
  'public.event_settings': slug(),
  'public.event_store_offerings': slug(),
  'public.group_invoices': slug(),
  'public.group_join_tokens': slug(),
  'public.member_groups': slug('event_slug optional: a group with no event logs no_key'),
  'public.merch_batches': slug(),
  'public.refund_policies': slug('event_slug optional: global policies log no_key'),
  'public.registrations': slug(),
  'public.scholarship_applications': slug(),
  'public.store_event_discounts': slug(),
  'public.store_orders': slug('event_slug optional: non-event orders log no_key'),
  'public.survey_access_log': slug(),
  'public.survey_distributions': slug(),
  'public.survey_responses': slug(),
  'public.team_profiles': slug(),
  'public.volunteer_event_interest': slug(),

  // ── Event-scoped, tenant derived from a Sanity event _id ─────────────────
  'public.community_resources': sanity('event_ref', 'event_ref optional: general resources log no_key'),
  'public.community_spaces': sanity('sanity_event_id', 'optional: non-event Spaces log no_key'),
  'public.mentoring_cohorts': sanity('sanity_event_id', 'optional'),
  'public.training_assignments': sanity('event_ref'),
  'public.training_modules': sanity('event_ref', 'optional: academy modules log no_key'),

  // ── Event-scoped through a parent row (S5 C0b) ───────────────────────────
  // Each has tenant_id, copied from the parent by a trigger. A composite FK
  // beside the existing single-column one would give PostgREST two relationships
  // between the same two tables, and it refuses an unhinted embed in that case
  // (PGRST201). Live code embeds these relations without hints, so the composite
  // FK waits until they carry them. lib/tenancy/load-scoped.test.ts fails on a
  // second foreign key.
  'public.participants': child('public.registrations', 'registration_id'),
  'public.agreement_recipients': child('public.agreements', 'envelope_row'),
  'public.agreement_email_changes': child('public.agreements', 'agreement_id'),
  'public.esign_access_log': child('public.agreements', 'envelope_row', {
    noForeignKey: true,
    note: 'the log must outlive the record it describes',
  }),
  'public.esign_audit_events': child('public.agreements', 'envelope_row', {
    noForeignKey: true,
    note: 'the trail must not vanish by cascade; removed only with the record, at the end of retention',
  }),
  'public.credential_events': child('public.credentials', 'credential_id'),
  'public.member_group_members': child('public.member_groups', 'group_id'),
  'public.store_order_items': child('public.store_orders', 'order_id'),
  'public.store_returns': child('public.store_orders', 'order_id'),
  'public.survey_invitations': child('public.survey_distributions', 'distribution_id'),
  'public.survey_answers': child('public.survey_responses', 'response_id'),

  // ── Identity: a person's own record ──────────────────────────────────────
  'public.members': identity(),
  'public.member_activity_log': identity(),
  'public.member_addresses': identity(),
  'public.member_allergies': identity(),
  'public.member_background_checks': identity('safeguarding checks; per-jurisdiction records in S11'),
  'public.member_external_background_checks': identity('background checks the member already holds from another organisation; admin-verified'),
  'public.member_directory_prefs': identity(),
  'public.member_ethnicities': identity(),
  'public.member_notification_prefs': identity(),
  'public.member_pending_consent': identity(),
  'public.member_privacy_prefs': identity(),
  'public.member_schools': identity(),
  'public.member_teacher_licenses': identity(),
  'public.deletion_archive': identity('deletion pipeline snapshots'),
  'public.deletion_requests': identity(),
  'public.privacy_requests': identity(),

  // ── Platform reference and control data ──────────────────────────────────
  'public.allergy_options': platform('reference list'),
  'public.ethnicity_options': platform('reference list'),
  'public.schools': platform('school directory'),
  'public.platform_pricing': platform(),
  'public.audit_log': platform('row audit; platform_audit_events in S4'),
  'public.platform_audit_events': platform(
    'S4 hash-chained audit. Nullable tenant_id names the chain (NULL = the platform chain), so it is not own (own means NOT NULL)',
  ),
  'public.email_suppressions': platform('global suppression list'),

  // ── Stellr-only products ─────────────────────────────────────────────────
  'public.account_credits': stellr('Stellr credit balances; S9 ledger replaces'),
  'public.credit_redemptions': stellr(),
  'public.chat_channels': stellr('community'),
  'public.chat_messages': stellr('community'),
  'public.coaching_requests': stellr('coaching'),
  'public.cohort_members': stellr('mentoring'),
  'public.cohort_training_links': stellr('mentoring'),
  'public.community_announcements': stellr('community'),
  'public.community_channels': stellr('community'),
  'public.community_comments': stellr('community'),
  'public.community_flags': stellr('community'),
  'public.community_notifications': stellr('community'),
  'public.community_post_reads': stellr('community'),
  'public.community_posts': stellr('community'),
  'public.community_reactions': stellr('community'),
  'public.community_space_invites': stellr('community'),
  'public.community_space_members': stellr('community'),
  'public.community_space_roles': stellr('community'),
  'public.community_space_sources': stellr('community'),
  'public.community_space_suspensions': stellr('community'),
  'public.community_space_tiers': stellr('community'),
  'public.community_space_training': stellr('community'),
  'public.container_contents': stellr('access objects'),
  'public.content_entitlements': stellr('access objects'),
  'public.content_persistence': stellr('access objects'),
  'public.content_prerequisites': stellr('access objects'),
  'public.course_object_assignments': stellr('academy'),
  'public.default_badge_templates': stellr('per-theme artwork defaults'),
  'public.default_certificate_templates': stellr('per-theme artwork defaults'),
  'public.email_campaign_queue': stellr('marketing'),
  'public.email_campaign_sends': stellr('marketing'),
  'public.email_campaigns': stellr('marketing'),
  'public.email_templates': stellr('marketing'),
  'public.esign_templates': stellr('agreement templates; per-tenant with the S12 legal pack'),
  'public.host_availability': stellr('coaching'),
  'public.member_memberships': stellr('Stellr membership subscriptions'),
  'public.member_roles': stellr('Stellr RBAC; converges into tenant_memberships in S5'),
  'public.membership_tiers': stellr(),
  'public.object_roles': stellr('access objects'),
  'public.object_type_relations': stellr('access objects'),
  'public.object_type_singleton_roles': stellr('access objects'),
  'public.sent_reminders': stellr('coaching / training reminders'),
  'public.session_action_templates': stellr('coaching'),
  'public.session_actions': stellr('coaching'),
  'public.session_hosts': stellr('coaching'),
  'public.session_participants': stellr('coaching'),
  'public.recording_offloads': stellr('academy + coaching: a recording on its way from the room to storage'),
  'public.sessions': stellr('coaching'),
  'public.staff_roles': stellr('Stellr staff scopes; mapped to Stellr staff memberships'),
  'public.store_products': stellr('store catalogue'),
  'public.store_tier_discounts': stellr('store catalogue'),
  'public.store_variants': stellr('store catalogue'),
  'public.survey_definitions': stellr('survey definition versions'),
  'public.survey_question_catalog': stellr(),
  'public.tier_grant_rules': stellr(),
  'public.training_certificates': stellr('academy; event linkage lives on training_modules'),
  'public.training_enrollments': stellr('academy'),
  'public.training_item_resources': stellr('academy'),
  'public.training_items': stellr('academy'),
  'public.training_progress': stellr('academy'),
  'public.training_sections': stellr('academy'),

  // ── System plumbing ──────────────────────────────────────────────────────
  'public.app_errors': system(),
  'public.crawler_hits': system(),
  // Stays system: its nullable tenant_id only labels a per-tenant child row
  // (S5 B3). tenant_app has no grant on it (TENANT_APP_NO_ACCESS_TABLES).
  'public.cron_runs': system(),
  'public.email_outbox': system('platform mail queue; each row was addressed by the sender that queued it'),
  'public.email_outbox_blobs': system(),
  'public.email_send_quota': system(),
  'public.esign_email_budget': system(),
  'public.esign_provider_state': system(),
  'public.lead_capture_failures': system(),
  'public.rate_limit_hits': system('limiter counters; a tenant is part of the hashed key, not a column'),
  'public.sheet_watch_channels': system(),
  'public.stripe_webhook_events': system(),
  'public.survey_email_budget': system(),
  'public.video_watermark_jobs': system(),
}

/**
 * Derived tables that hold only Stellr's rows (S5 B9): community and training, plan
 * decision 12. Each has this CHECK (tenant_id IS NULL OR Stellr), so a write that would
 * stamp another tenant is refused with 23514. Migration
 * 20261106234759_community_stellr_only_check.sql; test/community-stellr-only.test.ts.
 */
export const STELLR_ONLY_CHECKS: readonly { table: string; constraint: string }[] = [
  { table: 'public.community_resources', constraint: 'community_resources_stellr_only' },
  { table: 'public.community_spaces', constraint: 'community_spaces_stellr_only' },
  { table: 'public.mentoring_cohorts', constraint: 'mentoring_cohorts_stellr_only' },
  { table: 'public.training_modules', constraint: 'training_modules_stellr_only' },
]

/** Tables whose tenant_id the S3 trigger derives, with their event key. */
export function derivedTables(): { table: string; column: string; kind: EventKeyKind }[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([, e]) => e.tenantColumn === 'derived' && e.eventKey)
    .map(([table, e]) => ({ table, column: e.eventKey!.column, kind: e.eventKey!.kind }))
    .sort((a, b) => a.table.localeCompare(b.table))
}

/** Tables whose tenant_id the S5 C0b trigger copies from a parent row. */
export function inheritedTables(): { table: string; column: string; parent: string; noForeignKey: boolean }[] {
  return Object.entries(TABLE_REGISTRY)
    .filter(([, e]) => e.tenantColumn === 'inherited' && e.parent && e.parentKey)
    .map(([table, e]) => ({ table, column: e.parentKey!, parent: e.parent!, noForeignKey: e.noForeignKey === true }))
    .sort((a, b) => a.table.localeCompare(b.table))
}

/** A registry entry's internal consistency problems (none = valid). */
export function entryProblems(table: string, e: TableEntry, registry: Record<string, TableEntry> = TABLE_REGISTRY): string[] {
  const out: string[] = []
  const scoped = e.class === 'tenant_scoped' || e.class === 'event_scoped'
  if (scoped && e.tenantColumn === 'none') out.push(`${table}: ${e.class} needs a tenantColumn other than none`)
  if (!scoped && e.tenantColumn !== 'none') out.push(`${table}: ${e.class} tables must use tenantColumn none`)
  if (e.tenantColumn === 'derived' && !e.eventKey) out.push(`${table}: derived needs an eventKey`)
  if (e.tenantColumn !== 'derived' && e.eventKey) out.push(`${table}: eventKey is only for derived tables`)
  if (e.tenantColumn === 'via_parent' || e.tenantColumn === 'inherited') {
    if (!e.parent) out.push(`${table}: ${e.tenantColumn} needs a parent`)
    else if (!registry[e.parent]) out.push(`${table}: parent ${e.parent} is not in the registry`)
    else if (registry[e.parent].class !== 'event_scoped' && registry[e.parent].class !== 'tenant_scoped') {
      out.push(`${table}: parent ${e.parent} is not tenant- or event-scoped`)
    }
  } else if (e.parent) out.push(`${table}: parent is only for inherited and via_parent tables`)
  if (e.tenantColumn === 'inherited' && !e.parentKey) out.push(`${table}: inherited needs a parentKey`)
  if (e.tenantColumn !== 'inherited' && (e.parentKey || e.noForeignKey)) {
    out.push(`${table}: parentKey and noForeignKey are only for inherited tables`)
  }
  return out
}
