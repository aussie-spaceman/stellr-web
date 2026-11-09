import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/Toast'
import { fontVariables } from '@/lib/fonts'
import '../../../styles/tokens.css'
import '../../../styles/globals.css'

// The tenant tree: the pages a tenant host serves, reached only through the rewrite
// in proxy.ts (a direct /_t or /%5Ft request is a 404 on every host). The folder is
// %5Ft because a folder named _t is private to Next and never routes.
//
// This is the tree's root layout, so Stellr's metadata, JSON-LD, ConsentMode and
// SiteTracking in app/(stellr) never reach it. It renders no script of its own: the
// only scripts on these pages are Next's, which carry the request's nonce.
//
// This shell reads nothing. Each page takes its tenant from params through
// tenantFromParams(), and a page here must never decide the tenant from a header,
// the Host or a cookie.
//
// Every page renders per request, because a page with no nonce on its scripts would
// not run under the policy proxy.ts enforces here (lib/csp.ts, tenantPagePolicy).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: { absolute: 'Event site' },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables}>
      <body>
        <div className="min-h-screen bg-surface font-sans text-ink">
          <main className="mx-auto max-w-content px-4 py-16">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  )
}
