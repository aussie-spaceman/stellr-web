import { createHash } from 'node:crypto'
import { IGNORED_HEADERS, masker, type RawResponse } from './body-hash'

/**
 * What a Stellr page must keep across a code change that is meant to change nothing
 * a visitor gets (S5, B5c). body-hash.ts compares two servers running one build, so
 * it can keep every byte. Two builds differ in their chunk names, build id and flight
 * data, and those are the framework's, so this keeps what the page itself says: the
 * status, the headers (cache-control says whether a page is still prerendered), each
 * head tag in order, and the rendered markup.
 *
 * Masked values are replaced, not dropped, wherever a count or an order still means
 * something. What is dropped is named below.
 */

export type DocumentShape = {
  status: number
  headers: Record<string, string>
  /** The opening <html>, then each head tag in order, then any tag streamed into the body. */
  tags: string[]
  bodyLength: number
  bodySha: string
}

// Hashed per build. The kind stays, so a stylesheet that goes missing still shows.
const BUILD_ASSET = /\/_next\/static\/(?:chunks|css)\/[^"'\s,;>\\]*?\.(css|js)(\?[^"'\s,;>\\]*)?/g

const HEAD = /<head\b[^>]*>([\s\S]*?)<\/head>/i
const HTML_OPEN = /<html\b[^>]*>/i
const TAG = /<(title|script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>|<(?:meta|link|base)\b[^>]*>/gi
const BODY_TAG = /<title\b[^>]*>[\s\S]*?<\/title>|<(?:meta|link)\b[^>]*>/gi
const SCRIPT = /<script\b([^>]*)>[\s\S]*?<\/script>/gi
const COMMENT = /<!--[\s\S]*?-->/g
// React's useId values name a position in the tree, and a layout above a page moves it.
const REACT_ID = /_R_[A-Za-z0-9]+_|«[A-Za-z0-9:]+»/g
// A hash of an error's stack, which names the file that threw. The boundary stays.
const ERROR_DIGEST = /\bdata-dgst="[^"]*"/g

export function shortSha(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

/** A long value keeps its start, to read, and a hash of the rest, to compare. Captures stay small. */
function compact(text: string, limit = 160): string {
  return text.length <= limit ? text : `${text.slice(0, limit / 2)}… sha:${shortSha(text)}`
}

/** The framework's own bootstrap: which chunks a build splits into is not the page's. */
function isBootstrapTag(tag: string): boolean {
  if (/^<script\b[^>]*\bsrc="\/_next\/static\//i.test(tag)) return true
  return /^<link\b/i.test(tag) && /\brel="preload"/i.test(tag) && /\bas="script"/i.test(tag) && tag.includes('/_next/static/')
}

/** Numbers each React id by first appearance, so two ids stay two and a swap still shows. */
function maskReactIds(html: string): string {
  const seen = new Map<string, number>()
  return html.replace(REACT_ID, (id) => {
    if (!seen.has(id)) seen.set(id, seen.size + 1)
    return `REACT_ID_${seen.get(id)}`
  })
}

/** The rendered markup: comments, flight data and bootstrap scripts go, JSON-LD stays. */
function renderedMarkup(html: string): string {
  const stripped = html.replace(SCRIPT, (whole, attrs: string) => (/application\/ld\+json/i.test(attrs) ? whole : ''))
  return stripped.replace(COMMENT, '').replace(ERROR_DIGEST, 'data-dgst="DIGEST"')
}

export function documentShape(res: RawResponse, port: number): DocumentShape {
  const mask = masker(res, port)
  const clean = (text: string) => mask(text).replace(BUILD_ASSET, '/_next/static/ASSET.$1')

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || IGNORED_HEADERS.has(name) || name.startsWith('x-nextjs-')) continue
    headers[name] = compact(clean(Array.isArray(value) ? value.join('\n') : value), 60)
  }

  const html = maskReactIds(clean(res.body))
  const headMatch = HEAD.exec(html)
  if (!headMatch) return { status: res.status, headers, tags: [], bodyLength: html.length, bodySha: shortSha(html) }

  const afterHead = html.slice(headMatch.index + headMatch[0].length)
  const body = renderedMarkup(afterHead)
  const tags = [
    ...(HTML_OPEN.exec(html)?.slice(0, 1) ?? []),
    ...(headMatch[1].match(TAG) ?? []).filter((tag) => !isBootstrapTag(tag)),
    ...(body.match(BODY_TAG) ?? []).map((tag) => `in body: ${tag}`),
  ].map((tag) => compact(tag))
  return { status: res.status, headers, tags, bodyLength: body.length, bodySha: shortSha(body) }
}

/**
 * What a page says that differs between two answers of one build, by name. Next numbers its
 * flight rows by what happened to render first, so this is the comparison to use for two
 * URLs. Flight data is not in it, so a caller that wants a value kept out of the answer
 * looks for that value in the raw body too.
 */
export function shapeDifferences(a: DocumentShape, b: DocumentShape): string[] {
  const out: string[] = []
  if (a.status !== b.status) out.push(`status ${a.status} vs ${b.status}`)
  out.push(...tagDifferences(a.tags, b.tags))
  for (const name of new Set([...Object.keys(a.headers), ...Object.keys(b.headers)])) {
    if (a.headers[name] !== b.headers[name]) out.push(`header ${name}`)
  }
  if (a.bodySha !== b.bodySha) out.push(`body (${a.bodyLength} vs ${b.bodyLength} chars)`)
  return out
}

/** status, headers set, tags set, body length, body hash. */
type StoredShape = [number, string, string, number, string]

/** A capture keeps each set of tags and headers once: most pages share theirs. */
export type Capture = {
  commit: string | null
  sourcesSha: string
  entries: Record<string, StoredShape>
  tagSets: Record<string, string[]>
  headerSets: Record<string, Record<string, string>>
}

export function emptyCapture(commit: string | null, sourcesSha: string): Capture {
  return { commit, sourcesSha, entries: {}, tagSets: {}, headerSets: {} }
}

const sorted = <T,>(record: Record<string, T>): [string, T][] => Object.entries(record).sort(([a], [b]) => a.localeCompare(b))

export function addToCapture(capture: Capture, key: string, shape: DocumentShape): void {
  const tagsSha = shortSha(JSON.stringify(shape.tags))
  const headersSha = shortSha(JSON.stringify(sorted(shape.headers)))
  capture.tagSets[tagsSha] = shape.tags
  capture.headerSets[headersSha] = shape.headers
  capture.entries[key] = [shape.status, headersSha, tagsSha, shape.bodyLength, shape.bodySha]
}

/** Sorted, one answer to a line, so a regenerated capture diffs by what changed. */
export function serialiseCapture(capture: Capture): string {
  const block = <T,>(record: Record<string, T>) =>
    `{\n${sorted(record).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n }`
  return [
    '{',
    ` "commit": ${JSON.stringify(capture.commit)},`,
    ` "sourcesSha": ${JSON.stringify(capture.sourcesSha)},`,
    ` "entries": ${block(capture.entries)},`,
    ` "tagSets": ${block(capture.tagSets)},`,
    ` "headerSets": ${block(capture.headerSets)}`,
    '}',
    '',
  ].join('\n')
}

// Headers that come from the checkout, not from the build's routing. A static file's
// last-modified is its modification time on disk, which a fresh clone (CI's included)
// sets to the moment of checkout, so a stored capture's value can never match another
// checkout's. Kept in a capture, skipped when two captures are compared.
const CHECKOUT_HEADERS = new Set(['last-modified'])

/** What moved between two captures of one answer, each difference with its own tag or header. */
export function compareStored(a: Capture, b: Capture, key: string, { body }: { body: boolean }): string[] {
  const left = a.entries[key]
  const right = b.entries[key]
  if (!left) return ['only in the second capture']
  if (!right) return ['only in the first capture']
  const out: string[] = []
  if (left[0] !== right[0]) out.push(`status ${left[0]} vs ${right[0]}`)
  if (left[2] !== right[2]) out.push(...tagDifferences(a.tagSets[left[2]], b.tagSets[right[2]]))
  if (left[1] !== right[1]) {
    const x = a.headerSets[left[1]]
    const y = b.headerSets[right[1]]
    for (const name of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (CHECKOUT_HEADERS.has(name)) continue
      if (x[name] !== y[name]) out.push(`header ${name}: ${x[name] ?? '(none)'} vs ${y[name] ?? '(none)'}`)
    }
  }
  if (body && left[4] !== right[4]) out.push(`body (${left[3]} vs ${right[3]} chars)`)
  return out
}

// Next's own marker, with no effect on a page. It lands in the head as soon as it renders,
// so on a page with async metadata its place moves between two builds of one source. It
// still has to be there, but where it sits says nothing.
const UNORDERED_TAG = '<meta name="next-size-adjust" content=""/>'

/** Lost and gained tags by text, then a plain reorder if the same tags changed place. */
export function tagDifferences(before: string[], after: string[]): string[] {
  const out: string[] = []
  const remaining = [...after]
  for (const tag of before) {
    const at = remaining.indexOf(tag)
    if (at === -1) out.push(`lost tag: ${tag}`)
    else remaining.splice(at, 1)
  }
  for (const tag of remaining) out.push(`gained tag: ${tag}`)
  const inOrder = (tags: string[]) => tags.filter((tag) => tag !== UNORDERED_TAG).join('\n')
  if (out.length === 0 && inOrder(before) !== inOrder(after)) out.push('the same tags in another order')
  return out
}
