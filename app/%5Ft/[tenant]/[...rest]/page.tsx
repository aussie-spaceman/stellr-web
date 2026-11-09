import { notFound } from 'next/navigation'

// Any path with no page in the tenant tree yet. Without this Next would answer with
// app/global-not-found.tsx, which is Stellr's, on a tenant host. A real page beside this
// one wins over the catch-all. The fallback rewrite in next.config.mjs also ends here, and
// some of those URLs skip the proxy, so with no script rule in their policy: this page, and
// the tree's layout and 404 around it, must hold no tenant or request data.
export default function TenantUnmatchedPage(): never {
  notFound()
}
