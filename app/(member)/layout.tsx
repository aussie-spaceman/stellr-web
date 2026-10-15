import { auth } from '@clerk/nextjs/server'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppTopBar } from '@/components/layout/AppTopBar'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner'
import { getCurrentMember } from '@/lib/community'
import { viewAsBannerProps } from '@/lib/impersonation'
import { getHostCaps } from '@/lib/sessions'
import { isAdminClaims } from '@/lib/admin-auth'
import { isStudentForAds } from '@/lib/no-ads'
import { NoAdsStudentMarker } from '@/components/analytics/NoAdsStudentMarker'

export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const [{ sessionClaims }, member] = await Promise.all([auth(), getCurrentMember()])
  const isAdmin = isAdminClaims(sessionClaims)

  // Admin view-as. getCurrentMember() has already resolved to the impersonated
  // member above, so `member` is who the portal is rendering — the banner just
  // has to say so, and name the admin behind it. Both reads need only the
  // member, so they run together rather than one after the other.
  const [viewAs, caps] = await Promise.all([
    viewAsBannerProps(member),
    member ? getHostCaps(member.id) : Promise.resolve(null),
  ])
  const showHosting = !!caps && (caps.canCoach || caps.canMentor)
  const isTeacher = member?.event_role === 'teacher'
  // Not while an admin views as the member: that is the admin's browser.
  const markStudent = !!member && !viewAs && isStudentForAds({ date_of_birth: member.date_of_birth ?? null, age_bracket: member.age_bracket })

  return (
    <div className="min-h-screen bg-surface">
      {markStudent && <NoAdsStudentMarker />}
      {viewAs && <ImpersonationBanner {...viewAs} />}
      <div className="flex">
        <AppSidebar canHost={showHosting} isTeacher={isTeacher} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <AppTopBar isAdmin={isAdmin} viewingAs={viewAs?.memberName ?? null} />

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
