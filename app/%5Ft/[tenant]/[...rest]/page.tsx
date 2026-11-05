import { notFound } from 'next/navigation'

// Any path with no page in the tenant tree yet. Without this Next would answer with
// app/not-found.tsx, which is Stellr's, on a tenant host. A real page beside this
// one wins over the catch-all.
export default function TenantUnmatchedPage(): never {
  notFound()
}
