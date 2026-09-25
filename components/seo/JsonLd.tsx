/**
 * Renders schema.org JSON-LD. `<` is escaped so CMS or database text containing
 * "</script>" can't close the tag early — JSON.stringify alone doesn't do that.
 */
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
