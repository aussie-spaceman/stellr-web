import type { EntityDef } from './types'

// Central, explicit deletion dependency graph. See ./types.ts for the rationale
// (FK behaviour is not fully discoverable from repo SQL; events are Sanity docs
// keyed by event_slug across several Postgres tables).
//
// `dependents` lists ONLY the relationships that should block a delete and be
// surfaced to the admin as "delete this first". Children that the DB already
// CASCADE-deletes (e.g. session_participants when a session goes) are not listed
// as blockers — they disappear with the parent and aren't the admin's concern.
//
// Verify the table/column names below against the live Supabase schema before
// relying on them in production (core tables live outside repo migrations).

const ISO = () => new Date().toISOString()

export const ENTITIES: Record<string, EntityDef> = {
  // ---- Members -----------------------------------------------------------
  member: {
    type: 'member',
    table: 'members',
    label: 'Member',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { is_active: false, deleted_at: ISO, clerk_user_id: null } },
    external: ['stripe', 'docusign'],
    // Most member-linked tables are ON DELETE CASCADE / SET NULL in the DB, so
    // a member can generally be removed. We still surface heavy linkages so an
    // admin understands the blast radius before a hard purge.
    dependents: [
      { table: 'registrations', fkColumn: 'teacher_member_id', label: 'event registrations (as teacher)' },
      { table: 'sessions', fkColumn: 'host_member_id', label: 'coaching/mentoring sessions (as host)' },
    ],
  },

  // ---- Schools -----------------------------------------------------------
  // Schools soft-delete via is_active (hidden from search/registration). A hard
  // purge is blocked while members are still linked via member_schools.
  school: {
    type: 'school',
    table: 'schools',
    label: 'School',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { is_active: false } },
    memberRequestable: true,
    dependents: [
      // Only ACTIVE members block. A soft-deleted member is hidden from the
      // school's member list (the page filters is_active !== false), so its
      // leftover member_schools row must not silently block the school delete.
      // The inner join also drops orphaned links whose member no longer exists.
      { table: 'member_schools', fkColumn: 'school_id', label: 'linked members',
        adminHref: '/admin/schools/{id}',
        activeJoin: { embed: 'members', column: 'is_active', removedValue: false } },
    ],
    // Hard purge clears the (by now inactive/orphan-only) member_schools links
    // too, so no join rows are left pointing at a deleted school.
    spans: [
      { table: 'member_schools', column: 'school_id' },
    ],
  },

  // ---- Events (Sanity doc + Postgres rows keyed by event_slug) -----------
  event: {
    type: 'event',
    table: 'event_settings', // representative row; real key is the slug
    label: 'Event',
    pk: 'event_slug',
    keyType: 'slug',
    softDelete: null,
    memberRequestable: true,
    // Blocked while registrations exist (which own participants); admin must
    // clear registrations first so participant/teacher data isn't silently lost.
    dependents: [
      { table: 'registrations', fkColumn: 'event_slug', label: 'registrations' },
      { table: 'event_participations', fkColumn: 'event_slug', label: 'participation records' },
    ],
    spans: [
      { table: 'event_settings', column: 'event_slug' },
      { table: 'event_companies', column: 'event_slug' },
      { table: 'event_manager_assignments', column: 'event_slug' },
    ],
  },

  // ---- Registrations / participants --------------------------------------
  // A registration is the unit for "delete a group" (type='group') or an
  // individual registration (type='individual'). Soft delete = withdrawn
  // (recoverable); hard delete cascades participants, their docusign_envelopes,
  // sheet_watch_channels and group_join_tokens in the DB. External cleanup
  // voids any in-flight DocuSign envelopes for every participant first.
  registration: {
    type: 'registration',
    table: 'registrations',
    label: 'Registration',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { status: 'withdrawn', withdrawn_at: ISO } },
    external: ['docusign'],
    dependents: [],
  },

  // A single participant within a registration ("delete a participant from an
  // event"). No soft-delete column exists, so only hard delete applies; the
  // participant's docusign_envelopes cascade in the DB and are voided upstream.
  participant: {
    type: 'participant',
    table: 'participants',
    label: 'Participant',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    external: ['docusign'],
    dependents: [],
  },

  event_participation: {
    type: 'event_participation',
    table: 'event_participations',
    label: 'Event participation record',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    memberRequestable: true,
    dependents: [],
  },

  // ---- Coaching / mentoring ----------------------------------------------
  session: {
    type: 'session',
    table: 'sessions',
    label: 'Coaching/mentoring session',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { status: 'cancelled' } },
    memberRequestable: true,
    // session_participants & session_actions cascade in the DB.
    dependents: [],
  },

  mentoring_cohort: {
    type: 'mentoring_cohort',
    table: 'mentoring_cohorts',
    label: 'Mentoring cohort',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { is_active: false } },
    // cohort_members cascade; sessions referencing the cohort are SET NULL.
    dependents: [
      { table: 'sessions', fkColumn: 'cohort_id', label: 'scheduled sessions' },
    ],
  },

  // ---- Email -------------------------------------------------------------
  email_campaign: {
    type: 'email_campaign',
    table: 'email_campaigns',
    label: 'Email campaign',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null, // email_campaign_sends cascade in the DB
    dependents: [],
  },

  email_template: {
    type: 'email_template',
    table: 'email_templates',
    label: 'Email template',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    // FK from email_campaigns.template_id is ON DELETE RESTRICT — campaigns
    // genuinely block template deletion.
    dependents: [
      { table: 'email_campaigns', fkColumn: 'template_id', label: 'campaigns using this template' },
    ],
  },

  // ---- DocuSign ----------------------------------------------------------
  docusign_envelope: {
    type: 'docusign_envelope',
    table: 'docusign_envelopes',
    label: 'DocuSign record',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    external: ['docusign'],
    dependents: [],
  },

  // ---- Community ---------------------------------------------------------
  community_space: {
    type: 'community_space',
    table: 'community_spaces',
    label: 'Community space',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { is_archived: true } },
    // posts cascade; resources are SET NULL. Surface posts so an admin knows.
    dependents: [
      { table: 'community_posts', fkColumn: 'space_id', label: 'posts',
        activeFilter: { column: 'status', value: 'published' } },
    ],
  },

  community_post: {
    type: 'community_post',
    table: 'community_posts',
    label: 'Community post',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { status: 'removed' } },
    dependents: [],
  },

  community_resource: {
    type: 'community_resource',
    table: 'community_resources',
    label: 'Community resource',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    dependents: [],
  },

  // ---- Training ----------------------------------------------------------
  training_module: {
    type: 'training_module',
    table: 'training_modules',
    label: 'Training module',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    // A course owns all of its content and learner state, so nothing blocks the
    // delete. Children are snapshotted (spans) before the hard purge cascades
    // them — lessons, sections, event assignments, and learner enrollments.
    // (training_progress has no module_id; it cascades from training_items.)
    dependents: [],
    spans: [
      { table: 'training_items', column: 'module_id' },
      { table: 'training_sections', column: 'module_id' },
      { table: 'training_assignments', column: 'module_id' },
      { table: 'training_enrollments', column: 'module_id' },
    ],
  },

  // ---- Membership tiers --------------------------------------------------
  membership_tier: {
    type: 'membership_tier',
    table: 'membership_tiers',
    label: 'Membership tier',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { is_active: false } },
    dependents: [],
  },

  // ---- Web store (migration 051) -----------------------------------------
  // A product soft-deletes to 'archived' (hidden from storefront, retained).
  // Variants cascade on hard delete; order_items snapshot sku/name and SET NULL,
  // so historical orders survive a product purge.
  store_product: {
    type: 'store_product',
    table: 'store_products',
    label: 'Store product',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { status: 'archived' } },
    dependents: [],
    spans: [
      { table: 'store_variants', column: 'product_id' },
      { table: 'store_tier_discounts', column: 'product_id' },
      { table: 'store_event_discounts', column: 'product_id' },
    ],
  },

  // An order soft-deletes to 'cancelled'; items cascade in the DB.
  store_order: {
    type: 'store_order',
    table: 'store_orders',
    label: 'Store order',
    pk: 'id',
    keyType: 'uuid',
    softDelete: { set: { status: 'cancelled' } },
    external: ['stripe'],
    dependents: [],
  },

  // Shipping address — PII, no soft-delete representation (hard delete only).
  member_address: {
    type: 'member_address',
    table: 'member_addresses',
    label: 'Member address',
    pk: 'id',
    keyType: 'uuid',
    softDelete: null,
    dependents: [],
  },
}

export function getEntityDef(type: string): EntityDef | undefined {
  return ENTITIES[type]
}

export function isMemberRequestable(type: string): boolean {
  return ENTITIES[type]?.memberRequestable === true
}
