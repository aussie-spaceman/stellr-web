import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ComplianceSection } from './ComplianceSection'

// The member's "Background Check & License" card: the #clearance target the
// clearance email and notification link to, and read-only while an admin views
// as the member (the write routes refuse view-as, so buttons would only 403).

vi.mock('@/lib/upload-client', () => ({ uploadDirectToStorage: vi.fn(), postUpload: vi.fn() }))

const payload = (over: Record<string, unknown> = {}) => ({
  required: true, state: 'invalid', detail: 'No valid clearance on file', license: null, documentUrl: null, check: null, ...over,
})
let reply: Record<string, unknown>

beforeEach(() => {
  reply = payload()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.location.hash = ''
})

describe('ComplianceSection', () => {
  it('renders with id="clearance" and the add button for the member', async () => {
    render(<ComplianceSection />)
    expect(await screen.findByRole('button', { name: 'Add teaching license' })).toBeInTheDocument()
    expect(document.getElementById('clearance')).not.toBeNull()
  })

  it('scrolls to itself once loaded when the URL asks for #clearance', async () => {
    window.location.hash = '#clearance'
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<ComplianceSection />)
    await screen.findByRole('button', { name: 'Add teaching license' })
    expect(scroll).toHaveBeenCalled()
  })

  it('is read-only during view-as: no add, edit, upload or delete', async () => {
    reply = payload({
      state: 'in_process',
      license: { id: 'l1', license_number: 'T-1', licensing_state: 'UT', expiry_date: '2028-06-30', verified_at: null, verified_label: null, document_path: 'm1/a.png' },
      documentUrl: 'https://storage.test/a.png',
    })
    render(<ComplianceSection readOnly />)
    expect(await screen.findByText(/Read-only while viewing as this member/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View uploaded license' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByText('Replace')).not.toBeInTheDocument()
  })

  it('shows no add button during view-as when there is no license', async () => {
    render(<ComplianceSection readOnly />)
    expect(await screen.findByText('No teaching license on file.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add teaching license' })).not.toBeInTheDocument()
  })
})
