// Serialise schema.org JSON-LD for an inline JSON-LD <script> block.
//
// JSON.stringify alone is not safe there. The HTML parser ends a script element
// at the first "</script" whatever the JSON around it means, so a Sanity string
// (or, later, tenant-authored text) such as `</script><script>alert(1)</script>`
// would close the block and run as page script. Escaping `<` closes that, and
// `<!--` with it. `>` and `&` are escaped too so no markup-significant character
// survives at all, and U+2028/U+2029 because pre-ES2019 parsers — which some
// crawlers still run — read them as line breaks inside a string.
//
// Every replacement is a JSON string escape, and JSON has no `<`, `>`, `&` or
// U+2028/9 outside strings, so JSON.parse (and every crawler) reads back exactly
// the original value. Render through components/seo/JsonLd, never by hand:
// test/json-ld-sinks.test.ts fails on a raw ld+json script anywhere else.

const UNSAFE = /[<>&\u2028\u2029]/g

const ESCAPED: Record<string, string> = {
  '<': '\\u003c',
  '>': '\\u003e',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
}

/** The script body for `data`, or null when there is nothing to serialise. */
export function serializeJsonLd(data: unknown): string | null {
  const json = JSON.stringify(data)
  // JSON.stringify(undefined) — and of a bare function — is undefined, not a string.
  if (json === undefined) return null
  return json.replace(UNSAFE, (c) => ESCAPED[c])
}
