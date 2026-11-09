import { describe, it, expect } from 'vitest'
import { isSplitGroup, payerOf, registrationInvoiceSeats, seatsOffInvoice, seatsOnInvoice } from './group-payer'

// Who pays for each person in a group (9 Nov 2026): the organizer's invoice, or
// their own link. NULL payers keep the meaning they had before, so these pin that
// old groups bill exactly as they did.

const INVOICE = { member_pays_individually: false, late_joiner_payer: null }
const INDIVIDUAL = { member_pays_individually: true, late_joiner_payer: null }
const SPLIT_SELF = { member_pays_individually: false, late_joiner_payer: 'self' }
const SPLIT_GROUP = { member_pays_individually: false, late_joiner_payer: 'group' }

describe('payerOf', () => {
  it.each<[string, Parameters<typeof payerOf>[0], Parameters<typeof payerOf>[1], string]>([
    ['an invoiced group, no payer recorded', {}, INVOICE, 'group'],
    ['an individually paid group', {}, INDIVIDUAL, 'self'],
    ['a place paid by link before the group moved to an invoice', { individual_payment_status: 'paid' }, INVOICE, 'self'],
    ['a link still out in an invoiced group', { individual_payment_status: 'pending' }, INVOICE, 'self'],
    ['a recorded payer wins over the group', { payer: 'group', individual_payment_status: null }, INDIVIDUAL, 'group'],
    ['a later joiner in a split group, joiners pay by link', {}, SPLIT_SELF, 'self'],
    ['a later joiner in a split group, joiners on the invoice', {}, SPLIT_GROUP, 'group'],
  ])('%s', (_name, person, reg, expected) => {
    expect(payerOf(person, reg)).toBe(expected)
  })

  it('a split group is one with later-joiner rules and no individual flag', () => {
    expect(isSplitGroup(SPLIT_SELF)).toBe(true)
    expect(isSplitGroup(INVOICE)).toBe(false)
    expect(isSplitGroup({ member_pays_individually: true, late_joiner_payer: 'self' })).toBe(false)
  })
})

describe('seatsOnInvoice', () => {
  const paid = { individual_payment_status: 'paid' }
  const unpaid = { individual_payment_status: null }

  it('an old invoiced group bills declared places less those paid individually, as before', () => {
    expect(seatsOnInvoice(15, [paid, paid, paid, ...Array(12).fill(unpaid)], INVOICE)).toBe(12)
    expect(seatsOnInvoice(15, [unpaid, unpaid], INVOICE)).toBe(15) // unfilled places stay on the invoice
  })

  it('the teacher alone on the invoice, students and later joiners by link', () => {
    const people = [{ payer: 'group' }, { payer: 'self', individual_payment_status: 'pending' }, { payer: 'self', individual_payment_status: 'paid' }]
    expect(seatsOnInvoice(6, people, SPLIT_SELF)).toBe(1)
    expect(seatsOffInvoice(6, people, SPLIT_SELF)).toBe(5)
  })

  it('the teacher and one student invoiced, later joiners on the invoice too', () => {
    const people = [{ payer: 'group' }, { payer: 'group' }, { payer: 'self', individual_payment_status: 'pending' }, { payer: 'self', individual_payment_status: 'pending' }]
    expect(seatsOnInvoice(6, people, SPLIT_GROUP)).toBe(4) // 2 named + 2 unfilled
  })

  it('a joiner with no payer recorded follows the group’s later-joiner rule', () => {
    expect(seatsOnInvoice(2, [{ payer: 'group' }, {}], SPLIT_SELF)).toBe(1)
    expect(seatsOnInvoice(2, [{ payer: 'group' }, {}], SPLIT_GROUP)).toBe(2)
  })

  it('never below zero', () => {
    expect(seatsOnInvoice(1, [paid, paid], INVOICE)).toBe(0)
  })
})

describe('registrationInvoiceSeats', () => {
  it.each<[string, Parameters<typeof registrationInvoiceSeats>[0], number]>([
    ['the registrant alone', { declaredSeats: 4, registrantOnInvoice: true, entered: [{}, {}, {}], lateJoinerPayer: 'self' }, 1],
    ['teacher + one student ticked', { declaredSeats: 4, registrantOnInvoice: true, entered: [{ on_invoice: true }, {}, {}], lateJoinerPayer: 'self' }, 2],
    ['unfilled places go on the invoice', { declaredSeats: 10, registrantOnInvoice: true, entered: [{}], lateJoinerPayer: 'group' }, 9],
    ['unfilled places pay by link', { declaredSeats: 10, registrantOnInvoice: true, entered: [{}], lateJoinerPayer: 'self' }, 1],
    ['nobody ticked', { declaredSeats: 3, registrantOnInvoice: false, entered: [{}, {}], lateJoinerPayer: 'self' }, 0],
  ])('%s', (_name, input, expected) => {
    expect(registrationInvoiceSeats(input)).toBe(expected)
  })
})
