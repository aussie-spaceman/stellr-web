import { describe, it, expect } from 'vitest'
import {
  scholarshipDetailsEmail,
  scholarshipOfferEmail,
  scholarshipPaymentEmail,
  scholarshipStaffAlertEmail,
  type OfferEmailInput,
} from '@/lib/scholarship-emails'

const base: OfferEmailInput = {
  firstName: 'Ethan',
  eventTitle: 'Nevada Space Design Challenge',
  eventDate: 'Nov 14, 2026',
  percent: 50,
  feeCents: 16500,
  dueCents: 8250,
  detailsComplete: false,
  registerUrl: 'https://www.stellreducation.org/register/nevada/individual?scholarship=abc',
  offerUrl: 'https://www.stellreducation.org/scholarship/offer/abc',
}

describe('scholarship offer emails', () => {
  it('email 1 states the saving and both remaining steps', () => {
    const { subject, text } = scholarshipOfferEmail(base)
    expect(subject).toContain('Nevada Space Design Challenge')
    expect(text).toContain('from $165.00 to $82.50')
    expect(text).toContain('Two steps')
    expect(text).toContain('Pay $82.50')
  })

  it('a full scholarship has one step and never mentions paying', () => {
    const free = { ...base, percent: 100, dueCents: 0 }
    expect(scholarshipOfferEmail(free).text).toContain('One step')
    expect(scholarshipOfferEmail(free).text).not.toMatch(/Pay \\$/)
    expect(scholarshipDetailsEmail(free).text).toContain('nothing to pay')
  })

  it('email 2 links the registration form when details are outstanding, the offer page once they are in', () => {
    expect(scholarshipDetailsEmail(base).text).toContain(base.registerUrl)
    const done = scholarshipDetailsEmail({ ...base, detailsComplete: true })
    expect(done.text).not.toContain(base.registerUrl)
    expect(done.text).toContain('already in')
  })

  it('email 3 links the offer page and states the amount', () => {
    const { subject, text } = scholarshipPaymentEmail(base)
    expect(subject).toContain('payment link')
    expect(text).toContain(base.offerUrl)
    expect(text).toContain('$82.50 instead of $165.00')
  })

  it('escapes applicant input in HTML', () => {
    const { html } = scholarshipOfferEmail({ ...base, firstName: '<script>x</script>' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('already registered and paid (retrospective)', () => {
  const paid = { ...base, alreadyPaid: true, detailsComplete: true }

  it('email 1 states a card refund and asks for nothing else when consent is signed', () => {
    const { text } = scholarshipOfferEmail({ ...paid, refund: { method: 'cash', cents: 8250 } })
    expect(text).toContain('refunded $82.50 to the card you paid with')
    expect(text).toContain('nothing else to do')
    expect(text).not.toMatch(/Pay \$/)
  })

  it('email 1 states account credit, and points to the consent form when unsigned', () => {
    const { text } = scholarshipOfferEmail({ ...paid, refund: { method: 'credit', cents: 8250 }, consentOutstanding: true })
    expect(text).toContain('$82.50 credit to your Stellr account')
    expect(text).toContain('consent form')
  })

  it('says there is nothing to claim when they had already paid the scholarship price', () => {
    expect(scholarshipOfferEmail({ ...paid, refund: { method: 'none', cents: 0 } }).text).toContain('nothing more to pay or claim')
  })

  it('the follow-up is a consent-form reminder, not a registration step', () => {
    const { subject, text } = scholarshipDetailsEmail(paid)
    expect(subject).toContain('consent form')
    expect(text).not.toContain(base.registerUrl)
  })
})

describe('scholarshipStaffAlertEmail', () => {
  it('escapes the brief and carries the review link', () => {
    const { html, text } = scholarshipStaffAlertEmail({
      name: 'A B', email: 'a@b.com', phone: null, activity: 'Nevada', school: null,
      brief: '<img src=x onerror=alert(1)>', reviewUrl: 'https://app.stellreducation.org/admin/scholarships/1',
    })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    expect(html).toContain('/admin/scholarships/1')
    expect(text).toContain('Review application: https://app.stellreducation.org/admin/scholarships/1')
  })
})
