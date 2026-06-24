import { auth } from '@clerk/nextjs/server'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  const member = await getCurrentMember()
  const caps = member ? await getHostCaps(member.id) : null
  const showHosting = !!caps && (caps.canCoach || caps.canMentor)
  const isTeacher = member?.event_role === 'teacher'

  return (
    <div className="min-h-screen bg-surface">
      <div className="flex">
        <AppSidebar canHost={showHosting} isTeacher={isTeacher} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <AppTopBar isAdmin={isAdmin} />

          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pb-24 lg:px-8 lg:pb-10">
            {children}
          </main>

          {/* Footer hidden on mobile — bottom tab bar serves that role */}
          <div className="hidden lg:block">
            <SiteFooter variant="slim" />
          </div>
        </div>
      </div>
    </div>
  )
}
