import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { NotificationBell } from '@/components/community/NotificationBell'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'

export const metadata = { title: 'Community' }

// Gated shell for the members-only Community portal (FR-COM-01).
// The brand chrome (logo, account menu, Log In/My Account) is provided once by the
// parent (member) layout's shared SiteHeader; this layout adds only the community
// section sub-nav beneath it — no second header. Middleware already bounces
// unauthenticated users to /sign-up; here we additionally ensure a member record
// exists (else onboarding) before rendering any community route.
export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-up')

  const member = await getCurrentMember()
  if (!member) redirect('/account/onboarding')

  const caps = await getHostCaps(member.id)

  const nav = [
    { href: '/community', label: 'Spaces' },
    { href: '/community/events', label: 'Events' },
    { href: '/community/training', label: 'Training' },
    { href: '/community/coaching', label: 'Coaching' },
    { href: '/community/mentoring', label: 'Mentoring' },
    { href: '/community/resources', label: 'Resources' },
    { href: '/community/members', label: 'Directory' },
    { href: '/community/search', label: 'Search' },
    ...(caps.canCoach || caps.canMentor ? [{ href: '/community/hosting', label: 'Hosting' }] : []),
  ]

  return (
    <div>
      {/* Community section sub-nav — sits beneath the shared SiteHeader.
          Scrolls horizontally on narrow viewports (NFR: responsive). */}
      <div className="-mt-4 mb-8 flex items-center justify-between gap-4 border-b border-gray-200 pb-3">
        <nav className="flex items-center gap-5 text-sm overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-gray-600 hover:text-gray-900 whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <NotificationBell />
      </div>
      {children}
    </div>
  )
}
