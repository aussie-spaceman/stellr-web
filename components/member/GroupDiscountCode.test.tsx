import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GroupDiscountCode } from './GroupDiscountCode'

// The teacher's code box on an invoiced group (Account → Teams): check a code, see
// the new total, then send the revised invoice. Nothing changes before that click.

type Reply = { status?: number; body: unknown }
let replies: Reply[] = []
const calls: { method: string; body: unknown }[] = []

beforeEach(() => {
  replies = []
  calls.length = 0
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body as string) : null })
    const next = replies.shift() ?? { body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

const OPEN = { applies: true, code: null, invoice: { totalCents: 116400, currency: 'usd', status: 'open', hostedUrl: null }, lockedReason: null, canChange: true, readOnlyNote: null }

describe('GroupDiscountCode', () => {
  it('checks a code, shows the new total, and only then sends the revised invoice', async () => {
    const user = userEvent.setup()
    replies.push({ body: OPEN })
    render(<GroupDiscountCode registrationId="reg-1" />)
    expect(await screen.findByText(/invoice total \$1,164\.00/)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox'), 'STEMCAREERS')
    replies.push({ body: { label: 'STEMCAREERS (15% off)', summary: '12 × $97.00 = $1,164.00, less $174.60 = $989.40' } })
    await user.click(screen.getByRole('button', { name: 'Check code' }))
    expect(await screen.findByText(/less \$174\.60 = \$989\.40/)).toBeInTheDocument()
    expect(calls.at(-1)).toEqual({ method: 'POST', body: { action: 'preview', code: 'STEMCAREERS' } })

    replies.push({ body: { message: 'Sent a revised invoice for 12 participants: $989.40.', invoiceId: 'in_2' } })
    replies.push({ body: { ...OPEN, code: 'STEMCAREERS', invoice: { ...OPEN.invoice, totalCents: 98940 } } })
    await user.click(screen.getByRole('button', { name: 'Apply and send revised invoice' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent a revised invoice')
    expect(calls.find((c) => (c.body as { action?: string } | null)?.action === 'apply')?.body).toEqual({ action: 'apply', code: 'STEMCAREERS' })
    await waitFor(() => expect(screen.getByText('STEMCAREERS', { exact: false })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Remove code' })).toBeInTheDocument()
  })

  it('says why a code was refused, and changes nothing', async () => {
    const user = userEvent.setup()
    replies.push({ body: OPEN })
    render(<GroupDiscountCode registrationId="reg-1" />)
    await user.type(await screen.findByRole('textbox'), 'SCHOLARSHIP100')
    replies.push({ status: 404, body: { error: 'That code isn’t valid for this event. Check it and try again.' } })
    await user.click(screen.getByRole('button', { name: 'Check code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t valid for this event')
    expect(screen.queryByRole('button', { name: /Apply/ })).toBeNull()
  })

  it('is read-only for a student manager, and says so', async () => {
    replies.push({ body: { ...OPEN, code: 'STEMCAREERS', canChange: false, readOnlyNote: 'Your teacher can add a discount code to the invoice.' } })
    render(<GroupDiscountCode registrationId="reg-1" />)
    expect(await screen.findByText('Your teacher can add a discount code to the invoice.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove code' })).toBeNull()
  })

  it('shows nothing for a group that pays another way', async () => {
    replies.push({ body: { applies: false } })
    const { container } = render(<GroupDiscountCode registrationId="reg-1" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })
})
