// Whether a storage path names the object a check on the string thinks it does.
//
// storage-js puts the path into the request URL exactly as given (download,
// upload, createSignedUrl), and the URL parser rewrites it before the request
// leaves: `%2e%2e` or `.%2e` climbs a folder, `.` and `%2e` vanish, a tab or
// newline is dropped (so `.\t.` is `..`), `\` is a separator, `?` and `#` end the
// path, and a trailing space is trimmed. remove() sends the path unparsed. So a
// prefix pin, or a "does a row already hold this path" lookup, made on the string
// holds for the object only if the parser leaves the string alone.
//
// Every path this app issues is `<prefix>/<id>/<time>-<safe name>`, built from
// letters, digits, `.`, `_`, `-` and `/`, so none of these refusals touches one.

/** Characters the URL parser decodes as a dot, treats as a separator, or ends the path on. */
const REWRITTEN = /[%?#\\]/

/** A control character: the parser drops tabs and newlines, and no issued path holds one. */
function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return true
  }
  return false
}

export function isLiteralStoragePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.endsWith(' ') || REWRITTEN.test(path) || hasControl(path)) return false
  // Also refused: any `..` at all (no issued name holds one: safeFileName folds
  // runs of dots), and an empty segment, which `//` or a trailing `/` makes.
  if (path.includes('..')) return false
  return path.split('/').every((segment) => segment !== '' && segment !== '.')
}
