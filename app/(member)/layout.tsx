import { auth } from '@clerk/nextjs/server'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { AppFooter } from '@/components/layout/AppFooter'
import { AppSearch } from '@/components/layout/AppSearch'
import { NavUserButton } from '@/components/layout/NavUserButton'
import { Logo } from '@/components/layout/Logo'
import { NotificationBell } from '@/components/community/NotificationBell'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'

// Shell for the member web app (app.stellreducation.org). Renders the persistent
// colour-coded sidebar (desktop rail + mobile bottom tab bar) plus a slim top
// strip with search, notifications, and the Clerk account button — replacing the
// previous AppHeader hover-dropdown nav (T2.1). The public (www) shell is
// unaffected; it has its own SiteHeader/Footer.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  // Hosting nav entry only for members who can coach or mentor. Member may be
  // null mid-onboarding — no caps in that case.
  const member = await getCurrentMember()
  const caps = member ? await getHostCaps(member.id) : null
  const showHosting = !!caps && (caps.canCoach || caps.canMentor)

  const name =
    (member && [member.first_name, member.last_name].filter(Boolean).join(' ')) || 'Member'
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'M'

  return (
    <div className="min-h-screen bg-brand-canvas">
      <div className="flex">
        <AppSidebar user={{ name, initials }} canHost={showHosting} />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* Slim top strip: mobile logo + search / notifications / account */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-brand-border bg-white/85 px-4 py-3 backdrop-blur lg:px-8">
            <div className="lg:hidden">
              <Logo />
            </div>
            <div className="hidden flex-1 lg:block" />
            <div className="flex items-center gap-2">
              <AppSearch />
              <NotificationBell />
              <NavUserButton isAdmin={isAdmin} />
            </div>
          </header>

          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 pb-24 lg:px-8 lg:pb-10">
            {children}
          </main>

          {/* Footer hidden on mobile (the bottom tab bar serves that role). */}
          <div className="hidden lg:block">
            <AppFooter />
          </div>
        </div>
      </div>
    </div>
  )
}
