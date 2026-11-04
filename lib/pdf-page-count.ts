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
//
// This scan is a filter, not the bound. Every pdf-lib load of a member's file
// (the count here, the watermark) runs in lib/pdf-sandbox.ts, a worker thread
// with a heap limit and a timeout, so a file this scan misjudges costs that
// thread a few seconds and is refused — it can't stall or kill the server.

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
  /** A /Length that isn't a plain non-negative integer or a reference, or a signed /First. */
  badNumber: boolean
  /** The name /XRef seen, anywhere. */
  xref: boolean
  /** A /Size, /Index or /W whose value an xref stream would look up, or can't be read. */
  xrefUnresolved: boolean
  /** Every /Size, and every subsection length of every /Index, summed. */
  xrefEntries: number
  /** The largest sum of the first three widths of a /W written as numbers. */
  xrefWidths: number
  /** What /W and /Index reads may still cover (see numberArray). */
  readBudget: number
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

// ── Numbers pdf-lib moves or loops by ───────────────────────────────────────
//
// pdf-lib trusts a handful of numbers in a file to say where to read next or
// how many times to loop, and checks none of them:
//
//   - A stream's /Length. pdf-lib jumps to `start + Length` and, if
//     `endstream` is there, takes the stream as ending there. A negative
//     /Length jumps BACK — to an `endstream` in an earlier comment, say — and
//     the top-level parse resumes from there, reaches the same stream, and
//     jumps back again, forever, blocking the event loop. pdf-lib reads the
//     /Length only when it's a number written right there (a reference is not
//     followed: it finds the end by searching forward instead). So every
//     /Length must be a plain non-negative integer or a reference.
//   - An xref stream's /Size or /Index (how many entries) and /W (how many
//     bytes each field takes). pdf-lib loops entries × widths times, reading
//     past the end of the data without stopping, so `/W [1 2000000000 1]`
//     runs for minutes. pdf-lib follows references for all three. When a file
//     could hold an xref stream (it names /XRef, or a /Type is a reference),
//     every /Size, /Index and /W must be written out as numbers whose product
//     stays under XREF_WORK_LIMIT. (/W is also a CID font's widths array; one
//     that holds anything but numbers is no xref /W, since pdf-lib throws on
//     it, and one of numbers only counts.)
//   - An object stream's /First, added to every entry's offset. A signed one
//     is refused. Each entry is parsed once wherever it lands, so neither it
//     nor /N (the loop reading the header stops at the end of the data) can
//     loop; the cost of overlapping entries is LOAD_OBJECT_LIMIT's to bound.
//
// Nothing else pdf-lib reads moves it: it never seeks to an xref offset, a
// startxref or a /Prev (it parses the file front to back), so a /Prev chain
// that loops, or an offset past the end, is never followed.

/** The most xref entries (every /Size and /Index length, summed) a file that may hold an xref stream can claim. */
export const XREF_ENTRY_LIMIT = 1_000_000
/** The most field bytes (entries × widths) pdf-lib may be made to read for xref streams. */
export const XREF_WORK_LIMIT = 50_000_000

/**
 * The most bytes /W and /Index values may be read over, in total, for one
 * file. Honest arrays are a few dozen bytes (a CID font's /W stops at its
 * first nested array); a spent budget is "can't tell" in a file that may hold
 * an xref stream.
 */
export const NUMBER_ARRAY_BUDGET = 8 * 1024 * 1024

const PLUS = 0x2b
const MINUS = 0x2d
const DOT = 0x2e
const isSign = (c: number) => c === PLUS || c === MINUS || c === DOT

/**
 * Whether the value after a /Length is one pdf-lib can't be moved backwards
 * by: a plain non-negative integer (or a reference, `N G R`, which starts as
 * one). A sign, a fraction, a comment, a value past the window, or anything
 * that isn't a number is not.
 */
function plainLength(b: Uint8Array, nameStop: number): boolean {
  const v = skipWs(b, nameStop)
  if (v < 0 || !isDigit(b[v])) return false
  const stop = Math.min(b.length, v + VALUE_WINDOW)
  let j = v
  while (j < stop && isDigit(b[j])) j++
  // Digits running past the window: no writer emits a /Length that long.
  if (j === stop && j < b.length) return false
  return j >= b.length || !isSign(b[j])
}

/** Whether the value after a /First is a signed number (or a fraction). */
function signedFirst(b: Uint8Array, nameStop: number): boolean {
  const v = skipWs(b, nameStop)
  if (v < 0) return false
  if (isSign(b[v])) return true
  if (!isDigit(b[v])) return false
  const stop = Math.min(b.length, v + VALUE_WINDOW)
  let j = v
  while (j < stop && isDigit(b[j])) j++
  return j < b.length && isSign(b[j])
}

/**
 * The number pdf-lib would read at `at` — digits, signs and a point — as how
 * many times it would loop on it: a negative one loops never, a fraction one
 * more time. `end` is where it stops. Read in place, no allocation.
 */
function loopCount(b: Uint8Array, at: number): { count: number; end: number } {
  let j = at
  let negative = false
  while (j < b.length && (b[j] === PLUS || b[j] === MINUS)) {
    if (b[j] === MINUS) negative = true
    j++
  }
  let whole = 0
  while (j < b.length && isDigit(b[j])) {
    whole = Math.min(whole * 10 + (b[j] - 0x30), Number.MAX_SAFE_INTEGER)
    j++
  }
  let fraction = false
  if (j < b.length && b[j] === DOT) {
    j++
    while (j < b.length && isDigit(b[j])) {
      if (b[j] !== 0x30) fraction = true
      j++
    }
  }
  return { count: negative ? 0 : whole + (fraction ? 1 : 0), end: j }
}

/**
 * Whether `N G R` continues from `end`, the end of N — read exactly as
 * pdf-lib's parseNumberOrRef reads it: whitespace AND comments skipped before
 * G and before R (skipWhitespaceAndComments), G any number that starts with a
 * digit (`0.5` too). true: the value is a reference. false: it is the number N.
 * null: it can't be told — a run of whitespace past the window, the file
 * ending, or the read budget spent — and the caller must treat it as a
 * reference it can't see. Comment and digit bytes are charged to
 * `flags.readBudget`, as skipToValue charges them.
 *
 * Skipping only whitespace here (as before 3 Nov 2026) let `/W 5 %c\n0 R`
 * pass as the number 5 while pdf-lib followed it to `[1 2000000000 1]`.
 */
function refFollows(b: Uint8Array, end: number, flags: Flags): boolean | null {
  // Whitespace may run on, as pdf-lib lets it (a writer may pad a dictionary);
  // every byte passed is charged to the budget.
  let j = skipToValue(b, end, flags, b.length)
  if (j < 0) return null
  flags.readBudget -= j - end
  if (flags.readBudget < 0) return null
  if (!isDigit(b[j])) return false
  // G as parseRawNumber reads it: digits, signs and at most one point, then digits.
  const start = j
  while (j < b.length && isNumeric(b[j])) {
    if (b[j++] === DOT) break
  }
  while (j < b.length && isDigit(b[j])) j++
  j = skipToValue(b, j, flags, b.length)
  if (j < 0) return null
  flags.readBudget -= j - start
  if (flags.readBudget < 0) return null
  return b[j] === 0x52 /* R */
}

/**
 * The value after a /Size, as an xref stream would read it: a number, which
 * adds to `xrefEntries`, or a reference or a value the scan can't see, which
 * is unresolved. Anything else (a sampled function's `/Size [256]`) is no
 * number pdf-lib could loop on.
 */
function readSize(b: Uint8Array, nameStop: number, flags: Flags): void {
  // A comment before the value is "can't see" (stricter than pdf-lib, which
  // skips it; no writer puts one there).
  const v = skipWs(b, nameStop)
  if (v < 0 || b[v] === PERCENT) {
    flags.xrefUnresolved = true
    return
  }
  if (!isNumeric(b[v])) return
  const { count, end } = loopCount(b, v)
  if (refFollows(b, end, flags) !== false) flags.xrefUnresolved = true
  else flags.xrefEntries += count
}

/**
 * The first byte at or after `from` that isn't whitespace or a comment, as
 * pdf-lib skips them before a value; -1 when a run of whitespace passes the
 * window, the file ends, or the read budget is spent. Comment bytes are charged to
 * `flags.readBudget`: a comment can hold another name, whose read would cover
 * the same bytes again, and the budget keeps that linear.
 */
function skipToValue(b: Uint8Array, from: number, flags: Flags, window = VALUE_WINDOW): number {
  let j = from
  for (;;) {
    const v = skipWs(b, j, window)
    if (v < 0 || b[v] !== PERCENT) return v
    // Read no further than the budget allows, so a spent budget costs nothing.
    const stop = Math.min(b.length, v + Math.max(0, flags.readBudget) + 1)
    j = v
    while (j < stop && b[j] !== LF && b[j] !== CR) j++
    flags.readBudget -= j - v
    if (flags.readBudget < 0 || j >= b.length) return -1
  }
}

/**
 * An array after /Index or /W, read as an xref stream reads it: every element
 * must be a number, or pdf-lib throws and loops on nothing. Returns the
 * numbers' loop counts — the subsection lengths of an /Index (every second
 * number), the first three widths of a /W — summed; 0 when there's nothing
 * pdf-lib could loop on (not an array, a plain number, an array holding
 * something other than numbers); -1 when it can't be told (a reference, a
 * value that can't be seen, the read budget spent).
 *
 * `/W` is two bytes, so compressed data holds it often enough: only what
 * pdf-lib would really read as a reference or an array counts, comments are
 * skipped as pdf-lib skips them, and every byte read is charged to
 * `flags.readBudget`, which no honest file comes near.
 */
function numberArray(b: Uint8Array, nameStop: number, kind: 'index' | 'widths', flags: Flags): number {
  const v = skipToValue(b, nameStop, flags)
  if (v < 0) return -1
  if (b[v] !== LBRACKET) {
    if (!isNumeric(b[v])) return 0
    // A number is no array; `N G R` may be a reference to one.
    return refFollows(b, loopCount(b, v).end, flags) !== false ? -1 : 0
  }
  let j = v + 1
  let sum = 0
  for (let k = 0; ; k++) {
    const at = j
    // Inside the array whitespace may run on (it's charged to the budget).
    j = skipToValue(b, j, flags, b.length)
    if (j < 0) return -1
    const c = b[j]
    if (c === RBRACKET) return sum
    if (c === 0x52 /* R */) return -1
    if (!isNumeric(c)) return 0
    const { count, end } = loopCount(b, j)
    if (kind === 'index' ? k % 2 === 1 : k < 3) sum = Math.min(sum + count, Number.MAX_SAFE_INTEGER)
    j = end
    flags.readBudget -= j - at
    if (flags.readBudget < 0) return -1
  }
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
  } else if ((first === 0x4c || escaped) && nameIs(b, i + 1, end, 'Length')) {
    if (!plainLength(b, end)) flags.badNumber = true
  } else if ((first === 0x46 || escaped) && nameIs(b, i + 1, end, 'First')) {
    if (signedFirst(b, end)) flags.badNumber = true
  } else if ((first === 0x58 || escaped) && nameIs(b, i + 1, end, 'XRef')) {
    flags.xref = true
  } else if ((first === 0x53 || escaped) && nameIs(b, i + 1, end, 'Size')) {
    readSize(b, end, flags)
  } else if ((first === 0x49 || escaped) && nameIs(b, i + 1, end, 'Index')) {
    const lengths = numberArray(b, end, 'index', flags)
    if (lengths < 0) flags.xrefUnresolved = true
    else flags.xrefEntries += lengths
  } else if ((first === 0x57 || escaped) && nameIs(b, i + 1, end, 'W')) {
    const widths = numberArray(b, end, 'widths', flags)
    if (widths < 0) flags.xrefUnresolved = true
    else flags.xrefWidths = Math.max(flags.xrefWidths, widths)
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
  const flags: Flags = {
    markers: 0,
    objStm: false,
    typeRef: false,
    otherFilter: false,
    unresolvedFilter: false,
    badNumber: false,
    xref: false,
    xrefUnresolved: false,
    xrefEntries: 0,
    xrefWidths: 0,
    readBudget: NUMBER_ARRAY_BUDGET,
  }
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
  // A /Length that could send pdf-lib backwards (into a loop that never
  // ends), or a signed /First.
  if (flags.badNumber) return UNKNOWN
  // An xref stream pdf-lib could be made to loop on for minutes.
  if (flags.xref || flags.typeRef) {
    if (flags.xrefUnresolved || flags.xrefEntries > XREF_ENTRY_LIMIT) return UNKNOWN
    if (flags.xrefEntries * (flags.xrefWidths + 1) > XREF_WORK_LIMIT) return UNKNOWN
  }
  // An object stream under a filter this scan can't read.
  if (flags.otherFilter && (flags.objStm || flags.typeRef)) return UNKNOWN
  return result()
}

/**
 * 'failed': the sandbox had to stop pdf-lib on this file (it ran past the
 * timeout or the heap limit, or the worker died). Refused like 'unknown', with
 * PDF_UNPROCESSABLE.
 */
export type PdfPageCheck = 'ok' | 'over' | 'unknown' | 'failed'

/** Shown when the sandbox (lib/pdf-sandbox.ts) had to stop pdf-lib on a file. */
export const PDF_UNPROCESSABLE =
  'We couldn’t process that PDF. Save it again as a PDF (Print › Save as PDF works) and upload that copy.'

/**
 * Whether a PDF fits within `maxPages`. The scan's bound decides most files.
 * A bound over the cap is settled by loading the file with pdf-lib and
 * counting its page tree — when the scan has bounded that load's objects, and
 * always in the sandbox (lib/pdf-sandbox.ts): pdf-lib never runs on a member's
 * bytes on the main thread.
 */
export async function checkPdfPageLimit(bytes: Uint8Array, maxPages: number): Promise<PdfPageCheck> {
  const ceiling = maxPages * PAGE_SCAN_HEADROOM
  const scan = scanPdfPages(bytes, ceiling)
  if (scan === null) return 'unknown'
  if (scan.markers > ceiling) return 'over'
  if (scan.bound <= maxPages) return 'ok'
  if (scan.objects > LOAD_OBJECT_LIMIT) return scan.markers > maxPages ? 'over' : 'unknown'
  const { countPdfPagesSandboxed } = await import('@/lib/pdf-sandbox')
  const counted = await countPdfPagesSandboxed(bytes, maxPages)
  if (!counted.ok) return counted.reason === 'invalid' ? 'unknown' : 'failed'
  if (counted.value === null) return 'unknown'
  return counted.value > maxPages ? 'over' : 'ok'
}
