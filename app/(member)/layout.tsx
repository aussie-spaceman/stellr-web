import { auth } from '@clerk/nextjs/server'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner'
import { getCurrentMember } from '@/lib/community'
import { getImpersonation } from '@/lib/impersonation'
import { supabaseServer } from '@/lib/supabase'
import { getHostCaps } from '@/lib/sessions'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  const member = await getCurrentMember()

  // Admin view-as. getCurrentMember() has already resolved to the impersonated
  // member above, so `member` is who the portal is rendering — the banner just
  // has to say so, and name the admin behind it.
  const impersonation = await getImpersonation()
  const viewingAsName =
    impersonation && member
      ? [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email || 'this member'
      : null
  let adminName: string | null = null
  if (impersonation?.adminMemberId) {
    const { data } = await supabaseServer()
      .from('members')
      .select('first_name, last_name, email')
      .eq('id', impersonation.adminMemberId)
      .maybeSingle()
    const a = data as { first_name: string | null; last_name: string | null; email: string | null } | null
    adminName = a ? [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email : null
  }
  const caps = member ? await getHostCaps(member.id) : null
  const showHosting = !!caps && (caps.canCoach || caps.canMentor)
  const isTeacher = member?.event_role === 'teacher'

  return (
    <div className="min-h-screen bg-surface">
      {impersonation && member && (
        <ImpersonationBanner
          memberId={impersonation.memberId}
          memberName={viewingAsName ?? 'this member'}
          adminName={adminName}
        />
      )}
      <div className="flex">
        <AppSidebar canHost={showHosting} isTeacher={isTeacher} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <AppTopBar isAdmin={isAdmin} viewingAs={viewingAsName} />

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
