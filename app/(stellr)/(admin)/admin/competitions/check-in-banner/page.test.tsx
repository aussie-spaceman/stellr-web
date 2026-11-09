import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OpenCheckIn } from '@/lib/check-in-banner'

// S0 (Nov 2026): the banner page listed every event with check-in open, by
// name and with a link, to any event manager. They now see only the events
// they are assigned to; where a scan goes is still worked out across every
// event, but another event is not named.

const h = vi.hoisted(() => ({
  access: { ok: true, isAdmin: true, assignedSlugs: null } as
    | { ok: true; isAdmin: boolean; assignedSlugs: string[] | null }
    | { ok: false; status: 401 | 403 },
  open: [] as OpenCheckIn[],
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => h.access }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/env-guards', () => ({ isRealProductionApp: () => true }))
vi.mock('qrcode', () => ({
  default: { toString: async () => '<svg/>', toDataURL: async () => 'data:image/png;base64,' },
}))
vi.mock('@/lib/check-in-banner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/check-in-banner')>()),
  loadOpenCheckIns: async () => h.open,
}))

const { default: CheckInBannerAdminPage } = await import('./page')

const today = new Date().toISOString().slice(0, 10)
const row = (slug: string, title: string, date: string): OpenCheckIn => ({
  slug, token: 't', title, date, endDate: null, inPerson: true,
})

beforeEach(() => {
  h.access = { ok: true, isAdmin: true, assignedSlugs: null }
  h.open = []
})

describe('check-in banner page', () => {
  it('a full admin sees where a scan goes and every open event', async () => {
    h.open = [row('colorado', 'Colorado SDC', today), row('nevada', 'Nevada SDC', '2099-01-01')]
    render(await CheckInBannerAdminPage())
    expect(screen.getByRole('link', { name: 'Colorado SDC' })).toHaveAttribute('href', '/admin/competitions/colorado/check-in')
    expect(screen.getByText(/Check-in is open for Colorado SDC and Nevada SDC/)).toBeInTheDocument()
  })

  it('an event manager is not shown an event they don’t manage', async () => {
    h.access = { ok: true, isAdmin: false, assignedSlugs: ['nevada'] }
    h.open = [row('colorado', 'Colorado SDC', today), row('nevada', 'Nevada SDC', '2099-01-01')]
    const { container } = render(await CheckInBannerAdminPage())
    expect(screen.getByText(/A scan opens check-in for another event right now/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Colorado/)
    expect(container.querySelector('a[href*="colorado"]')).toBeNull()
  })

  it('an event manager whose own event is the target sees it named', async () => {
    h.access = { ok: true, isAdmin: false, assignedSlugs: ['nevada'] }
    h.open = [row('nevada', 'Nevada SDC', today)]
    render(await CheckInBannerAdminPage())
    expect(screen.getByRole('link', { name: 'Nevada SDC' })).toHaveAttribute('href', '/admin/competitions/nevada/check-in')
  })
})
