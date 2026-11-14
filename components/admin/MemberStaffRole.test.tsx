import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemberStaffRole } from './MemberStaffRole'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const checks = (missing: string[]) =>
  (['member', 'clearance', 'agreement', 'training', 'mfa'] as const).map((key) => ({ key, ok: !missing.includes(key), message: `${key} message.`, until: null }))

let staff: unknown
const calls: { url: string; method: string; body?: unknown }[] = []

beforeEach(() => {
  calls.length = 0
  staff = { grant: null, history: [], decision: { ok: false, checks: checks(['agreement', 'training', 'mfa']), until: null } }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/admin/staff-settings') return json({ trainingModuleId: null, modules: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Safeguarding' }] })
    if (method === 'POST') return json({ ok: true, agreement: 'document_not_ready' }, 201)
    if (method === 'DELETE') return json({ ok: true })
    return json(staff)
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MemberStaffRole', () => {
  it('shows the checklist, and grants after a confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<MemberStaffRole memberId="m1" />)
    expect(await screen.findByText('Not Staff.')).toBeInTheDocument()
    expect(screen.getByText('Staff agreement')).toBeInTheDocument()
    expect(screen.getAllByText('(to do)')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'Grant Staff' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/members/m1/staff')).toBe(true))
    expect(await screen.findByRole('status')).toHaveTextContent(/document isn’t published yet/)
  })

  it('removes Staff only with a reason', async () => {
    staff = { grant: { status: 'active', granted_at: '2026-11-01T00:00:00Z', granted_by_label: 'Admin', activated_at: '2026-11-02T00:00:00Z', expires_at: '2029-11-02T00:00:00Z', ended_at: null, ended_reason: null }, history: [], decision: { ok: true, checks: checks([]), until: null } }
    const prompt = vi.spyOn(window, 'prompt').mockReturnValueOnce('').mockReturnValueOnce('Left the team')
    render(<MemberStaffRole memberId="m1" />)
    expect(await screen.findByText(/^Active until/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Staff' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Remove Staff' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ reason: 'Left the team' }))
    expect(prompt).toHaveBeenCalledTimes(2)
  })

  it('saves the training module for everyone', async () => {
    render(<MemberStaffRole memberId="m1" />)
    await userEvent.selectOptions(await screen.findByLabelText(/Staff training module/), 'Safeguarding')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ trainingModuleId: '11111111-1111-4111-8111-111111111111' }))
  })
})
