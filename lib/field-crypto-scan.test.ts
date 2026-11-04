// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGREEMENT_SENSITIVE_KEYS,
  agreementHoldsPlaintext,
  blindIndexKeyId,
  countSensitiveKeys,
  exporterFiles,
  gateFailures,
  holdsPlaintext,
  tableCoverage,
  type ScanReport,
} from '@/lib/field-crypto-scan'
import { sensitiveTable } from '@/lib/field-crypto-fields'

describe('tableCoverage', () => {
  const t = sensitiveTable('member_pending_consent')
  it('counts plaintext, ciphertext, gaps, orphans and missing indexes', () => {
    const rows = [
      { member_id: 'a', guardian_name: 'X', guardian_name_enc: 'sf1.k.AA', guardian_email: 'x@example.test', guardian_email_enc: 'sf1.k.AA', guardian_email_bidx: 'bi1.k.AA' },
      { member_id: 'b', guardian_name: 'Y', guardian_name_enc: null, guardian_email: 'y@example.test', guardian_email_enc: 'sf1.k.AA', guardian_email_bidx: null },
      { member_id: 'c', guardian_name: null, guardian_name_enc: 'sf1.k.AA', guardian_email: '', guardian_email_enc: null, guardian_email_bidx: null },
    ]
    const [name, email] = tableCoverage(t, rows)
    expect(name).toMatchObject({ column: 'guardian_name', plaintext: 2, encrypted: 2, missingEnc: 1, orphanEnc: 1, missingBidx: 0 })
    expect(email).toMatchObject({ column: 'guardian_email', plaintext: 2, encrypted: 2, missingEnc: 0, orphanEnc: 0, missingBidx: 1 })
    expect(name.staleKey).toBe(0) // not counted without activeKeyOf
  })

  // Review finding (S4 shadow phase): after a DEK rotation the coverage gate
  // passed while values were still under the retired (possibly exposed) DEK.
  it('counts ciphertexts and blind indexes still under a retired DEK', () => {
    const rows = [
      { member_id: 'a', guardian_name: 'X', guardian_name_enc: 'sf1.k2.AA', guardian_email: 'x@example.test', guardian_email_enc: 'sf1.k2.AA', guardian_email_bidx: 'bi1.k2.AA' },
      { member_id: 'b', guardian_name: 'Y', guardian_name_enc: 'sf1.k1.AA', guardian_email: 'y@example.test', guardian_email_enc: 'sf1.k2.AA', guardian_email_bidx: 'bi1.k1.AA' },
      { member_id: 'c', guardian_name: 'Z', guardian_name_enc: 'garbage', guardian_email: null, guardian_email_enc: null, guardian_email_bidx: null },
    ]
    const [name, email] = tableCoverage(t, rows, undefined, () => 'k2')
    expect(name.staleKey).toBe(2) // k1, and an unparseable value
    expect(email.staleKey).toBe(1) // the blind index under k1
    // A tenant with no active key: every ciphertext is stale.
    expect(tableCoverage(t, rows, undefined, () => undefined)[0].staleKey).toBe(3)
    expect(blindIndexKeyId('bi1.k9.MAC')).toBe('k9')
    expect(blindIndexKeyId('sf1.k9.x')).toBeNull()
  })
})

// Review finding (S4 shadow phase): the scanner missed the e-sign copies.
describe('agreement copies', () => {
  it('flags guardian and emergency-contact values in a prefill or signer_values', () => {
    expect(agreementHoldsPlaintext({ MinorName: 'Sam', EmergencyContactName: 'Pat', EmergencyContactPhone: '555' })).toBe(true)
    expect(agreementHoldsPlaintext({ GuardianPhone: '555-0100' })).toBe(true)
    expect(agreementHoldsPlaintext({ GuardianEmail: '', GuardianPhone: null, SchoolName: 'A school' })).toBe(false)
    expect(agreementHoldsPlaintext(null)).toBe(false)
  })

  it('names every guardian / emergency-contact field the V2.3 templates carry', () => {
    const dir = join(process.cwd(), 'lib/esign/native/templates')
    const names = new Set<string>()
    for (const f of ['minor-v2-3.fields.json', 'mentor-v2-3.fields.json']) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/"name":\s*"([^"]+)"/g)) names.add(m[1])
    }
    const contactFields = [...names].filter((n) => /^(Guardian|EmergencyContact)/.test(n))
    expect(contactFields.length).toBeGreaterThan(0)
    for (const n of contactFields) expect(AGREEMENT_SENSITIVE_KEYS as readonly string[]).toContain(n)
  })
})

describe('countSensitiveKeys', () => {
  it('walks nested deletion_archive snapshots and audit images', () => {
    const snapshot = {
      registrations: [{ id: 'r1', school_name: 'A school' }],
      participants: [
        { id: 'p1', health_conditions: 'asthma', dietary_requirements: ['none'], emergency_contact_email: '' },
        { id: 'p2', health_conditions: null, health_conditions_enc: 'sf1.k.AA' },
      ],
    }
    const c = countSensitiveKeys(snapshot)
    expect(c.plaintext.get('health_conditions')).toBe(1)
    expect(c.plaintext.get('dietary_requirements')).toBe(1)
    expect(c.plaintext.has('emergency_contact_email')).toBe(false)
    expect(c.ciphertext.get('health_conditions_enc')).toBe(1)
    expect(holdsPlaintext(snapshot)).toBe(true)
    expect(holdsPlaintext({ members: [{ ec_email: null, dietary_requirements: [] }] })).toBe(false)
    expect(holdsPlaintext([{ ec_phone: '555' }, null])).toBe(true)
  })
})

describe('exporterFiles', () => {
  it('flags files that read a sensitive column and produce a CSV or Sheet, and skips tests', () => {
    const files: Array<[string, string]> = [
      ['app/api/x/export/route.ts', "const csv = toCsv(rows.map(r => r.health_conditions))"],
      ['lib/other.ts', "db.from('participants').select('health_conditions')"],
      ['lib/sheet.ts', 'appendRows(sheets, [p.ec_email])'],
      ['lib/x.test.ts', 'toCsv(health_conditions)'],
    ]
    expect(exporterFiles(files)).toEqual([
      { path: 'app/api/x/export/route.ts', columns: ['health_conditions'] },
      { path: 'lib/sheet.ts', columns: ['ec_email'] },
    ])
  })
})

describe('gateFailures', () => {
  const clean: ScanReport = {
    tables: [{ table: 'members', column: 'ec_email', plaintext: 3, encrypted: 3, missingEnc: 0, orphanEnc: 0, missingBidx: 0, mismatched: 0, staleKey: 0 }],
    auditLog: { rows: 4, plaintextRows: 0, ciphertextRows: 2 },
    deletionArchive: { rows: 0, plaintextRows: 0, ciphertextRows: 0 },
    agreements: { rows: 0, plaintextRows: 0 },
    agreementRecipients: { rows: 0, plaintextRows: 0 },
    exporters: [],
  }
  it('coverage passes when every value has a current ciphertext, plaintext does not while plaintext remains', () => {
    expect(gateFailures(clean, 'coverage')).toEqual([])
    expect(gateFailures(clean, 'plaintext')).toEqual(['members.ec_email: 3 plaintext value(s)'])
  })
  it('coverage fails on each kind of gap', () => {
    const bad: ScanReport = {
      ...clean,
      tables: [{ ...clean.tables[0], missingEnc: 1, orphanEnc: 2, missingBidx: 3, mismatched: 4, staleKey: 5 }],
    }
    expect(gateFailures(bad, 'coverage')).toHaveLength(5)
    expect(gateFailures(bad, 'coverage').join(' ')).toContain('retired')
  })
  it('plaintext fails on copies and exporters too', () => {
    const r: ScanReport = {
      tables: [],
      auditLog: { rows: 1, plaintextRows: 1, ciphertextRows: 0 },
      deletionArchive: { rows: 1, plaintextRows: 1, ciphertextRows: 0 },
      agreements: { rows: 2, plaintextRows: 1 },
      agreementRecipients: { rows: 2, plaintextRows: 1 },
      exporters: [{ path: 'lib/a.ts', columns: ['ec_email'] }],
    }
    expect(gateFailures(r, 'plaintext')).toHaveLength(5)
    expect(
      gateFailures(
        {
          ...r,
          auditLog: { rows: 0, plaintextRows: 0, ciphertextRows: 0 },
          deletionArchive: { rows: 0, plaintextRows: 0, ciphertextRows: 0 },
          agreements: { rows: 2, plaintextRows: 0 },
          agreementRecipients: { rows: 2, plaintextRows: 0 },
          exporters: [],
        },
        'plaintext',
      ),
    ).toEqual([])
  })
})
