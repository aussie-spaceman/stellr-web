import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserButton } from '@clerk/nextjs'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')

  // Only allow users with role=admin in Clerk publicMetadata
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="font-semibold text-lg tracking-tight">
              Stellr
            </Link>
            <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">
              Admin
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm">
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
            <UserButton />
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-10">{children}</main>
    </div>
  )
}
