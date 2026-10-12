// deep review QUAL-12: pure, dependency-free Sanity URL/type helpers.
//
// `lib/sanity.ts` instantiates the next-sanity client (plus @sanity/image-url)
// at module load. A `'use client'` component that *value*-imports anything from
// it therefore drags that whole client into its browser chunk — EventFlyers, on
// the public event page, did exactly that just to call `flyerDownloadUrl`, a
// string function that needs no client at all. These helpers live here, with no
// imports, so a client component can use them without shipping the Sanity client.
// `lib/sanity.ts` re-exports them so existing server callers are unchanged.

/**
 * A public marketing PDF hanging off an event document (schema field `flyers`).
 * The bytes live on Sanity's CDN, so `url` is absolute and needs no media-host
 * prefixing — unlike the self-hosted /files assets in lib/media-manifest.ts.
 */
export interface EventFlyer {
  label: string
  /** Absolute cdn.sanity.io URL. Use flyerDownloadUrl() for a download link. */
  url: string
  /** Bytes, straight from the asset document. */
  size?: number
  /** Original upload filename — becomes the saved filename via ?dl=. */
  filename?: string
  /** Authored, optional. Null/undefined → the card shows the size alone. */
  pages?: number
}

/**
 * Sanity's asset CDN serves a PDF inline by default (the browser opens its
 * viewer). `?dl=<name>` flips it to Content-Disposition: attachment, so the
 * flyer lands in Downloads with a sensible name rather than a hashed asset id.
 *
 * The CDN echoes the ?dl= value into that header verbatim, so a percent-encoded
 * name is *saved* percent-encoded ("2027%20-%20SDC…pdf" — verified against the
 * live CDN). Normalise to a filename that needs no encoding at all instead.
 */
export function flyerDownloadUrl(flyer: EventFlyer): string {
  if (!flyer.url) return flyer.url
  const base = (flyer.filename ?? flyer.label ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return `${flyer.url}?dl=${base || 'flyer'}.pdf`
}
