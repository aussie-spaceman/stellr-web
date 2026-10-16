import { FlowHeader } from '@/components/layout/FlowHeader'
import { SiteFooter } from '@/components/layout/SiteFooter'

/**
 * Single-task pages — check-in, signing, surveys, team profiles and
 * registration — share the public site's URLs but not its chrome: no marketing
 * navigation and no sticky header, so on a phone the one form on the page gets
 * the whole screen. Route groups don't change URLs, so /check-in, /sign,
 * /survey, /team-profile and /register are where they always were.
 */
export default function FlowLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100svh] flex-col bg-surface">
      <FlowHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter variant="slim" />
    </div>
  )
}
