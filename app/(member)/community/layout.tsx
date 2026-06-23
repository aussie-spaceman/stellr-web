import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import { getCurrentMember } from '@/lib/community'
import { Toaster } from '@/components/ui/Toast'

export const metadata = { title: 'Community' }

// Gated shell for the members-only Community portal (FR-COM-01).
// All chrome (logo, app nav, search, notifications, account menu) is provided
// by the parent (member) layout's AppHeader — this layout only enforces the
// gate. Middleware already bounces unauthenticated users to /sign-up; here we
// additionally ensure a member record exists (else onboarding) before
// rendering any community route.
export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-up')

  const member = await getCurrentMember()
  if (!member) redirect('/account/onboarding')

  return (
    <>
      {children}
      <Toaster />
    </>
  )
}
