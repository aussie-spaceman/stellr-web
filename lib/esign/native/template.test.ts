// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { initialValues, parseFieldMap, signerFields, validateSignerValues, type FieldMap } from './template'

const map: FieldMap = parseFieldMap({
  roles: [{ role: 'guardian', order: 1 }, { role: 'student', order: 2, optional: true }],
  fields: [
    { name: 'guardian_signature', label: 'Signature', role: 'guardian', type: 'signature', source: 'signer', page: 4, x: 100, y: 500, required: true },
    { name: 'guardian_date_signed', label: 'Date signed', role: 'guardian', type: 'date_signed', source: 'system', page: 4, x: 370, y: 510 },
    { name: 'GuardianPhone', label: 'Parent or guardian phone', role: 'guardian', type: 'text', source: 'prefill', prefillKey: 'GuardianPhone', page: 4, x: 120, y: 470, required: true },
    { name: 'MinorRelationship', label: 'Relationship to the student', role: 'guardian', type: 'text', source: 'prefill', prefillKey: 'MinorRelationship', page: 4, x: 160, y: 400, locked: true },
    { name: 'MediaOptOut', label: 'I do NOT consent to photo and media use', role: 'guardian', type: 'checkbox', source: 'signer', page: 2, x: 50, y: 454 },
    { name: 'student_signature', label: 'Signature', role: 'student', type: 'signature', source: 'signer', page: 4, x: 150, y: 585, required: true },
  ],
})

describe('parseFieldMap', () => {
  it('rejects a field with no human label', () => {
    expect(() => parseFieldMap({
      roles: [{ role: 'adult', order: 1 }],
      fields: [{ name: 'adult_signature', label: '', role: 'adult', type: 'signature', source: 'signer', page: 1, x: 0, y: 0 }],
    })).toThrow()
  })

  it('rejects a role with no signature, and a field for a role not on the agreement', () => {
    expect(() => parseFieldMap({
      roles: [{ role: 'adult', order: 1 }],
      fields: [{ name: 'Phone', label: 'Phone', role: 'adult', type: 'text', source: 'signer', page: 1, x: 0, y: 0 }],
    })).toThrow(/no signature/)
    expect(() => parseFieldMap({
      roles: [{ role: 'adult', order: 1 }],
      fields: [
        { name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'signer', page: 1, x: 0, y: 0 },
        { name: 'x', label: 'Stray', role: 'mentor', type: 'text', source: 'signer', page: 1, x: 0, y: 0 },
      ],
    })).toThrow(/not on the agreement/)
  })

  it('rejects a signature anyone but the signer would apply', () => {
    expect(() => parseFieldMap({
      roles: [{ role: 'adult', order: 1 }],
      fields: [{ name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'system', page: 1, x: 0, y: 0 }],
    })).toThrow(/signer's own act/)
  })
})

describe('signer fields', () => {
  it('lists what the signer fills: their editable prefills, entries and signature', () => {
    expect(signerFields(map, 'guardian').map((f) => f.name)).toEqual(['guardian_signature', 'GuardianPhone', 'MediaOptOut'])
  })

  it('starts prefills from our data and checkboxes unticked', () => {
    expect(initialValues(map, 'guardian', { GuardianPhone: '555 0100' })).toEqual({ GuardianPhone: '555 0100', MediaOptOut: 'false' })
  })
})

describe('validateSignerValues', () => {
  const prefill = { GuardianPhone: '555 0100', MinorRelationship: 'Mother' }

  it('accepts a correction to an editable prefill and normalises the text', () => {
    const r = validateSignerValues(map, 'guardian', prefill, { GuardianPhone: '  555\u00000199 ', MediaOptOut: true })
    expect(r).toEqual({ ok: true, values: { GuardianPhone: '555 0199', MediaOptOut: 'true' } })
  })

  it('requires required fields', () => {
    const r = validateSignerValues(map, 'guardian', prefill, { GuardianPhone: ' ' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.errors.GuardianPhone).toMatch(/Enter/)
  })

  it('refuses a value for another signer’s field or a locked one', () => {
    const r = validateSignerValues(map, 'guardian', prefill, { GuardianPhone: '1', student_signature: 'x', MinorRelationship: 'Aunt' })
    expect(r.ok).toBe(false)
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['MinorRelationship', 'student_signature'])
  })
})
