import { inflateSync } from 'node:zlib'

// How many pages a PDF has, judged before pdf-lib ever opens it.
//
// Why: pdf-lib parses every object of a file on load, and stamps every page it
// finds. A crafted PDF can pack hundreds of thousands of pages into a few MB (a
// compressed object stream), and loading and stamping that held a member upload
// route for seconds. So a member's PDF is capped at MAX_MEMBER_PDF_PAGES, and
// this counts its pages with one bounded, linear pass over the bytes.
//
// The count is an UPPER bound on the pages pdf-lib would build, never a guess
// below it. pdf-lib makes a page only of a dictionary whose own /Type is the
// name /Page (lib/watermark/pdf countPageTree follows its rules exactly), so
// this counts every `/Type /Page` in the file:
//
//   - Names are decoded as pdf-lib decodes them (`/P#61ge` is /Page), and a
//     /Type followed by a comment, or by nothing within a short window, counts
//     as a page — the only way to be wrong there is to count too many.
//   - Strings, comments and stream data are scanned too. pdf-lib parses none of
//     them as pages, so all they can do is add to the count.
//   - Object streams (/Type /ObjStm) hold objects compressed, out of sight of a
//     plain scan, so each is inflated — Flate only, under a total output budget
//     — and scanned the same way. Its header must give every object its own
//     offset: two entries at one offset would let one page in the text become
//     many in pdf-lib.
//   - Anything that can't be read that way (another filter, an encrypted or
//     damaged stream, the budget spent) is "can't tell", which the caller
//     refuses: a file is never let through because it couldn't be counted.
//
// What this cannot see is a page tree that lists one page many times. That
// costs nothing to load, and stampPdfBytes refuses to stamp it (countPageTree).
//
// An incremental save keeps the old copy of every object it rewrites, so a
// signed or annotated PDF can carry more `/Type /Page` than it has pages.
// checkPdfPageLimit settles a count above the cap but within PAGE_SCAN_HEADROOM
// times it with pdf-lib itself — loading a file this scan has already bounded.

/** The most pages a PDF a member uploads may have (owner decision, 3 Nov 2026). */
export const MAX_MEMBER_PDF_PAGES = 50

export const PDF_TOO_MANY_PAGES = `PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Upload a shorter version, or split it into parts.`
export const PDF_PAGES_UNKNOWN = `We couldn’t count the pages in that PDF, and PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Save it again as a PDF (Print › Save as PDF works) and upload that copy.`

/** Counts above the cap but within this many times it are settled by loading the file. */
export const PAGE_SCAN_HEADROOM = 5

/** The most an object stream scan inflates, in total, for one file. */
export const OBJECT_STREAM_BUDGET = 16 * 1024 * 1024
/** The most object streams one file may have before it is "can't tell". */
export const MAX_OBJECT_STREAMS = 1000

// ── Bytes ───────────────────────────────────────────────────────────────────

const SLASH = 0x2f
const PERCENT = 0x25
const LBRACKET = 0x5b
const RBRACKET = 0x5d

/** PDF whitespace: NUL, tab, LF, FF, CR, space. */
const WS = new Uint8Array(256)
for (const c of [0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]) WS[c] = 1
/** Whitespace and the delimiters ( ) < > [ ] { } / % — what ends a name. */
const ENDS_NAME = new Uint8Array(256)
for (let c = 0; c < 256; c++) if (WS[c]) ENDS_NAME[c] = 1
for (const ch of '()<>[]{}/%') ENDS_NAME[ch.charCodeAt(0)] = 1

const isDigit = (c: number) => c >= 0x30 && c <= 0x39

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30
  if (c >= 0x41 && c <= 0x46) return c - 0x37
  if (c >= 0x61 && c <= 0x66) return c - 0x57
  return -1
}

/**
 * Where the name whose `/` is at `slash` ends. Names are read no further than
 * LONGEST_RAW_NAME bytes: none this scan looks for is longer even fully
 * #-escaped, and a longer one is simply not one of them.
 */
const LONGEST_RAW_NAME = 40
function nameEnd(b: Uint8Array, slash: number): number {
  let j = slash + 1
  const stop = Math.min(b.length, slash + 1 + LONGEST_RAW_NAME + 1)
  while (j < stop && !ENDS_NAME[b[j]]) j++
  return j
}

/**
 * Whether the raw name bytes [start, end) decode to `target`. `#xx` is one
 * byte, as pdf-lib reads it (and lowercase hex too: decoding more than pdf-lib
 * only counts more). Compared in place, so a scan allocates nothing per name.
 */
function nameIs(b: Uint8Array, start: number, end: number, target: string): boolean {
  let i = start
  for (let k = 0; k < target.length; k++) {
    if (i >= end) return false
    let c = b[i]
    if (c === 0x23 && i + 2 < end) {
      const hi = hexValue(b[i + 1])
      const lo = hexValue(b[i + 2])
      if (hi >= 0 && lo >= 0) {
        c = hi * 16 + lo
        i += 2
      }
    }
    if (c !== target.charCodeAt(k)) return false
    i++
  }
  return i === end
}

/** The first byte at or after `from` that isn't whitespace, looking at most `window` bytes; -1 past it. */
const VALUE_WINDOW = 32
function skipWs(b: Uint8Array, from: number, window = VALUE_WINDOW): number {
  const stop = Math.min(b.length, from + window)
  for (let j = from; j < stop; j++) if (!WS[b[j]]) return j
  return -1
}

// ── The scan ────────────────────────────────────────────────────────────────

/** "can't tell": the caller treats this as over the cap. */
const UNKNOWN = null

type Counter = { pages: number; stopAbove: number }

/**
 * What a /Type's value says. A page when the value is the name /Page, or when
 * a comment or a long run of whitespace hides it (counted, not risked).
 * `ref` when it is a number: pdf-lib looks an object stream's /Type up through
 * a reference, so that stream must be treated as one.
 */
function typeValue(b: Uint8Array, nameStop: number): 'page' | 'ref' | 'other' {
  const v = skipWs(b, nameStop)
  if (v < 0) return 'page'
  const c = b[v]
  if (c === PERCENT) return 'page'
  if (c === SLASH) return nameIs(b, v + 1, nameEnd(b, v), 'Page') ? 'page' : 'other'
  return isDigit(c) ? 'ref' : 'other'
}

/** Count the `/Type /Page` in decompressed object-stream contents. */
function countMarkers(b: Uint8Array, counter: Counter): void {
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== SLASH) continue
    const end = nameEnd(b, i)
    const first = end > i + 1 ? b[i + 1] : 0
    if ((first === 0x54 || first === 0x23) && nameIs(b, i + 1, end, 'Type') && typeValue(b, end) === 'page') {
      if (++counter.pages > counter.stopAbove) return
    }
    i = end - 1
  }
}

/**
 * An object stream's header: pairs of object number and offset, as integers,
 * from the start. pdf-lib reads N of them and parses an object at each offset,
 * so two at one offset would parse one dictionary twice. Every pair it could
 * read must have its own offset — or, hidden behind a comment, it can't be told.
 */
function headerOffsetsDistinct(d: Uint8Array): boolean {
  const seen = new Set<number>()
  let i = 0
  let index = 0
  for (;;) {
    while (i < d.length && WS[d[i]]) i++
    if (i >= d.length) return true
    if (d[i] === PERCENT) return false
    if (!isDigit(d[i])) return true
    let value = 0
    while (i < d.length && isDigit(d[i])) {
      value = value * 10 + (d[i] - 0x30)
      if (value > Number.MAX_SAFE_INTEGER) return false
      i++
    }
    if (index % 2 === 1) {
      if (seen.has(value)) return false
      seen.add(value)
    }
    index++
  }
}

/**
 * The window since the last `stream` keyword: what the dictionary of the next
 * stream said, read as names. Reset at every stream that isn't an `endstream`,
 * and judged there.
 */
type Window = {
  objStm: boolean
  typeRef: boolean
  /** Flate filters in the last /Filter value; -1 when it named anything else. */
  flates: number
  sawFilter: boolean
}

const freshWindow = (): Window => ({ objStm: false, typeRef: false, flates: -1, sawFilter: false })

/** Read a /Filter value: how many FlateDecode it applies, or -1 for anything else. */
function filterValue(b: Uint8Array, nameStop: number): number {
  const v = skipWs(b, nameStop)
  if (v < 0) return -1
  if (b[v] === SLASH) {
    const end = nameEnd(b, v)
    return nameIs(b, v + 1, end, 'FlateDecode') ? 1 : -1
  }
  if (b[v] !== LBRACKET) return -1
  let n = 0
  let j = v + 1
  for (let k = 0; k < 8; k++) {
    j = skipWs(b, j)
    if (j < 0) return -1
    if (b[j] === RBRACKET) return n
    if (b[j] !== SLASH) return -1
    const end = nameEnd(b, j)
    if (!nameIs(b, j + 1, end, 'FlateDecode')) return -1
    n++
    j = end
  }
  return -1
}

const STREAM = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "stream"
const END = [0x65, 0x6e, 0x64] // "end"

function matchesAt(b: Uint8Array, at: number, seq: readonly number[]): boolean {
  if (at < 0 || at + seq.length > b.length) return false
  for (let k = 0; k < seq.length; k++) if (b[at + k] !== seq[k]) return false
  return true
}

/** Where a stream's data starts after its `stream` keyword, as pdf-lib takes it. */
function streamDataStart(b: Uint8Array, afterKeyword: number): number {
  const at = (k: number) => b[afterKeyword + k]
  if (at(0) === 0x20 && at(1) === 0x0d && at(2) === 0x0a) return afterKeyword + 3
  if (at(0) === 0x0d && at(1) === 0x0a) return afterKeyword + 2
  if (at(0) === 0x0d || at(0) === 0x0a) return afterKeyword + 1
  return afterKeyword
}

/**
 * The number of `/Type /Page` a PDF holds, counting inside its object streams;
 * an upper bound on its pages. Stops counting past `stopAbove`. null when it
 * can't be told cheaply — the caller must refuse the file.
 */
export function countPdfPageMarkers(bytes: Uint8Array, stopAbove: number): number | null {
  const counter: Counter = { pages: 0, stopAbove }
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let window = freshWindow()
  let budget = OBJECT_STREAM_BUDGET
  let streams = 0
  // Object streams' data regions, summed: in a well-formed file they never
  // overlap, so they never total more than the file. Overlapping ones could
  // make each inflate re-read the same bytes.
  let regionBytes = 0

  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === SLASH) {
      const end = nameEnd(bytes, i)
      // Only names that open with their first letter, or with an escape, can
      // be one of these; most names are passed over on one byte.
      const first = end > i + 1 ? bytes[i + 1] : 0
      const escaped = first === 0x23
      if ((first === 0x54 || escaped) && nameIs(bytes, i + 1, end, 'Type')) {
        const value = typeValue(bytes, end)
        if (value === 'page' && ++counter.pages > stopAbove) return counter.pages
        if (value === 'ref') window.typeRef = true
      } else if ((first === 0x4f || escaped) && nameIs(bytes, i + 1, end, 'ObjStm')) {
        window.objStm = true
      } else if ((first === 0x46 || escaped) && nameIs(bytes, i + 1, end, 'Filter')) {
        window.sawFilter = true
        window.flates = filterValue(bytes, end)
      }
      // A name holds no keyword pdf-lib would act on; the next token starts
      // at its end (a name ends at the next `/`, so none is skipped).
      i = end - 1
      continue
    }
    if (c !== 0x73 || !matchesAt(bytes, i, STREAM) || matchesAt(bytes, i - 3, END)) continue

    // A stream starts here. If its dictionary could make it an object stream,
    // read it; pdf-lib would.
    const candidate = window.objStm || window.typeRef
    const { sawFilter, flates } = window
    window = freshWindow()
    if (!candidate) continue
    // Anything but Flate can't be read here.
    if (sawFilter && flates < 1) return UNKNOWN
    if (++streams > MAX_OBJECT_STREAMS) return UNKNOWN

    const start = streamDataStart(bytes, i + STREAM.length)
    const found = buf.indexOf('endstream', start, 'latin1')
    const stop = found < 0 ? bytes.length : found
    regionBytes += stop - start
    if (regionBytes > bytes.length) return UNKNOWN

    let data: Uint8Array = bytes.subarray(start, stop)
    // Uncompressed contents sit in the file as text, and this pass counts
    // their pages as it goes; only the header needs reading.
    if (!sawFilter) {
      if (!headerOffsetsDistinct(data)) return UNKNOWN
      continue
    }
    try {
      for (let k = 0; k < flates; k++) {
        if (budget <= 0) return UNKNOWN
        const out = inflateSync(data, { maxOutputLength: budget })
        budget -= out.byteLength
        data = out
      }
    } catch {
      // Damaged, truncated, encrypted, or past the budget.
      return UNKNOWN
    }
    if (!headerOffsetsDistinct(data)) return UNKNOWN
    countMarkers(data, counter)
    if (counter.pages > stopAbove) return counter.pages
  }
  return counter.pages
}

export type PdfPageCheck = 'ok' | 'over' | 'unknown'

/**
 * Whether a PDF fits within `maxPages`. The scan decides almost every file; a
 * count just over the cap (an incremental save's old copies of pages) is
 * settled by loading the file with pdf-lib and counting its page tree, which
 * the scan has already bounded to PAGE_SCAN_HEADROOM times the cap.
 */
export async function checkPdfPageLimit(bytes: Uint8Array, maxPages: number): Promise<PdfPageCheck> {
  const ceiling = maxPages * PAGE_SCAN_HEADROOM
  const markers = countPdfPageMarkers(bytes, ceiling)
  if (markers === null) return 'unknown'
  if (markers <= maxPages) return 'ok'
  if (markers > ceiling) return 'over'
  try {
    const [{ PDFDocument }, { countPageTree }] = await Promise.all([
      import('pdf-lib'),
      import('@/lib/watermark/pdf'),
    ])
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
    const pages = countPageTree(doc, maxPages)
    if (pages === null) return 'unknown'
    return pages > maxPages ? 'over' : 'ok'
  } catch {
    return 'unknown'
  }
}
