import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { UserButton } from '@clerk/nextjs'
import { hasAdminPortalAccess, isAdminClaims } from '@/lib/admin-auth'
import { AdminSidebar } from '@/components/admin/AdminSidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, sessionClaims } = await auth()
  if (!userId) redirect('/sign-in')

  // Admins see the full portal; Event Managers only the Events section
  // (middleware redirects them away from other /admin routes).
  if (!hasAdminPortalAccess(sessionClaims)) redirect('/account')
  const isAdmin = isAdminClaims(sessionClaims)

  return (
    <div className="min-h-screen bg-brand-canvas">
      <div className="flex">
        <AdminSidebar isAdmin={isAdmin} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Slim top strip: role badge + account button */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-brand-border bg-white/85 px-4 py-3 backdrop-blur lg:px-8">
            <span className="rounded-full bg-brand-blue/10 px-2.5 py-0.5 font-subheading text-xs font-semibold text-brand-blue">
              {isAdmin ? 'Admin' : 'Event Manager'}
            </span>
            <UserButton />
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pb-24 lg:px-8 lg:pb-10">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
