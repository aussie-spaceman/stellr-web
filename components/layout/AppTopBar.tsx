import { Logo } from './Logo'
import { NavUserButton } from './NavUserButton'
import { AppSearch } from './AppSearch'
import { NotificationBell } from '@/components/community/NotificationBell'

interface AppTopBarProps {
  isAdmin: boolean
  /**
   * Name of the member being viewed, when an admin is in a view-as session.
   * The Clerk <UserButton> renders the ADMIN's avatar (their session is
   * untouched), which reads as being signed in as the wrong person — so during
   * view-as it is replaced by a chip naming who the portal is showing.
   */
  viewingAs?: string | null
}

/**
 * Fixed top bar for the member web app shell (app.stellreducation.org).
 * 60 px white bar with search, notifications, and user avatar on the right.
 * On mobile the Stellr logo appears on the left (sidebar is a bottom tab bar).
 */
export function AppTopBar({ isAdmin, viewingAs = null }: AppTopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-line bg-white px-6 lg:px-8">
      {/* Mobile-only logo (sidebar not visible on mobile) */}
      <div className="lg:hidden">
        <Logo sizeClassName="h-8" />
      </div>

      {/* Push right on desktop */}
      <div className="hidden flex-1 lg:block" />

      {/* Right cluster: search / notifications / account */}
      <div className="flex items-center gap-2">
        <AppSearch />
        <NotificationBell />
        {viewingAs ? (
          <span className="max-w-[14rem] truncate rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">
            Viewing as {viewingAs}
          </span>
        ) : (
          <NavUserButton isAdmin={isAdmin} />
        )}
      </div>
    </header>
  )
}
