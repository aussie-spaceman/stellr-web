import type { Metadata } from 'next'

// The tenant tree: the pages a tenant host serves, reached only through the rewrite
// in proxy.ts (a direct /_t or /%5Ft request is a 404 on every host). The folder is
// %5Ft because a folder named _t is private to Next and never routes.
//
// This shell reads nothing. Each page takes its tenant from params through
// tenantFromParams(), and a page here must never decide the tenant from a header,
// the Host or a cookie. This shell holds no Stellr content, but app/layout.tsx still
// wraps it, with Stellr's metadata and trackers, until B5c splits the root layout.
// TENANT_ROUTING_ENABLED stays off for any host in a tenant zone until then.
export const metadata: Metadata = {
  title: { absolute: 'Event site' },
  robots: { index: false, follow: false },
}

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface font-sans text-ink">
      <main className="mx-auto max-w-content px-4 py-16">{children}</main>
    </div>
  )
}
