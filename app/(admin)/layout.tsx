import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import { hasAdminPortalAccess, isAdminClaims } from '@/lib/admin-auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')

  // Admins see the full portal; Event Managers only the Events section
  // (middleware redirects them away from other /admin routes).
  if (!hasAdminPortalAccess(sessionClaims)) redirect('/account')
  const isAdmin = isAdminClaims(sessionClaims)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              Stellr
            </Link>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              {isAdmin ? 'Admin' : 'Event Manager'}
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
            {isAdmin && (
            <>
            <Link href="/admin" className="text-gray-600 hover:text-gray-900">
              Members
            </Link>
            <Link href="/admin/schools" className="text-gray-600 hover:text-gray-900">
              Schools
            </Link>
            <Link href="/admin/docusigns" className="text-gray-600 hover:text-gray-900">
              Consent Forms
            </Link>
            <Link href="/admin/activity-log" className="text-gray-600 hover:text-gray-900">
              Activity Log
            </Link>
            <Link href="/admin/community/resources" className="text-gray-600 hover:text-gray-900">
              Resources
            </Link>
            <Link href="/admin/community/training" className="text-gray-600 hover:text-gray-900">
              Training
            </Link>
            <Link href="/admin/community/entitlements" className="text-gray-600 hover:text-gray-900">
              Access
            </Link>
            <Link href="/admin/community/sessions" className="text-gray-600 hover:text-gray-900">
              Sessions
            </Link>
            <Link href="/admin/community/announcements" className="text-gray-600 hover:text-gray-900">
              Announcements
            </Link>
            <Link href="/admin/community/moderation" className="text-gray-600 hover:text-gray-900">
              Moderation
            </Link>
            <Link href="/admin/email" className="text-gray-600 hover:text-gray-900">
              Email
            </Link>
            </>
            )}
            <Link href="/admin/events" className="text-gray-600 hover:text-gray-900">
              Events
            </Link>
            <UserButton />
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-10">{children}</main>
    </div>
  )
}
