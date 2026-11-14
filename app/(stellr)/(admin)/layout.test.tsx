import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The admin shell: who gets in and which nav they see. It decides through lib/authz since
// S5 C14, with the answers below, which are what the claim checks gave before it.

const h = vi.hoisted(() => ({
  session: { userId: null as string | null, role: null as unknown },
  reads: 0,
}))

vi.mock('@clerk/nextjs/server', () => ({
  // A second factor on the session: Staff capabilities need one (staff-role.8, lib/authz/staff-mfa.test.ts).
  auth: async () => ({
    userId: h.session.userId,
    sessionClaims: h.session.userId ? { metadata: { role: h.session.role } } : null,
    factorVerificationAge: h.session.userId ? [5, 5] : null,
  }),
}))
vi.mock('@clerk/nextjs', () => ({ ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`)
  },
  notFound: () => {
    throw new Error('notFound')
  },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => {
    h.reads += 1
    throw new Error('the clerk source reads no table for the shell')
  },
}))
vi.mock('@/lib/request-nonce', () => ({ requestNonce: async () => 'nonce' }))
vi.mock('@/lib/clerk-appearance', () => ({ clerkAppearance: {} }))
vi.mock('@/components/admin/AdminUserButton', () => ({ AdminUserButton: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/admin/AdminSidebar', () => ({
  AdminSidebar: ({ role }: { role: string }) => <div data-testid="sidebar">{role}</div>,
}))

const { default: AdminLayout } = await import('./layout')

const shell = () => AdminLayout({ children: <p>content</p> })

beforeEach(() => {
  h.session = { userId: null, role: null }
  h.reads = 0
})

describe('the admin shell', () => {
  it('signed out goes to sign-in', async () => {
    await expect(shell()).rejects.toThrow('redirect /sign-in')
  })

  it.each(['student', 'member', 'Admin', 7, undefined])('a signed-in role of %s goes to the account page', async (role) => {
    h.session = { userId: 'u1', role }
    await expect(shell()).rejects.toThrow('redirect /account')
  })

  it('an admin gets the full nav and the Admin badge', async () => {
    h.session = { userId: 'u1', role: 'admin' }
    render(await shell())
    expect(screen.getByTestId('sidebar')).toHaveTextContent('admin')
    expect(screen.getByText('Admin')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('an event manager gets the shell, the short nav and the Event Manager badge, with no assignment read', async () => {
    h.session = { userId: 'u1', role: 'event_manager' }
    render(await shell())
    expect(screen.getByTestId('sidebar')).toHaveTextContent('event_manager')
    expect(screen.getByText('Event Manager')).toBeInTheDocument()
    expect(h.reads).toBe(0)
  })

  it('Staff get the Staff nav and badge, and the note on where they can make changes', async () => {
    h.session = { userId: 'u1', role: 'staff' }
    render(await shell())
    expect(screen.getByTestId('sidebar')).toHaveTextContent('staff')
    expect(screen.getByText('Staff')).toBeInTheDocument()
    expect(screen.getByText(/Changes are open in Competitions and Members/)).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
