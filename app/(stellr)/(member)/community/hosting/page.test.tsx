import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import HostingPage from './page'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/community', () => ({
  getCurrentMember: vi.fn().mockResolvedValue({ id: 'm1', first_name: 'Ada' }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/sessions', () => ({
  getHostCaps: vi.fn().mockResolvedValue({ canCoach: false, canMentor: false }),
  getAvailability: vi.fn().mockResolvedValue([]),
  listHostSessions: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/utils', () => ({
  formatDateShort: (iso: string) => iso,
  formatDateTime: (iso: string) => iso,
}))
vi.mock('@/components/community/AvailabilityEditor', () => ({ AvailabilityEditor: () => null }))
vi.mock('@/components/community/ScheduleMentoringForm', () => ({ ScheduleMentoringForm: () => null }))
vi.mock('@/components/community/HostSessionControls', () => ({ HostSessionControls: () => null }))
vi.mock('@/components/community/JoinButton', () => ({ JoinButton: () => null }))

describe('Hosting no-access state (F-08)', () => {
  it('offers a working contact-an-administrator action', async () => {
    render(await HostingPage())
    const link = screen.getByRole('link', { name: 'Contact an administrator' })
    expect(link).toHaveAttribute('href', 'mailto:hello@stellreducation.org')
    expect(screen.getByText(/approved coaches and mentors/)).toBeInTheDocument()
  })
})
