import {
  SENSITIVE_TABLES,
  bidxColumn,
  encColumn,
  plaintextKeys,
  type SensitiveTable,
} from '@/lib/field-crypto-fields'
import { encodeFieldValue } from '@/lib/field-crypto-patch'
import { fieldKeyId } from '@/lib/field-crypto'

// The pure half of scripts/scan-plaintext-sensitive.ts: given rows, count where
// sensitive plaintext still exists and whether its ciphertext is in place.
// Counts only — nothing here returns or logs a value. The S4 cut-over gate is
// "no plaintext sensitive values remain in any table, export or log"; until
// then the coverage gate ("every plaintext value has a current ciphertext")
// is the one that matters.

export interface ColumnCoverage {
  table: string
  column: string
  /** Rows with a non-empty plaintext value. */
  plaintext: number
  /** Rows with a ciphertext. */
  encrypted: number
  /** Plaintext present, ciphertext missing. */
  missingEnc: number
  /** Ciphertext present, plaintext empty (should have been cleared with it). */
  orphanEnc: number
  /** Plaintext present, blind index missing (indexed columns only). */
  missingBidx: number
  /** With --verify: the ciphertext does not open to the current plaintext. */
  mismatched: number
  /**
   * Ciphertexts or blind indexes made under a DEK that is not the row
   * tenant's active one: a DEK rotation is not finished (or a warm instance
   * wrote under the old key before it saw the rotation). Read from the key id
   * prefix, so no master key is needed.
   */
  staleKey: number
}

/** The DEK id a blind index (`bi1.<dek id>.<mac>`) was made under, or null if malformed. */
export function blindIndexKeyId(value: string): string | null {
  const parts = value.split('.')
  return parts.length === 3 && parts[0] === 'bi1' && parts[1] ? parts[1] : null
}

function cipherKeyId(value: string): string | null {
  try {
    return fieldKeyId(value)
  } catch {
    return null
  }
}

/**
 * Coverage for one table's rows. `mismatches` (optional, from --verify) counts
 * ciphertexts that do not open to the plaintext. `activeKeyOf` (optional)
 * returns the row tenant's active DEK id; without it staleKey is not counted.
 */
export function tableCoverage(
  t: SensitiveTable,
  rows: Record<string, unknown>[],
  mismatches?: Map<string, number>,
  activeKeyOf?: (row: Record<string, unknown>) => string | null | undefined,
): ColumnCoverage[] {
  return t.fields.map((f) => {
    const c: ColumnCoverage = {
      table: t.table,
      column: f.column,
      plaintext: 0,
      encrypted: 0,
      missingEnc: 0,
      orphanEnc: 0,
      missingBidx: 0,
      mismatched: mismatches?.get(f.column) ?? 0,
      staleKey: 0,
    }
    for (const row of rows) {
      const plain = encodeFieldValue(f, row[f.column]) !== null
      const enc = typeof row[encColumn(f.column)] === 'string' && (row[encColumn(f.column)] as string).length > 0
      if (plain) c.plaintext++
      if (enc) c.encrypted++
      if (plain && !enc) c.missingEnc++
      if (!plain && enc) c.orphanEnc++
      if (f.blindIndex && plain && !row[bidxColumn(f.column)]) c.missingBidx++
      if (activeKeyOf) {
        const active = activeKeyOf(row)
        const encVal = row[encColumn(f.column)]
        const bidxVal = f.blindIndex ? row[bidxColumn(f.column)] : null
        const staleEnc = typeof encVal === 'string' && encVal.length > 0 && (!active || cipherKeyId(encVal) !== active)
        const staleBidx = typeof bidxVal === 'string' && bidxVal.length > 0 && (!active || blindIndexKeyId(bidxVal) !== active)
        if (staleEnc || staleBidx) c.staleKey++
      }
    }
    return c
  })
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

/**
 * Walk a JSON value (an audit_log row image, a deletion_archive snapshot of
 * any nesting) and count the sensitive keys holding a non-empty value. `*_enc`
 * keys are counted separately: ciphertext in a copy is not plaintext, but it
 * still opens while the data key exists, so retention must clear it too.
 */
export function countSensitiveKeys(
  value: unknown,
  keys: readonly string[] = plaintextKeys(),
  into: { plaintext: Map<string, number>; ciphertext: Map<string, number> } = { plaintext: new Map(), ciphertext: new Map() },
  depth = 0,
) {
  if (depth > 20 || value === null || typeof value !== 'object') return into
  if (Array.isArray(value)) {
    for (const v of value) countSensitiveKeys(v, keys, into, depth + 1)
    return into
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys.includes(k) && nonEmpty(v)) into.plaintext.set(k, (into.plaintext.get(k) ?? 0) + 1)
    else if (k.endsWith('_enc') && keys.includes(k.slice(0, -4)) && nonEmpty(v)) {
      into.ciphertext.set(k, (into.ciphertext.get(k) ?? 0) + 1)
    } else if (v && typeof v === 'object') countSensitiveKeys(v, keys, into, depth + 1)
  }
  return into
}

/**
 * The e-sign copies of guardian and emergency contact details:
 * agreements.prefill (lib/esign/native/plan.ts builds it; the minor and mentor
 * V2.3 templates carry these fields) and agreement_recipients.signer_values
 * (a signer's corrections, lib/esign/native/template.ts). The keys are the
 * template field names. A signed agreement is a legal record, so these are
 * reported for the plaintext gate, not encrypted here (docs/FIELD-CRYPTO.md).
 */
export const AGREEMENT_SENSITIVE_KEYS = [
  'EmergencyContactName',
  'EmergencyContactPhone',
  'GuardianEmail',
  'GuardianName',
  'GuardianPhone',
] as const

/** Does this agreement prefill / signer_values object hold guardian or emergency-contact plaintext? */
export function agreementHoldsPlaintext(value: unknown): boolean {
  return countSensitiveKeys(value, AGREEMENT_SENSITIVE_KEYS).plaintext.size > 0
}

/** Does this whole-row copy hold any sensitive plaintext? */
export function holdsPlaintext(value: unknown): boolean {
  return countSensitiveKeys(value).plaintext.size > 0
}

// ── Exporters: code that writes sensitive columns out of the database ──────

const EXPORT_MARKERS = /\b(csv|toCsv|csvRow|text\/csv|spreadsheet|sheets|xlsx|appendRows|values\.update|Content-Disposition)\b/i

/**
 * Source files that read a sensitive column and also produce a CSV, a Google
 * Sheet or a download. Each one must become encrypted-aware (decrypt behind
 * an authorised, audited path) before the plaintext columns go. Input is
 * [path, source] pairs so the caller decides which files to read.
 */
export function exporterFiles(files: Array<[string, string]>): Array<{ path: string; columns: string[] }> {
  const cols = [...new Set(SENSITIVE_TABLES.flatMap((t) => t.fields.map((f) => f.column)))]
  const out: Array<{ path: string; columns: string[] }> = []
  for (const [path, src] of files) {
    // Over-inclusive on purpose (a comment mentioning a spreadsheet counts):
    // a reviewer clears false positives, a missed exporter is a leak.
    if (/\.test\.|\/test\/|field-crypto|database\.types\.ts$/.test(path)) continue
    if (!EXPORT_MARKERS.test(src)) continue
    const hit = cols.filter((c) => new RegExp(`\\b${c}\\b`).test(src))
    if (hit.length) out.push({ path, columns: hit })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

// ── Gates ───────────────────────────────────────────────────────────────────

export interface ScanReport {
  tables: ColumnCoverage[]
  auditLog: { rows: number; plaintextRows: number; ciphertextRows: number }
  deletionArchive: { rows: number; plaintextRows: number; ciphertextRows: number }
  /** agreements.prefill holding guardian / emergency-contact values. */
  agreements: { rows: number; plaintextRows: number }
  /** agreement_recipients.signer_values holding them. */
  agreementRecipients: { rows: number; plaintextRows: number }
  exporters: Array<{ path: string; columns: string[] }>
}

export type Gate = 'coverage' | 'plaintext'

/** Human-readable reasons the report fails a gate (empty = pass). */
export function gateFailures(r: ScanReport, gate: Gate): string[] {
  const out: string[] = []
  if (gate === 'coverage') {
    for (const c of r.tables) {
      if (c.missingEnc) out.push(`${c.table}.${c.column}: ${c.missingEnc} row(s) without ciphertext`)
      if (c.orphanEnc) out.push(`${c.table}.${c.column}: ${c.orphanEnc} ciphertext(s) whose plaintext was cleared`)
      if (c.missingBidx) out.push(`${c.table}.${c.column}: ${c.missingBidx} row(s) without a blind index`)
      if (c.mismatched) out.push(`${c.table}.${c.column}: ${c.mismatched} ciphertext(s) that do not match the plaintext`)
      if (c.staleKey) out.push(`${c.table}.${c.column}: ${c.staleKey} value(s) still under a retired or unknown data key`)
    }
    return out
  }
  for (const c of r.tables) if (c.plaintext) out.push(`${c.table}.${c.column}: ${c.plaintext} plaintext value(s)`)
  if (r.auditLog.plaintextRows) out.push(`audit_log: ${r.auditLog.plaintextRows} row(s) with sensitive plaintext`)
  if (r.deletionArchive.plaintextRows) out.push(`deletion_archive: ${r.deletionArchive.plaintextRows} snapshot(s) with sensitive plaintext`)
  if (r.agreements.plaintextRows) out.push(`agreements.prefill: ${r.agreements.plaintextRows} agreement(s) with guardian or emergency-contact values`)
  if (r.agreementRecipients.plaintextRows) {
    out.push(`agreement_recipients.signer_values: ${r.agreementRecipients.plaintextRows} signer(s) with guardian or emergency-contact values`)
  }
  for (const e of r.exporters) out.push(`exporter ${e.path} reads ${e.columns.join(', ')}`)
  return out
}
