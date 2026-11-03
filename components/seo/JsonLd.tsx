import { serializeJsonLd } from '@/lib/json-ld'

/**
 * Renders schema.org JSON-LD — the only place the site does. Several graphs are
 * built from Sanity content, so the body is escaped (lib/json-ld.ts) such that
 * no string can close the script tag early. test/json-ld-sinks.test.ts fails on
 * an `application/ld+json` script written anywhere else.
 */
export function JsonLd({ data }: { data: unknown }) {
  const json = serializeJsonLd(data)
  if (json === null) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
