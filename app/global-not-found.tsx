import type { Metadata } from 'next'
import { StellrDocument, stellrMetadata, stellrViewport } from './(stellr)/document'
import NotFound, { metadata as notFoundMetadata } from './(stellr)/not-found'

/*
 * A URL no page answers, on a Stellr host. With two root layouts Next has no layout to
 * put such a URL under, so this file is the whole document, and it is the same 404 a
 * page's notFound() draws from app/(stellr)/not-found.tsx. A tenant host never gets
 * here: proxy.ts sends its pages into app/%5Ft/[tenant], and the fallback rewrite in
 * next.config.mjs sends what the proxy passes on or never sees (a missing file, /_next,
 * the bypass routes) to that tree's catch-all. e2e/tenancy/stellr-document.spec.ts
 * checks both.
 */
export const metadata: Metadata = {
  ...stellrMetadata,
  ...notFoundMetadata,
  title: { absolute: `${String(notFoundMetadata.title)} | Stellr Education` },
}
export const viewport = stellrViewport

export default function GlobalNotFound() {
  return (
    <StellrDocument>
      <NotFound />
    </StellrDocument>
  )
}
