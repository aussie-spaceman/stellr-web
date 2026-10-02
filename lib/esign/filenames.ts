/**
 * A name made safe for a download filename and a Content-Disposition header:
 * ASCII letters, digits and hyphens only. Diacritics are folded ("José" →
 * "jose"); anything else is dropped, so a name can never break out of the
 * header or the path.
 */
export function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'document'
}
