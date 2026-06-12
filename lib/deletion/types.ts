// Shared types for the deletion subsystem.
//
// Stellr's data model spans tables defined directly in Supabase (members,
// schools, member_schools) as well as repo migrations, and "events" are Sanity
// documents keyed by event_slug across several Postgres tables. Foreign-key
// behaviour is therefore not fully discoverable from repo SQL, so the deletion
// dependency graph is declared explicitly here and used to (a) tell an admin
// what must be deleted first and (b) execute soft/hard deletes consistently.

export type DeleteMode = 'soft' | 'hard'

// A column-update map applied to perform a soft delete. Values may be a literal
// or a thunk evaluated at execution time (e.g. () => new Date().toISOString()).
export interface SoftDeleteSpec {
  set: Record<string, unknown | (() => unknown)>
}

// A child relationship that BLOCKS deletion until cleared. `count` queries run
// against `table` filtering `fkColumn = <entity key>`; a non-zero count becomes
// a blocker surfaced to the admin ("remove N members first").
export interface Dependent {
  table: string
  fkColumn: string
  label: string
  // Optional filter so already-soft-deleted children don't count as blockers.
  activeFilter?: { column: string; value: unknown }
  // Optional: when the "active" flag lives on a JOINED parent rather than on the
  // dependent row itself (e.g. member_schools links → members.is_active), count a
  // link only if its parent still exists AND isn't soft-deleted. Applied as an
  // inner-join filter, so soft-deleted or orphaned parents don't block the delete
  // (they're already hidden from the admin UI). `removedValue` is the flag value
  // that means "soft-deleted"; null/anything else counts as active, mirroring the
  // UI's `is_active !== false`.
  activeJoin?: { embed: string; column: string; removedValue: unknown }
  // Optional deep-link template for the admin UI, with {id} substituted.
  adminHref?: string
}

export type ExternalCleanupKind = 'stripe' | 'docusign'

// Definition of one deletable entity type.
export interface EntityDef {
  // Stable key used in API payloads and deletion_requests / deletion_archive.
  type: string
  table: string
  label: string
  pk: string
  keyType: 'uuid' | 'slug'
  // null => this entity has no soft-delete representation (join rows, tokens,
  // ephemeral records); only 'hard' mode is valid.
  softDelete: SoftDeleteSpec | null
  dependents: Dependent[]
  external?: ExternalCleanupKind[]
  // Composite entities (events) are not a single row — they span multiple
  // tables keyed by the same value. These are all purged on hard delete.
  spans?: { table: string; column: string }[]
  // Whether a member may request deletion of this entity via the Activity
  // Review Log (the three special cases). Defaults to false.
  memberRequestable?: boolean
}

export interface Blocker {
  table: string
  label: string
  count: number
  adminHref?: string
}

export interface PreflightResult {
  entity: string
  id: string
  blockers: Blocker[]
  canDelete: boolean
}

export interface ExternalResult {
  kind: ExternalCleanupKind
  ok: boolean
  detail: string
}

export interface DeletionResult {
  entity: string
  id: string
  mode: DeleteMode
  deleted: boolean
  externalResults: ExternalResult[]
}
