import { auth } from '@clerk/nextjs/server'
import { AppHeader } from '@/components/layout/AppHeader'
import { AppFooter } from '@/components/layout/AppFooter'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'

// Shell for the member web app (app.stellreducation.org). Unlike the public
// (public) shell, this renders its own chrome — AppHeader/AppFooter — rather
// than the www marketing header and footer, mirroring how the app surface is
// distinct from the marketing site.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const { sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  // Hosting nav entry only for members who can coach or mentor. Member may be
  // null mid-onboarding — no caps in that case.
  const member = await getCurrentMember()
  const caps = member ? await getHostCaps(member.id) : null
  const showHosting = !!caps && (caps.canCoach || caps.canMentor)

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <AppHeader isAdmin={isAdmin} showHosting={showHosting} />
      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-10">{children}</main>
      <AppFooter />
    </div>
  )
}
