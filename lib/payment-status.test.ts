import { describe, it, expect } from 'vitest'
import { registrationPaid } from './payment-status'

describe('registrationPaid', () => {
  it('invoiced reg is unpaid until invoice_paid_at is set — even when confirmed', () => {
    // The bug this guards: status=confirmed was read as "Invoice Paid".
    expect(registrationPaid({ invoiceRequested: true, status: 'confirmed', invoicePaidAt: null })).toBe(false)
    expect(registrationPaid({ invoiceRequested: true, status: 'pending', invoicePaidAt: null })).toBe(false)
  })

  it('invoiced reg is paid once invoice_paid_at is set', () => {
    expect(registrationPaid({ invoiceRequested: true, invoicePaidAt: '2026-07-08T00:00:00Z', status: 'pending' })).toBe(true)
  })

  it('card / payment-link reg is paid when confirmed', () => {
    expect(registrationPaid({ invoiceRequested: false, status: 'confirmed' })).toBe(true)
    expect(registrationPaid({ status: 'confirmed' })).toBe(true)
  })

  it('non-invoiced reg is paid when the member paid individually', () => {
    expect(registrationPaid({ invoiceRequested: false, status: 'pending', individualPaymentStatus: 'paid' })).toBe(true)
  })

  it('unpaid non-invoiced reg is not paid', () => {
    expect(registrationPaid({ status: 'pending', individualPaymentStatus: 'pending' })).toBe(false)
    expect(registrationPaid({})).toBe(false)
  })

  it('individual_payment_status does not mark an invoiced reg paid', () => {
    // For an invoiced group the invoice gate is authoritative, not a stray
    // individual status.
    expect(registrationPaid({ invoiceRequested: true, invoicePaidAt: null, individualPaymentStatus: 'paid' })).toBe(false)
  })
})
