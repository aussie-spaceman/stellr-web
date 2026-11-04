import { constants as zlibConstants, inflateSync } from 'node:zlib'

// How many pages a PDF has, judged before pdf-lib ever opens it.
//
// Why: pdf-lib parses every object of a file on load, and stamps every page it
// finds. A crafted PDF can pack hundreds of thousands of pages into a few MB (a
// compressed object stream), and loading and stamping that held a member upload
// route for seconds. So a member's PDF is capped at MAX_MEMBER_PDF_PAGES, and
// one bounded, linear pass over the bytes works out an UPPER BOUND on the pages
// pdf-lib could build — never a guess below it.
//
// pdf-lib makes a page only of a dictionary whose own /Type is the name /Page,
// written directly (lib/watermark/pdf countPageTree follows its rules). Pages
// come from two places, bounded two different ways:
//
//   - Objects at the top level of the file. pdf-lib parses those one after
//     another, so no two share a byte, and each page among them has its own
//     `/Type /Page` in the file. The scan counts every one, names decoded as
//     pdf-lib decodes them (`/P#61ge` is /Page); a /Type whose value a comment
//     or a long gap hides counts too. Strings, comments and stream data are
//     scanned as well: all they can do is add to the count.
//   - Objects inside object streams. pdf-lib parses one object per entry in a
//     stream's header, at whatever offset the entry gives, so entries can
//     overlap: one `/Type /Page` can be read as many pages. Counting markers
//     there would be unsound, so each entry counts as a possible page.
//
// Which streams are object streams is NOT read from their dictionaries: a
// keyword inside a string (`(stream)`) or a comment can make a scan misjudge
// where a dictionary ends. Every `stream` keyword in the file is treated as a
// possible stream start instead, and its data judged by its bytes:
//
//   - Flate data (a zlib header) is inflated a little. If what comes out can't
//     begin an object-stream header (pairs of integers), pdf-lib can't build an
//     object from it. If the header ends in sight, its entries are counted.
//     Otherwise the stream is inflated in full, under a total budget, and its
//     header read. Flate inside Flate is unwrapped the same way.
//   - Unfiltered data is read where it lies, header entries counted.
//   - pdf-lib also decodes LZW, ASCII85, ASCIIHex and RunLength. A file that
//     names any of them and could hold an object stream (it names /ObjStm, or a
//     /Type is a reference or hidden) is "can't tell".
//   - pdf-lib looks a /Filter up, so its name can sit in another object —
//     even inside an object stream the scan only sniffed. Any /Filter whose
//     value isn't a name or an array of names written right there (a
//     reference, a comment, a value past a short window), and any /DecodeParms
//     that is a reference or hidden, makes the file "can't tell".
//
// Nothing else in a file can add pages. pdf-lib parses the top level forwards
// whatever its xref sections say (incremental updates, xref streams, hybrid
// files: later copies replace earlier ones, never add), never decrypts
// (an encrypted file's streams are read as the bytes they are, as here),
// builds a page only from a leaf it reaches by reference (a page dictionary
// written inline in /Kids throws), and never trusts /Count. Which of several
// /Pages trees is the document's is settled by the load, as it is for pdf-lib.
//
// Anything that can't be read that way (damaged or encrypted Flate, a spent
// budget, too many streams) is "can't tell", which the caller refuses: a file
// is never let through because it couldn't be counted.
//
// The bound is loose for ordinary files (every object in an object stream
// counts), so checkPdfPageLimit settles a bound over the cap by loading the
// file with pdf-lib and counting its page tree — only when the scan has also
// bounded how many objects that load creates (LOAD_OBJECT_LIMIT).
//
// What this cannot see is a page tree that lists one page many times. That
// costs nothing to load, and countPageTree refuses it.

/** The most pages a PDF a member uploads may have (owner decision, 3 Nov 2026). */
export const MAX_MEMBER_PDF_PAGES = 50

export const PDF_TOO_MANY_PAGES = `PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Upload a shorter version, or split it into parts.`
export const PDF_PAGES_UNKNOWN = `We couldn’t count the pages in that PDF, and PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Save it again as a PDF (Print › Save as PDF works) and upload that copy.`

/** More `/Type /Page` than this many times the cap is refused without loading. */
export const PAGE_SCAN_HEADROOM = 5

/** The most objects a file may have for checkPdfPageLimit to load it (~0.2s of pdf-lib). */
export const LOAD_OBJECT_LIMIT = 10_000
/** The most an object-stream scan inflates in full, in total, for one file. */
export const OBJECT_STREAM_BUDGET = 16 * 1024 * 1024
/** The most streams one file may have inflated in full before it is "can't tell". */
export const MAX_OBJECT_STREAMS = 1000
/** The most Flate streams one file may have sniffed before it is "can't tell". */
export const MAX_FLATE_STREAMS = 20_000
/** The most the sniffs may inflate, in total, for one file. */
export const SNIFF_BUDGET = 32 * 1024 * 1024
/** Flate inside Flate, deeper than this, is "can't tell". */
const MAX_FLATE_DEPTH = 4

// ── Bytes ───────────────────────────────────────────────────────────────────

const SLASH = 0x2f
const PERCENT = 0x25
const LF = 0x0a
const CR = 0x0d

/** PDF whitespace as pdf-lib has it: NUL, tab, LF, FF, CR, space. */
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
 * #-escaped (RunLengthDecode is 45), and a longer one is simply not one of them.
 */
const LONGEST_RAW_NAME = 48
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

function matchesAt(b: Uint8Array, at: number, seq: readonly number[]): boolean {
  if (at < 0 || at + seq.length > b.length) return false
  for (let k = 0; k < seq.length; k++) if (b[at + k] !== seq[k]) return false
  return true
}

const STREAM = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d] // "stream"
const OBJ = [0x6f, 0x62, 0x6a] // "obj"
const END = [0x65, 0x6e, 0x64] // "end"

/** Where a stream's data starts after its `stream` keyword, as pdf-lib takes it. */
function streamDataStart(b: Uint8Array, afterKeyword: number): number {
  const at = (k: number) => b[afterKeyword + k]
  if (at(0) === 0x20 && at(1) === CR && at(2) === LF) return afterKeyword + 3
  if (at(0) === CR && at(1) === LF) return afterKeyword + 2
  if (at(0) === CR || at(0) === LF) return afterKeyword + 1
  return afterKeyword
}

/** A zlib header pdf-lib's FlateStream accepts: deflate, a valid check, no preset dictionary. */
function isZlibHeader(b: Uint8Array, at: number): boolean {
  if (at + 1 >= b.length) return false
  const cmf = b[at]
  const flg = b[at + 1]
  return (cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0 && (flg & 0x20) === 0
}

// ── Names ───────────────────────────────────────────────────────────────────

type Flags = {
  /** `/Type /Page` seen, anywhere. */
  markers: number
  /** The name /ObjStm seen, anywhere. */
  objStm: boolean
  /** A /Type whose value may be a reference pdf-lib would look up (or is hidden). */
  typeRef: boolean
  /** A filter pdf-lib decodes and this scan doesn't. */
  otherFilter: boolean
  /** A /Filter or /DecodeParms whose value isn't written out directly. */
  unresolvedFilter: boolean
}

const OTHER_FILTERS = ['LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']

/** What pdf-lib starts a number, and so a reference, with: a digit, + - or `.` */
const isNumeric = (c: number) => isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e
const LBRACKET = 0x5b
const RBRACKET = 0x5d

/**
 * What a /Type's value says. A page when the value is the name /Page. When a
 * comment or a long run of whitespace hides it, it is 'hidden': counted as a
 * page and treated as a possible reference, both (counted, not risked).
 */
function typeValue(b: Uint8Array, nameStop: number): 'page' | 'ref' | 'hidden' | 'other' {
  const v = skipWs(b, nameStop)
  if (v < 0) return 'hidden'
  const c = b[v]
  if (c === PERCENT) return 'hidden'
  if (c === SLASH) return nameIs(b, v + 1, nameEnd(b, v), 'Page') ? 'page' : 'other'
  // `+9 0 R` and `9. 0 R` are references to pdf-lib as much as `9 0 R` is.
  return isNumeric(c) ? 'ref' : 'other'
}

/**
 * How far past a /Filter the scan reads its value. Long enough for any filter
 * a writer emits ([/FlateDecode /FlateDecode] is 27 bytes); a value that runs
 * past it is not "written out directly". Short, so a file of nothing but
 * /Filter keeps the scan linear.
 */
const FILTER_WINDOW = 64

/**
 * Whether a /Filter's value is written out directly: one name, or an array of
 * names. pdf-lib looks a /Filter up — a reference, or a reference in its
 * array, is followed to wherever the object lies, which can be inside another
 * object stream this scan has only sniffed. So a reference, a comment, or
 * anything else this can't read in FILTER_WINDOW is not, and the file is
 * "can't tell".
 *
 * A name pdf-lib doesn't decode (DCTDecode, JPXDecode, Crypt, …) is fine:
 * pdf-lib throws on it (core/streams/decode), so no object comes out of that
 * stream. FlateDecode is read by this scan, and the four other filters pdf-lib
 * decodes set `otherFilter` where the name is read.
 */
function filterResolved(b: Uint8Array, nameStop: number): boolean {
  const stop = Math.min(b.length, nameStop + FILTER_WINDOW)
  let j = nameStop
  while (j < stop && WS[b[j]]) j++
  if (j >= stop) return false
  if (b[j] === SLASH) return true
  if (b[j] !== LBRACKET) return false
  j++
  for (;;) {
    while (j < stop && WS[b[j]]) j++
    if (j >= stop) return false
    if (b[j] === RBRACKET) return true
    if (b[j] !== SLASH) return false
    j++
    while (j < stop && !ENDS_NAME[b[j]]) j++
  }
}

/**
 * Whether a /DecodeParms is written out directly (a dictionary, an array, a
 * name or null). pdf-lib only reads it for LZW, which this scan refuses
 * anyway; a reference or a hidden value is refused all the same, so no
 * filter's inputs come from where the scan can't see.
 */
function parmsResolved(b: Uint8Array, nameStop: number): boolean {
  const v = skipWs(b, nameStop)
  if (v < 0) return false
  const c = b[v]
  return c === 0x3c || c === LBRACKET || c === SLASH || c === 0x6e /* null */
}

/** Read the name whose `/` is at `i` into `flags`; returns where it ends. */
function readName(b: Uint8Array, i: number, flags: Flags): number {
  const end = nameEnd(b, i)
  // Only names that open with their first letter, or with an escape, can be
  // one of these; most names are passed over on one byte.
  const first = end > i + 1 ? b[i + 1] : 0
  const escaped = first === 0x23
  if ((first === 0x54 || escaped) && nameIs(b, i + 1, end, 'Type')) {
    const value = typeValue(b, end)
    if (value === 'page') flags.markers++
    else if (value === 'ref') flags.typeRef = true
    else if (value === 'hidden') {
      flags.markers++
      flags.typeRef = true
    }
  } else if ((first === 0x46 || escaped) && nameIs(b, i + 1, end, 'Filter')) {
    if (!filterResolved(b, end)) flags.unresolvedFilter = true
  } else if ((first === 0x44 || escaped) && nameIs(b, i + 1, end, 'DecodeParms')) {
    if (!parmsResolved(b, end)) flags.unresolvedFilter = true
  } else if ((first === 0x4f || escaped) && nameIs(b, i + 1, end, 'ObjStm')) {
    flags.objStm = true
  } else if (
    (first === 0x4c || first === 0x41 || first === 0x52 || escaped) &&
    OTHER_FILTERS.some((f) => nameIs(b, i + 1, end, f))
  ) {
    flags.otherFilter = true
  }
  return end
}

/** Read every name in decompressed data into `flags`, stopping once markers pass `stopAbove`. */
function readNames(b: Uint8Array, flags: Flags, stopAbove: number): void {
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== SLASH) continue
    i = readName(b, i, flags) - 1
    if (flags.markers > stopAbove) return
  }
}

// ── Object-stream headers ───────────────────────────────────────────────────

/**
 * The integers at the start of `d[from, to)`, read as pdf-lib reads an object
 * stream's header: whitespace and comments between, digits only. `ended` says
 * the run stopped at a byte that can't continue it (so the count is final);
 * otherwise it ran to `to`.
 *
 * In the file itself (`inFile`), a comment holding `stream` sets `crossed`:
 * another stream's reading could start in it, and two readings of the same
 * bytes would make the scan quadratic. Digits and whitespace never hold it.
 */
function headerInts(
  d: Uint8Array,
  from: number,
  to: number,
  inFile = false,
): { ints: number; ended: boolean; crossed: boolean } {
  let i = from
  let ints = 0
  for (;;) {
    while (i < to && WS[d[i]]) i++
    if (i < to && d[i] === PERCENT) {
      while (i < to && d[i] !== LF && d[i] !== CR) {
        if (inFile && d[i] === 0x73 && matchesAt(d, i, STREAM)) return { ints, ended: false, crossed: true }
        i++
      }
      continue
    }
    if (i >= to) return { ints, ended: false, crossed: false }
    if (!isDigit(d[i])) return { ints, ended: true, crossed: false }
    while (i < to && isDigit(d[i])) i++
    ints++
  }
}

/** Entries in a header of `ints` integers: pdf-lib reads them in pairs. */
const entries = (ints: number) => Math.floor(ints / 2)

// ── The scan ────────────────────────────────────────────────────────────────

export type PdfPageScan = {
  /** No more pages than this can come out of pdf-lib. */
  bound: number
  /** No more objects than this can pdf-lib create on load. */
  objects: number
  /** `/Type /Page` seen, in the file and in streams inflated in full: evidence, not a bound. */
  markers: number
}

/** "can't tell": the caller treats this as over the cap. */
const UNKNOWN = null

/**
 * An upper bound on the pages pdf-lib would build from a PDF, and on the
 * objects it would create loading it. Returns early once `/Type /Page` markers
 * pass `stopAbove`. null when it can't be told cheaply — the caller must
 * refuse the file.
 */
export function scanPdfPages(bytes: Uint8Array, stopAbove = Infinity): PdfPageScan | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags: Flags = { markers: 0, objStm: false, typeRef: false, otherFilter: false, unresolvedFilter: false }
  let topMarkers = 0
  let streamEntries = 0
  let topObjects = 0
  let budget = OBJECT_STREAM_BUDGET
  let sniffBudget = SNIFF_BUDGET
  let flateStreams = 0
  let fullStreams = 0
  // Data inflated in full never overlaps: a later stream starting inside an
  // earlier one's data would have its bytes inflated twice.
  let lastRegionEnd = 0
  // The next `endstream` at or after the last search: kept, so finding each
  // stream's end is one forward pass over the file in all.
  let nextEndstream = -1

  const result = (): PdfPageScan => ({
    bound: topMarkers + streamEntries,
    objects: topObjects + streamEntries,
    markers: flags.markers,
  })

  /** A little of a Flate stream, inflated; null if it isn't valid Flate or the budget is spent. */
  const sniff = (start: number): Uint8Array | null => {
    let out: Uint8Array
    try {
      // 512 bytes of input reaches past any Huffman table a writer emits.
      out = inflateSync(bytes.subarray(start, Math.min(bytes.length, start + 512)), {
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
        maxOutputLength: 8 * 1024,
      })
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_BUFFER_TOO_LARGE') return null
      // Very compressible: 128 bytes of input inflate to at most 132KB.
      try {
        out = inflateSync(bytes.subarray(start, Math.min(bytes.length, start + 128)), {
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
          maxOutputLength: 140 * 1024,
        })
      } catch {
        return null
      }
    }
    sniffBudget -= out.byteLength
    return sniffBudget < 0 ? null : out
  }

  /** Inflate a whole stream, Flate inside Flate unwrapped; null if damaged or over budget. */
  const inflateAll = (start: number): Uint8Array | null => {
    if (++fullStreams > MAX_OBJECT_STREAMS) return null
    if (start < lastRegionEnd) return null
    if (nextEndstream < start) {
      nextEndstream = buf.indexOf('endstream', start, 'latin1')
      if (nextEndstream < 0) nextEndstream = bytes.length
    }
    lastRegionEnd = nextEndstream
    let data: Uint8Array = bytes.subarray(start, nextEndstream)
    for (let depth = 0; ; depth++) {
      if (depth >= MAX_FLATE_DEPTH || budget <= 0) return null
      try {
        // Data past the end of the stream is ignored, as pdf-lib ignores it.
        data = inflateSync(data, { maxOutputLength: budget })
      } catch {
        // Damaged, truncated, encrypted, or past the budget.
        return null
      }
      budget -= data.byteLength
      if (!isZlibHeader(data, 0)) return data
    }
  }

  /** Count what a stream whose data starts at `start` could add; false for "can't tell". */
  const readStream = (start: number): boolean => {
    if (!isZlibHeader(bytes, start)) {
      // Unfiltered: the header, if any, is right here in the file.
      const { ints, crossed } = headerInts(bytes, start, bytes.length, true)
      if (crossed) return false
      streamEntries += entries(ints)
      return true
    }
    if (++flateStreams > MAX_FLATE_STREAMS) return false
    const prefix = sniff(start)
    if (prefix === null) return false
    if (!isZlibHeader(prefix, 0)) {
      const seen = headerInts(prefix, 0, prefix.length)
      // The header ended in sight (or there's none): that's every entry.
      if (seen.ended) {
        streamEntries += entries(seen.ints)
        return true
      }
    }
    const data = inflateAll(start)
    if (data === null) return false
    streamEntries += entries(headerInts(data, 0, data.length).ints)
    readNames(data, flags, stopAbove)
    return true
  }

  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]
    if (c === SLASH) {
      const before = flags.markers
      // A name holds no keyword pdf-lib would act on; the next token starts
      // at its end (a name ends at the next `/`, so none is skipped).
      i = readName(bytes, i, flags) - 1
      if (flags.markers > before) topMarkers++
      if (flags.markers > stopAbove) return result()
      continue
    }
    if (c === 0x6f && matchesAt(bytes, i, OBJ) && !matchesAt(bytes, i - 3, END)) {
      topObjects++
      continue
    }
    if (c !== 0x73 || !matchesAt(bytes, i, STREAM) || matchesAt(bytes, i - 3, END)) continue
    // A stream may start here — or this is a `stream` in a string, a comment
    // or other data. Either way its bytes are judged, not its dictionary.
    if (!readStream(streamDataStart(bytes, i + STREAM.length))) return UNKNOWN
    if (flags.markers > stopAbove) return result()
    i += STREAM.length - 1
  }

  // A filter whose name lies somewhere else: it could be one this scan can't
  // read, hidden where the scan didn't look. Refused whatever else the file
  // holds — no writer needs it.
  if (flags.unresolvedFilter) return UNKNOWN
  // An object stream under a filter this scan can't read.
  if (flags.otherFilter && (flags.objStm || flags.typeRef)) return UNKNOWN
  return result()
}

export type PdfPageCheck = 'ok' | 'over' | 'unknown'

/**
 * Whether a PDF fits within `maxPages`. The scan's bound decides most files.
 * A bound over the cap is settled by loading the file with pdf-lib and
 * counting its page tree — when the scan has bounded that load's objects.
 */
export async function checkPdfPageLimit(bytes: Uint8Array, maxPages: number): Promise<PdfPageCheck> {
  const ceiling = maxPages * PAGE_SCAN_HEADROOM
  const scan = scanPdfPages(bytes, ceiling)
  if (scan === null) return 'unknown'
  if (scan.markers > ceiling) return 'over'
  if (scan.bound <= maxPages) return 'ok'
  if (scan.objects > LOAD_OBJECT_LIMIT) return scan.markers > maxPages ? 'over' : 'unknown'
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
