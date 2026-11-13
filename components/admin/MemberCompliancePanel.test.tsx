import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberCompliancePanel, type MemberCompliance } from './MemberCompliancePanel'

// The admin side of teacher licenses: see the uploaded document, and enter a
// license (plus its document) for a member who emailed a copy. Saving must not
// verify; Mark verified stays its own click.

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const { uploadDirectToStorage, postUpload } = vi.hoisted(() => ({
  uploadDirectToStorage: vi.fn(async (_file: File, _purpose: string, _ctx?: Record<string, string>) => ({
    storagePath: 'm1/1-scan.pdf', fileName: 'scan.pdf', fileType: 'application/pdf', fileSize: 4,
  })),
  postUpload: vi.fn(async (_url: string, _body: string) => ({ data: { ok: true } })),
}))
vi.mock('@/lib/upload-client', () => ({ uploadDirectToStorage, postUpload }))

let posts: { url: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  refresh.mockClear()
  uploadDirectToStorage.mockClear()
  postUpload.mockClear()
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) })
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

const license = {
  id: 'l1', license_number: 'T-1', licensing_state: 'UT', expiry_date: '2028-06-30', verified_at: null,
  verified_label: null, document_path: 'm1/old.png', updated_at: '2026-10-01T00:00:00Z',
}
const compliance = (over: Partial<MemberCompliance> = {}): MemberCompliance => ({
  state: 'invalid', detail: 'No valid clearance on file', license: null, check: null, ...over,
})

describe('MemberCompliancePanel — teacher license', () => {
  it('links to the uploaded document so the admin can see what they verify', () => {
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'in_process', license })} />)
    expect(screen.getByRole('link', { name: /view document/i })).toHaveAttribute('href', '/api/admin/members/m1/license/document')
    expect(screen.getByRole('button', { name: 'Mark verified' })).toBeInTheDocument()
  })

  it('says when no document is uploaded', () => {
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'in_process', license: { ...license, document_path: null } })} />)
    expect(screen.queryByRole('link', { name: /view document/i })).not.toBeInTheDocument()
    expect(screen.getByText('None uploaded')).toBeInTheDocument()
  })

  it('adds a license with its document for a member who has none, without verifying it', async () => {
    const user = userEvent.setup()
    render(<MemberCompliancePanel memberId="m1" compliance={compliance()} />)

    await user.click(screen.getByRole('button', { name: 'Add license' }))
    await user.type(screen.getByLabelText('License number'), 'T-9')
    await user.type(screen.getByLabelText('Licensing state'), 'Utah')
    await user.type(screen.getByLabelText('Expiry date'), '2028-06-30')
    await user.upload(screen.getByLabelText(/photo \/ scan/i), new File(['%PDF'], 'scan.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Save license' }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(posts).toEqual([
      { url: '/api/admin/members/m1/license', body: { action: 'save', license_number: 'T-9', licensing_state: 'Utah', expiry_date: '2028-06-30' } },
    ])
    expect(uploadDirectToStorage).toHaveBeenCalledWith(expect.any(File), 'compliance-document-admin', { memberId: 'm1' })
    expect(postUpload.mock.calls[0][0]).toBe('/api/admin/members/m1/license/document')
    expect(posts.some((p) => p.body.action === 'verify')).toBe(false)
  })

  // 9 Nov 2026: an adult whose role needs no clearance can still need it
  // recorded (Event Manager), so the panel shows with a note. The page passes
  // null for a known minor, which hides it.
  it('shows for an adult whose role needs no clearance, and says so', () => {
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'not_required' })} />)
    expect(screen.getByText(/not required for their current role/i)).toBeInTheDocument()
  })

  it('stays hidden when there is nothing to show (a known minor)', () => {
    const { container } = render(<MemberCompliancePanel memberId="m1" compliance={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('MemberCompliancePanel — uploaded background check', () => {
  const external = {
    issuer: 'ISD 196', completed_on: '2025-08-01', document_expires_on: null, verified_at: null, verified_label: null,
    submitted_by: 'member' as const, updated_at: '2026-11-01T00:00:00Z', valid_until: '2028-08-01',
  }

  it('links to the document and verifies against the version shown (BG-9)', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'awaiting_verification', external })} />)
    const links = screen.getAllByRole('link', { name: /view document/i })
    expect(links.map((l) => l.getAttribute('href'))).toContain('/api/admin/members/m1/external-check')
    await user.click(screen.getByRole('button', { name: 'Mark verified' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(posts).toEqual([{ url: '/api/admin/members/m1/external-check', body: { action: 'verify', updatedAt: '2026-11-01T00:00:00Z' } }])
  })

  it('will not submit without the document', async () => {
    const user = userEvent.setup()
    render(<MemberCompliancePanel memberId="m1" compliance={compliance()} />)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText(/issued by/i), 'ISD 196')
    await user.type(screen.getByLabelText(/date completed/i), '2025-08-01')
    await user.click(screen.getByRole('button', { name: 'Submit background check' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/upload the background check document/i)
    expect(uploadDirectToStorage).not.toHaveBeenCalled()
    expect(postUpload).not.toHaveBeenCalled()
  })

  it('uploads first, then saves the details with the path, without verifying', async () => {
    const user = userEvent.setup()
    render(<MemberCompliancePanel memberId="m1" compliance={compliance()} />)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByLabelText(/issued by/i), 'ISD 196')
    await user.type(screen.getByLabelText(/date completed/i), '2025-08-01')
    await user.upload(screen.getByLabelText(/document \(required\)/i), new File(['%PDF'], 'check.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Submit background check' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(uploadDirectToStorage).toHaveBeenCalledWith(expect.any(File), 'external-bc-document-admin', { memberId: 'm1' })
    expect(postUpload.mock.calls[0][0]).toBe('/api/admin/members/m1/external-check')
    expect(JSON.parse(postUpload.mock.calls[0][1])).toEqual({
      action: 'save', issuer: 'ISD 196', completed_on: '2025-08-01', document_expires_on: null,
      storagePath: 'm1/1-scan.pdf', fileType: 'application/pdf',
    })
  })
})

describe('MemberCompliancePanel — Staff (canVerify off)', () => {
  it('shows the license but no Mark verified: an admin verifies', () => {
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'in_process', license })} canVerify={false} />)
    expect(screen.queryByRole('button', { name: /Mark verified/ })).toBeNull()
    expect(screen.getByText('An admin verifies teaching licenses.')).toBeInTheDocument()
  })
  it('an admin still gets Mark verified', () => {
    render(<MemberCompliancePanel memberId="m1" compliance={compliance({ state: 'in_process', license })} />)
    expect(screen.getByRole('button', { name: /Mark verified/ })).toBeInTheDocument()
  })
})
