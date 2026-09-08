import { describe, it, expect } from 'vitest'
import { describeEnvelope, describeMissingEnvelope, roleLabel } from './docusign-status'

// These cases are the real 4 Sept 2026 incident and its mirror image. A parent
// wrote in saying "we signed the consent form last week, what do we have to
// do?" — and the system had told them, in writing, that the guardian was the
// holdout. Getting the direction of that sentence right is the whole point of
// this module, so it is pinned here rather than left to the UI.

const guardianOutstanding = {
  name: 'Tamara Buk', email: 'tamarabuk7@gmail.com',
  role_name: 'Guardian', status: 'sent', delivered_at: null,
}
const studentSigned = {
  name: 'Leon Buk', email: 'gerybuki1@gmail.com',
  role_name: 'Minor', status: 'completed', delivered_at: '2026-08-26T18:36:19Z',
}

describe('describeEnvelope', () => {
  it('names the guardian when the student has signed and the guardian has not', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [guardianOutstanding, studentSigned],
    )
    expect(d.pill).toBe('partial')
    expect(d.label).toBe('Partially Complete · 1 of 2')
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian) — never opened')
    expect(d.waitingOn.map(r => r.email)).toEqual(['tamarabuk7@gmail.com'])
    expect(d.neverOpened).toHaveLength(1)
  })

  it('names the STUDENT in the mirror case — the reminder used to say the opposite', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [
        { ...guardianOutstanding, status: 'completed', delivered_at: '2026-08-26T10:00:00Z' },
        { ...studentSigned, status: 'sent', delivered_at: '2026-08-26T11:00:00Z' },
      ],
    )
    expect(d.pill).toBe('partial')
    expect(d.detail).toBe('Awaiting Leon Buk (student)')
    expect(d.waitingOn.map(r => r.role_name)).toEqual(['Minor'])
  })

  it('drops the "never opened" qualifier once the signer has opened the link', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [{ ...guardianOutstanding, delivered_at: '2026-09-01T09:00:00Z' }, studentSigned],
    )
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian)')
  })

  it('lists both signers while nobody has signed', () => {
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 0 },
      [guardianOutstanding, { ...studentSigned, status: 'sent', delivered_at: null }],
    )
    expect(d.pill).toBe('issued')
    expect(d.detail).toBe('Awaiting Tamara Buk (parent/guardian) and Leon Buk (student) — never opened')
  })

  it('reports a bounced address ahead of partial progress', () => {
    // DocuSign calls this 'autoresponded'. We used to discard it entirely, so a
    // dead address looked exactly like a slow one and got chased forever.
    const d = describeEnvelope(
      { status: 'sent', signers_total: 2, signers_completed: 1 },
      [{ ...guardianOutstanding, status: 'autoresponded' }, studentSigned],
    )
    expect(d.pill).toBe('bounced')
    expect(d.detail).toContain('Email bounced for Tamara Buk (parent/guardian)')
    expect(d.waitingOn).toHaveLength(0)
    expect(d.bounced).toHaveLength(1)
  })

  it('names who declined', () => {
    const d = describeEnvelope(
      { status: 'declined', signers_total: 2, signers_completed: 0 },
      [{ ...guardianOutstanding, status: 'declined' }, studentSigned],
    )
    expect(d.pill).toBe('declined')
    expect(d.detail).toBe('Declined by Tamara Buk (parent/guardian)')
  })

  it('treats a coverage row as on-file', () => {
    const d = describeEnvelope({ status: 'completed', reused_from: 'abc' }, [])
    expect(d.pill).toBe('on_file')
    expect(d.detail).toBeNull()
  })

  it('says so plainly when the counts show partial but no recipients are known', () => {
    // Envelopes issued before migration 148 have counts but no recipient rows.
    // Inventing a name here would be worse than admitting we do not have one.
    const d = describeEnvelope({ status: 'sent', signers_total: 2, signers_completed: 1 }, [])
    expect(d.pill).toBe('partial')
    expect(d.detail).toContain('outstanding signer unknown')
  })

  it('flags a voided envelope as needing re-issue', () => {
    const d = describeEnvelope({ status: 'voided', signers_total: 2, signers_completed: 1 }, [])
    expect(d.pill).toBe('voided')
    expect(d.detail).toBe('Voided — re-issue required')
  })

  it('is complete when the envelope is complete', () => {
    const d = describeEnvelope(
      { status: 'completed', signers_total: 2, signers_completed: 2 },
      [{ ...guardianOutstanding, status: 'completed' }, studentSigned],
    )
    expect(d.pill).toBe('complete')
    expect(d.detail).toBeNull()
    expect(d.waitingOn).toHaveLength(0)
  })
})

describe('describeMissingEnvelope', () => {
  it('distinguishes "required but never issued" from "not required"', () => {
    expect(describeMissingEnvelope(true).pill).toBe('not_issued')
    expect(describeMissingEnvelope(false).pill).toBe('not_required')
    expect(describeMissingEnvelope(false).detail).toBeNull()
  })
})

describe('roleLabel', () => {
  it('translates DocuSign template roles into words a family would use', () => {
    expect(roleLabel('Guardian')).toBe('parent/guardian')
    expect(roleLabel('Minor')).toBe('student')
    expect(roleLabel('StellrRepresentative')).toBe('Stellr counter-signature')
    expect(roleLabel(null)).toBe('signer')
  })
})
