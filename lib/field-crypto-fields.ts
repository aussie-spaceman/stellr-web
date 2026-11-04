// The sensitive-column catalogue for application field encryption
// (multi-tenancy plan S4, lib/field-crypto.ts). One entry per plaintext
// column that holds health, dietary/allergy, emergency-contact or
// guardian-contact data. docs/FIELD-CRYPTO.md lists the evidence for each.
//
// Each plaintext column `c` gets a nullable `c_enc` (versioned ciphertext)
// and, where an equality lookup is useful, `c_bidx` (keyed blind index) —
// added by supabase/migrations/20261104400000_field_crypto_shadow.sql. The
// plaintext columns are untouched: in shadow mode both are written and every
// read still uses the plaintext.
//
// Dependency-free on purpose: the scripts and the tests import it directly.

export type FieldKind = 'text' | 'text_array'
export type BlindIndexNormaliser = 'email' | 'phone' | 'text'

export interface SensitiveField {
  column: string
  kind: FieldKind
  /** Present when the column also gets a `<column>_bidx` blind index. */
  blindIndex?: BlindIndexNormaliser
  category: 'health' | 'dietary' | 'emergency_contact' | 'guardian_contact'
}

export interface SensitiveTable {
  table: 'participants' | 'members' | 'member_pending_consent'
  /** The row id column that is bound into the AAD. */
  idColumn: string
  /**
   * How the row's tenant is found. `registration`: participants reach their
   * tenant through registrations.tenant_id (S3 trigger-derived). `platform`:
   * identity tables (registry class `identity`) are not tenant data; until S7
   * moves them to identities they are encrypted under the platform owner's
   * (Stellr's) data key.
   */
  tenantFrom: 'registration' | 'platform'
  fields: SensitiveField[]
}

export const SENSITIVE_TABLES: SensitiveTable[] = [
  {
    table: 'participants',
    idColumn: 'id',
    tenantFrom: 'registration',
    fields: [
      { column: 'health_conditions', kind: 'text', category: 'health' },
      { column: 'dietary_requirements', kind: 'text_array', category: 'dietary' },
      { column: 'emergency_contact_first_name', kind: 'text', category: 'emergency_contact' },
      { column: 'emergency_contact_last_name', kind: 'text', category: 'emergency_contact' },
      // For a minor this is also the parent/guardian address the consent form goes to.
      { column: 'emergency_contact_email', kind: 'text', blindIndex: 'email', category: 'emergency_contact' },
      { column: 'emergency_contact_phone', kind: 'text', blindIndex: 'phone', category: 'emergency_contact' },
      { column: 'emergency_contact_relationship', kind: 'text', category: 'emergency_contact' },
    ],
  },
  {
    table: 'members',
    idColumn: 'id',
    tenantFrom: 'platform',
    fields: [
      { column: 'health_conditions', kind: 'text', category: 'health' },
      { column: 'ec_first_name', kind: 'text', category: 'emergency_contact' },
      { column: 'ec_last_name', kind: 'text', category: 'emergency_contact' },
      { column: 'ec_email', kind: 'text', blindIndex: 'email', category: 'emergency_contact' },
      { column: 'ec_phone', kind: 'text', blindIndex: 'phone', category: 'emergency_contact' },
      { column: 'ec_relationship', kind: 'text', category: 'emergency_contact' },
    ],
  },
  {
    table: 'member_pending_consent',
    idColumn: 'member_id',
    tenantFrom: 'platform',
    fields: [
      { column: 'guardian_name', kind: 'text', category: 'guardian_contact' },
      { column: 'guardian_email', kind: 'text', blindIndex: 'email', category: 'guardian_contact' },
    ],
  },
]

export type SensitiveTableName = SensitiveTable['table']

export function sensitiveTable(name: SensitiveTableName): SensitiveTable {
  const t = SENSITIVE_TABLES.find((x) => x.table === name)
  if (!t) throw new Error(`Not a sensitive table: ${name}`)
  return t
}

export const encColumn = (column: string) => `${column}_enc`
export const bidxColumn = (column: string) => `${column}_bidx`

/** Every column name a migration must add, per table (for tests and the scanner). */
export function shadowColumns(t: SensitiveTable): string[] {
  return t.fields.flatMap((f) => (f.blindIndex ? [encColumn(f.column), bidxColumn(f.column)] : [encColumn(f.column)]))
}

/**
 * The JSON keys that carry these values inside whole-row copies
 * (audit_log.old_data/new_data, deletion_archive.snapshot). The scanner looks
 * for any of them holding a non-empty value.
 */
export function plaintextKeys(): string[] {
  return [...new Set(SENSITIVE_TABLES.flatMap((t) => t.fields.map((f) => f.column)))].sort()
}
