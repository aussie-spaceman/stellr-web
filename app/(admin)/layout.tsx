import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'
import { hasAdminPortalAccess, isAdminClaims } from '@/lib/admin-auth'
import { AdminNav } from '@/components/admin/AdminNav'

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
          <nav className="flex items-center gap-4 text-sm">
            {isAdmin ? (
              <AdminNav />
            ) : (
              // Event Managers only reach the Events section (middleware enforces this).
              <Link href="/admin/events" className="text-gray-600 hover:text-gray-900">
                Events
              </Link>
            )}
            <UserButton />
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-10">{children}</main>
    </div>
  )
}
