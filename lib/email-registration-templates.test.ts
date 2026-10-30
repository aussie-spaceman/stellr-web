import { describe, it, expect } from 'vitest'
import {
  registrationPaymentLinkEmail,
  groupConfirmationEmail,
  individualConfirmationEmail,
  outstandingItemsReminderEmail,
} from '@/lib/email'

const PAY = 'https://www.stellreducation.org/register/colorado/pay/abc'

describe('registrationPaymentLinkEmail', () => {
  it('names the amount and carries the durable link in html and text', () => {
    const e = registrationPaymentLinkEmail({
      firstName: 'Daniel', eventTitle: 'Colorado SDC', amountCents: 7500, payUrl: PAY, registrationId: 'reg-1',
    })
    expect(e.subject).toBe('Complete your registration — Colorado SDC')
    expect(e.html).toContain('$75.00')
    expect(e.html).toContain(`href="${PAY}"`)
    expect(e.html).toContain('Already paid?')
    expect(e.text).toContain(PAY)
    expect(e.text).toContain('$75.00')
  })

  it('says "group of N" for a group registration', () => {
    const e = registrationPaymentLinkEmail({
      firstName: 'Sam', eventTitle: 'Colorado SDC', amountCents: 37500, seats: 5, payUrl: PAY, registrationId: 'reg-1',
    })
    expect(e.html).toContain('Your group registration')
    expect(e.html).toContain('your group of 5')
  })
})

describe('groupConfirmationEmail — card payment', () => {
  const base = {
    teacherFirstName: 'Sam', teacherLastName: 'Lee', schoolName: 'STEM HR', eventTitle: 'Colorado SDC',
    participantCount: 5, registrationId: 'reg-1', detailsMethod: 'add_now' as const,
  }

  it('no longer claims the card was charged, and carries the pay link when given', () => {
    const e = groupConfirmationEmail({ ...base, paymentMethod: 'card', payUrl: PAY })
    expect(e.html).not.toContain('has been processed')
    expect(e.html).toContain('confirmed once the card payment')
    expect(e.html).toContain(`href="${PAY}"`)
    expect(e.text).toContain(PAY)
  })

  it('still reads correctly without a pay link', () => {
    const e = groupConfirmationEmail({ ...base, paymentMethod: 'card' })
    expect(e.html).not.toContain('Pay now')
    expect(e.text).not.toContain('processed')
  })

  it('leaves the invoice copy alone', () => {
    const e = groupConfirmationEmail({ ...base, paymentMethod: 'invoice' })
    expect(e.html).toContain('An invoice for all 5 participants')
  })
})

describe('outstandingItemsReminderEmail — payment', () => {
  it('links to the pay page when one is supplied', () => {
    const e = outstandingItemsReminderEmail({ firstName: 'Dan', eventTitle: 'Colorado SDC', payment: { method: 'link', payUrl: PAY } })
    expect(e.html).toContain(`href="${PAY}"`)
    expect(e.html).not.toContain('previously emailed')
    expect(e.text).toContain(PAY)
  })

  it('falls back to the old wording without one', () => {
    const e = outstandingItemsReminderEmail({ firstName: 'Dan', eventTitle: 'Colorado SDC', payment: { method: 'link' } })
    expect(e.html).toContain('previously emailed')
  })

  it('invoice copy is unaffected by payUrl', () => {
    const e = outstandingItemsReminderEmail({ firstName: 'Dan', eventTitle: 'Colorado SDC', payment: { method: 'invoice', payUrl: PAY } })
    expect(e.html).toContain('invoice issued')
    expect(e.html).not.toContain(PAY)
  })
})

describe('check-in codes in confirmation emails', () => {
  const CODE = 'https://www.stellreducation.org/check-in/nevada/code?c=p.abc'

  it('gives an individual a button to their check-in code, in html and text', () => {
    const e = individualConfirmationEmail({
      firstName: 'Maya', lastName: 'Rivera', membershipId: '0001234', eventTitle: 'Nevada SDC', registrationId: 'reg-1', checkInCodeUrl: CODE,
    })
    expect(e.html).toContain(`href="${CODE}"`)
    expect(e.html).toContain('Show my check-in code')
    expect(e.html).not.toContain('Keep your Membership ID handy')
    expect(e.text).toContain(CODE)
  })

  it('keeps the old line when there is no code (no signing secret)', () => {
    const e = individualConfirmationEmail({ firstName: 'Maya', lastName: 'Rivera', membershipId: '0001234', eventTitle: 'Nevada SDC', registrationId: 'reg-1' })
    expect(e.html).toContain('Keep your Membership ID handy')
    expect(e.html).not.toContain('check-in code')
  })

  it('gives a teacher their group’s code', () => {
    const base = {
      teacherFirstName: 'Sam', teacherLastName: 'Lee', schoolName: 'STEM HR', eventTitle: 'Nevada SDC',
      participantCount: 5, registrationId: 'reg-1', detailsMethod: 'add_now' as const, paymentMethod: 'invoice' as const,
    }
    const withCode = groupConfirmationEmail({ ...base, checkInCodeUrl: CODE })
    expect(withCode.html).toContain(`href="${CODE}"`)
    expect(withCode.html).toContain('Show our check-in code')
    expect(withCode.text).toContain(CODE)
    expect(groupConfirmationEmail(base).html).not.toContain('check-in code')
  })
})
