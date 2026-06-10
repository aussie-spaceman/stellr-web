import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { NavUserButton } from '@/components/layout/NavUserButton'
import { NotificationBell } from '@/components/community/NotificationBell'
import { getCurrentMember } from '@/lib/community'

export const metadata = { title: 'Community' }

// Gated shell for the members-only Community portal (FR-COM-01).
// Middleware already bounces unauthenticated users to /sign-up; here we ensure a
// member record exists (else onboarding) before rendering any community route.
export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-up')

  const member = await getCurrentMember()
  if (!member) redirect('/account/onboarding')

  const isAdmin =
    (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  const nav = [
    { href: '/community', label: 'Spaces' },
    { href: '/community/events', label: 'Events' },
    { href: '/community/training', label: 'Training' },
    { href: '/community/resources', label: 'Resources' },
    { href: '/community/members', label: 'Directory' },
    { href: '/community/search', label: 'Search' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/community" className="font-semibold text-lg tracking-tight">
              Stellr Community
            </Link>
            <nav className="hidden sm:flex items-center gap-6 text-sm">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-gray-600 hover:text-gray-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <NotificationBell />
            <Link href="/account" className="text-gray-600 hover:text-gray-900">
              My Account
            </Link>
            <NavUserButton isAdmin={isAdmin} />
          </div>
        </div>
        {/* Mobile nav (NFR: responsive) */}
        <nav className="sm:hidden border-t border-gray-100 px-4 py-2 flex gap-5 text-sm overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-gray-600 hover:text-gray-900 whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">{children}</main>
    </div>
  )
}
