// What an uploaded file actually is, read from its bytes — never from its name
// or the type the browser declared, both of which the uploader picks.
//
// claimUpload (lib/uploads.ts) runs this on every stored object: each upload
// purpose lists the formats it accepts, and anything that sniffs as something
// else — or as nothing — is deleted and refused. Formats are recognised by
// signature AND structure, so there is no "unknown but probably fine":
//
//   - Executables and scripts (MZ, ELF, Mach-O, `#!`) and markup at the start of
//     the file are refused before any format is tried (`denied`).
//   - Formats whose signature is short or sits at an offset (MP4's `ftyp`, DWG,
//     binary STL, a bare MP3/AAC frame) must also carry no HTML/SVG tag in their
//     first few KB, so a page can't ride in behind four plausible bytes.
//   - A zip is only a document when it is one (OOXML, OpenDocument, iWork), and a
//     Compound File is never an installer (MSI/MSP/MST) or a macro document.
//
// The file's name is checked separately (nameMatchesFormat): a real PDF called
// `x.html` is still refused, because the name decides what opens it. Names are
// an allow-list too — an extension no format lists is refused, since an
// unfamiliar one (`.msix`, `.rdp`) can still install or run when opened.

export type FileFormat =
  | 'pdf'
  | 'png'
  | 'jpeg'
  | 'gif'
  | 'webp'
  | 'bmp'
  | 'tiff'
  /** Photoshop PSD/PSB. */
  | 'psd'
  /** HEIC/HEIF/AVIF stills: ISO-BMFF carrying an image brand. */
  | 'heif'
  /** ISO-BMFF and QuickTime with a known brand: MP4, MOV, M4V, M4A, 3GP. */
  | 'mp4'
  /** Matroska: WebM, MKV. */
  | 'webm'
  | 'avi'
  /** Windows Media: WMV, WMA. */
  | 'asf'
  | 'mp3'
  /** AAC in an ADTS stream. M4A is mp4. */
  | 'aac'
  | 'wav'
  | 'ogg'
  | 'flac'
  /**
   * Word, Excel and PowerPoint 2007+ (DOCX, XLSX, PPTX), without macros — or
   * password-protected, which Office opens only as a macro-free file.
   */
  | 'ooxml'
  /** OpenDocument: ODT, ODS, ODP, ODG. */
  | 'odf'
  /** Keynote, Pages, Numbers. */
  | 'iwork'
  /** Any other zip archive — including a macro-enabled Office file. */
  | 'zip'
  /** Compound File: legacy Office DOC, XLS, PPT. Never an installer, never with macros. */
  | 'ole2'
  | 'rar'
  | '7z'
  | 'dwg'
  /** Binary STL. ASCII STL is text. */
  | 'stl'
  /** SketchUp model. */
  | 'skp'
  /** Plain text that is not markup: TXT, CSV, DXF, STEP, ASCII STL. */
  | 'text'
  /**
   * An iCalendar file. Text, except that Outlook and Teams put an HTML copy of
   * the description in X-ALT-DESC; it is only ever opened as a calendar.
   */
  | 'calendar'

const bytesOf = (s: string) => [...s].map((c) => c.charCodeAt(0))

function startsWith(b: Uint8Array, sig: readonly number[], at = 0): boolean {
  if (b.length < at + sig.length) return false
  return sig.every((v, i) => b[at + i] === v)
}

const fourCC = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b)
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength)

// ── Markup ──────────────────────────────────────────────────────────────────

// A tag a browser would act on, anywhere — or markup at the very start. Text
// opened by a lenient viewer, or served under a wrong type, must not be able to
// carry a page or a script.
const MARKUP_START = /^\s*<[a-z!?/]/i
const MARKUP_TAG =
  /<(?:!doctype|\?xml|!\[cdata\[|!--|\/?\s*(?:html|head|body|script|style|iframe|frame|frameset|object|embed|applet|svg|math|meta|link|base|form|img|template|xml)[\s/>])/i

// In binary data only the tags that make a page are looked for. An XML
// declaration or comment is ordinary in a camera's embedded metadata (Sony
// XAVC writes one into the MP4 header); a page needs one of these.
const PAGE_TAG =
  /<\/?\s*(?:html|head|body|script|style|iframe|frame|frameset|object|embed|applet|svg|math|meta|link|base|form|img|template)[\s/>]/i

/** How far into a weakly-signed binary format to look for a smuggled tag. */
const MARKUP_SCAN = 4096

const carriesMarkup = (b: Uint8Array) => PAGE_TAG.test(latin1(b.subarray(0, MARKUP_SCAN)))

// ── Refused outright ────────────────────────────────────────────────────────

// Tab, LF, VT, FF, CR, and SUB/ESC, which old CSV and DXF exporters leave in.
const TEXT_CONTROLS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1a, 0x1b])

function controlFree(codes: Iterable<number>): boolean {
  for (const c of codes) if (c < 0x20 && !TEXT_CONTROLS.has(c)) return false
  return true
}

const EXECUTABLE_MAGIC: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32, little-endian
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64, little-endian
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal / Java class
  bytesOf('#!'), // a script with an interpreter line
]

/** An executable, a script, or markup — whatever else its bytes might pass for. */
function denied(b: Uint8Array): boolean {
  if (EXECUTABLE_MAGIC.some((sig) => startsWith(b, sig))) return true
  // A Windows/DOS executable. Its header is binary; a CSV starting "MZ Robotics,"
  // is not one.
  if (startsWith(b, bytesOf('MZ')) && !controlFree(b.subarray(0, 64))) return true
  const start = startsWith(b, [0xef, 0xbb, 0xbf]) ? 3 : 0
  return MARKUP_START.test(latin1(b.subarray(start, start + 256)))
}

// ── Fixed signatures ────────────────────────────────────────────────────────

const SIGNATURES: readonly [FileFormat, readonly number[]][] = [
  ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['jpeg', [0xff, 0xd8, 0xff]],
  ['gif', bytesOf('GIF87a')],
  ['gif', bytesOf('GIF89a')],
  ['webm', [0x1a, 0x45, 0xdf, 0xa3]],
  ['rar', bytesOf('Rar!\x1a\x07')],
  ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
  ['asf', [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c]],
  ['ogg', [...bytesOf('OggS'), 0x00]],
  // "SketchUp Model" in UTF-16, behind a marker that would otherwise read as a
  // UTF-16 byte-order mark.
  ['skp', [0xff, 0xfe, 0xff, 0x0e, ...[...'SketchUp'].flatMap((c) => [c.charCodeAt(0), 0])]],
]

/**
 * `%PDF-` at the start, or within the first KB behind junk that is not markup —
 * Acrobat tolerates the junk, and some exporters and mail gateways leave it. A
 * displaced header must be a real one (`%PDF-1.7`) in a file that ends like a
 * PDF, so a CSV that merely mentions "%PDF-" stays text.
 */
function isPdf(b: Uint8Array): boolean {
  if (startsWith(b, bytesOf('%PDF-'))) return true
  const head = latin1(b.subarray(0, 1024))
  const at = head.search(/%PDF-\d\.\d/)
  if (at < 0) return false
  const junk = head.slice(0, at)
  if (MARKUP_START.test(junk) || MARKUP_TAG.test(junk)) return false
  return latin1(b.subarray(Math.max(0, b.length - 2048))).includes('%%EOF')
}

/** ID3v2: version 2–4, then a "syncsafe" size whose bytes never set the top bit. */
const isId3 = (b: Uint8Array) =>
  startsWith(b, bytesOf('ID3')) && b.length >= 10 && b[3] >= 2 && b[3] <= 4 && b[4] !== 0xff &&
  b[6] < 0x80 && b[7] < 0x80 && b[8] < 0x80 && b[9] < 0x80

/** TIFF: byte order, 42, then an offset to the first directory that fits the file. */
function isTiff(b: Uint8Array): boolean {
  if (b.length < 8) return false
  const little = startsWith(b, [0x49, 0x49, 0x2a, 0x00])
  if (!little && !startsWith(b, [0x4d, 0x4d, 0x00, 0x2a])) return false
  const ifd = view(b).getUint32(4, little)
  return ifd >= 8 && ifd < b.length
}

/** BMP: "BM", reserved zeros, and a DIB header of a size some version uses. */
function isBmp(b: Uint8Array): boolean {
  if (b.length < 18 || !startsWith(b, bytesOf('BM'))) return false
  const dv = view(b)
  return dv.getUint32(6, true) === 0 && [12, 40, 52, 56, 64, 108, 124].includes(dv.getUint32(14, true))
}

/** PSD/PSB: "8BPS", version 1 or 2, six reserved zero bytes. */
const isPsd = (b: Uint8Array) =>
  startsWith(b, bytesOf('8BPS')) && b.length >= 12 && b[4] === 0 && (b[5] === 1 || b[5] === 2) &&
  b.subarray(6, 12).every((v) => v === 0)

/** FLAC: "fLaC" then the mandatory 34-byte STREAMINFO block. */
const isFlac = (b: Uint8Array) =>
  startsWith(b, bytesOf('fLaC')) && b.length >= 8 && (b[4] & 0x7f) === 0 && b[5] === 0 && b[6] === 0 && b[7] === 34

function riff(b: Uint8Array): FileFormat | null {
  if (b.length < 12 || !startsWith(b, bytesOf('RIFF'))) return null
  const kind = fourCC(b, 8)
  return kind === 'WEBP' ? 'webp' : kind === 'WAVE' ? 'wav' : kind === 'AVI ' ? 'avi' : null
}

// ── ISO-BMFF (MP4, MOV, HEIC) ───────────────────────────────────────────────

// An `ftyp` box naming any of these is a still image, not a movie. HEIF requires
// mif1/msf1 among the compatible brands; the rest are the common major brands.
const HEIF_BRANDS = new Set(['mif1', 'msf1', 'heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'avif', 'avis'])
// Brands real cameras, phones, encoders and iTunes write. Any box name at offset
// 4 used to pass as a movie; now the `ftyp` box must name one of these.
const VIDEO_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1', 'avc3',
  'hvc1', 'hev1', 'dash', 'cmfc', 'cmf2', 'M4V ', 'M4VH', 'M4VP', 'M4A ', 'M4B ', 'M4P ', 'F4V ', 'F4P ',
  'qt  ', 'mmp4', 'MSNV', 'XAVC', 'NDAS', 'MPPI',
])
const isVideoBrand = (brand: string) => VIDEO_BRANDS.has(brand) || /^3g[2gp][0-9a-z]$/.test(brand)

function isoMedia(b: Uint8Array): FileFormat | null {
  if (b.length < 16 || fourCC(b, 4) !== 'ftyp') return null
  // size(4) 'ftyp'(4) major brand(4) minor version(4) compatible brands(4 each).
  // A real file always holds its whole first box.
  const size = view(b).getUint32(0)
  if (size < 16 || size > 1024 || size > b.length || size % 4 !== 0) return null
  const brands = [fourCC(b, 8)]
  for (let i = 16; i + 4 <= size; i += 4) brands.push(fourCC(b, i))
  if (brands.some((brand) => HEIF_BRANDS.has(brand))) return 'heif'
  return brands.some(isVideoBrand) ? 'mp4' : null
}

// ── Zip: documents, or just an archive ──────────────────────────────────────

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04]

/** Entry names from the central directory, or null when there isn't a readable one. */
function zipEntryNames(b: Uint8Array): string[] | null {
  const dv = view(b)
  const floor = Math.max(0, b.length - 22 - 0xffff)
  for (let i = b.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue
    const count = dv.getUint16(i + 10, true)
    const offset = dv.getUint32(i + 16, true)
    if (offset >= i) return null // zip64 or corrupt
    const names: string[] = []
    let p = offset
    for (let n = 0; n < count && p + 46 <= i; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break
      const nameLen = dv.getUint16(p + 28, true)
      names.push(latin1(b.subarray(p + 46, p + 46 + nameLen)))
      p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true)
    }
    return names
  }
  return null
}

/** The first entry's name and, when it is stored uncompressed, its opening bytes. */
function firstZipEntry(b: Uint8Array): { name: string; head: string } | null {
  if (b.length < 30) return null
  const dv = view(b)
  const nameLen = dv.getUint16(26, true)
  const dataAt = 30 + nameLen + dv.getUint16(28, true)
  const stored = dv.getUint16(8, true) === 0
  return {
    name: latin1(b.subarray(30, 30 + nameLen)),
    head: stored ? latin1(b.subarray(dataAt, dataAt + 80)) : '',
  }
}

function zipKind(b: Uint8Array): FileFormat {
  const first = firstZipEntry(b)
  // ODF and EPUB put an uncompressed `mimetype` entry first, by specification.
  if (first?.name === 'mimetype' && first.head.startsWith('application/vnd.oasis.opendocument.')) return 'odf'
  const names = zipEntryNames(b) ?? (first ? [first.name] : [])
  if (names.includes('[Content_Types].xml')) {
    // DOCM/XLSM/PPTM carry a VBA project: an archive at best, never a document.
    return names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n)) ? 'zip' : 'ooxml'
  }
  if (names.some((n) => /^Index\/.+\.iwa$/.test(n) || n === 'index.apxl' || n === 'index.apxl.gz')) return 'iwork'
  return 'zip'
}

// ── Compound File (legacy Office) ───────────────────────────────────────────

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
const END_OF_CHAIN = 0xfffffffe

type CfbEntry = { name: string; type: number; start: number; size: number; clsid: Uint8Array }

const u32s = (b: Uint8Array) => {
  const dv = view(b)
  return Array.from({ length: b.length >> 2 }, (_, i) => dv.getUint32(i * 4, true))
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/**
 * A Compound File's directory, and a reader for its streams — or null when it
 * isn't one Office could open. Every directory slot is read, whatever the tree
 * links say, so a storage can't be hidden by unlinking it.
 */
function readCompoundFile(b: Uint8Array): { entries: CfbEntry[]; read(e: CfbEntry): Uint8Array | null } | null {
  if (b.length < 512) return null
  const dv = view(b)
  const shift = dv.getUint16(0x1e, true)
  if ((shift !== 9 && shift !== 12) || dv.getUint16(0x20, true) !== 6) return null
  const size = 2 ** shift
  const sectors = Math.ceil(b.length / size) - 1
  const sector = (n: number) => (n < sectors ? b.subarray((n + 1) * size, (n + 2) * size) : null)

  // The FAT: its first 109 sector numbers are in the header, the rest in a DIFAT chain.
  const fatCount = dv.getUint32(0x2c, true)
  if (fatCount > sectors) return null
  const fatSectors: number[] = []
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) fatSectors.push(dv.getUint32(0x4c + 4 * i, true))
  for (let next = dv.getUint32(0x44, true), hops = 0; fatSectors.length < fatCount; hops++) {
    const s = sector(next)
    if (!s || hops > sectors) return null
    const ids = u32s(s)
    fatSectors.push(...ids.slice(0, Math.min(ids.length - 1, fatCount - fatSectors.length)))
    next = ids[ids.length - 1]
  }
  const fat: number[] = []
  for (const n of fatSectors) {
    const s = sector(n)
    if (!s) return null
    fat.push(...u32s(s))
  }

  // Every chain followed below draws on one budget: the sectors the file has.
  // A real file keeps each sector in one chain at most, so the directory, the
  // mini stream and the streams checked for macros never need more. A crafted
  // one can point thousands of entries at one long chain — following it once per
  // entry took minutes on 25MB — or loop a chain; both run the budget out and
  // are refused, in time linear in the file's size.
  type Budget = { left: number }
  const chain = (start: number, table: number[], budget: Budget): number[] | null => {
    const ids: number[] = []
    for (let n = start; n !== END_OF_CHAIN; n = table[n]) {
      if (!(n < table.length) || budget.left <= 0) return null // off the table, a loop, or a shared chain
      budget.left--
      ids.push(n)
    }
    return ids
  }
  const sectorBudget: Budget = { left: sectors }
  const readChain = (start: number, length?: number): Uint8Array | null => {
    if (length === 0) return new Uint8Array(0)
    const parts = chain(start, fat, sectorBudget)?.map(sector)
    if (!parts || parts.some((p) => !p)) return null
    const all = concat(parts as Uint8Array[])
    if (length === undefined) return all
    return all.length >= length ? all.subarray(0, length) : null
  }

  const dir = readChain(dv.getUint32(0x30, true))
  if (!dir || dir.length < 128 || dir[0x42] !== 5) return null // the first entry is the root storage
  const dirView = view(dir)
  const entries: CfbEntry[] = []
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const type = dir[at + 0x42] // 1 storage, 2 stream, 5 root
    if (type !== 1 && type !== 2 && type !== 5) continue
    // Kept even with a bad name length, so entries[0] is always the root.
    const nameLength = dirView.getUint16(at + 0x40, true)
    entries.push({
      name: nameLength >= 2 && nameLength <= 64 ? new TextDecoder('utf-16le').decode(dir.subarray(at, at + nameLength - 2)) : '',
      type,
      start: dirView.getUint32(at + 0x74, true),
      size: dirView.getUint32(at + 0x78, true),
      clsid: dir.subarray(at + 0x50, at + 0x60),
    })
  }

  // Streams under the cutoff (4096 bytes) live in 64-byte sectors of the mini
  // stream, which is the root entry's own data.
  const cutoff = dv.getUint32(0x38, true)
  let mini: { data: Uint8Array; fat: number[]; budget: Budget } | null | undefined
  const read = (e: CfbEntry): Uint8Array | null => {
    if (e.size === 0) return new Uint8Array(0)
    if (e.size >= cutoff) return readChain(e.start, e.size)
    if (mini === undefined) {
      const data = readChain(entries[0].start, entries[0].size)
      const table = readChain(dv.getUint32(0x3c, true))
      // Likewise one budget for the mini stream: the 64-byte sectors it holds.
      mini = data && table ? { data, fat: u32s(table), budget: { left: data.length >> 6 } } : null
    }
    const ids = mini && chain(e.start, mini.fat, mini.budget)
    if (!mini || !ids || ids.some((n) => (n + 1) * 64 > mini!.data.length)) return null
    const out = concat(ids.map((n) => mini!.data.subarray(n * 64, (n + 1) * 64)))
    return out.length >= e.size ? out.subarray(0, e.size) : null
  }
  return { entries, read }
}

// Where Word and Excel keep a VBA project (PowerPoint keeps it inside its
// document stream; see pptHasVba).
const VBA_STORAGES = new Set(['macros', 'vba', '_vba_project', '_vba_project_cur'])

/**
 * An Excel 97–2003 workbook stream that lists an Excel 4.0 macro sheet or a VBA
 * module sheet. The sheet list (BOUNDSHEET records) is in the workbook globals,
 * which end at the first EOF record. In a workbook encrypted to open, the sheet
 * type is encrypted too and can't be read here; Excel 4.0 macros in files from
 * the internet are blocked by Office's own default.
 */
function hasMacroSheet(s: Uint8Array): boolean {
  const dv = view(s)
  for (let at = 0; at + 4 <= s.length; at += 4 + dv.getUint16(at + 2, true)) {
    const type = dv.getUint16(at, true)
    if (type === 0x000a || type === 0x002f) return false // EOF, or FILEPASS (encrypted from here on)
    if (type === 0x0085 && at + 10 <= s.length && (s[at + 9] === 0x01 || s[at + 9] === 0x06)) return true
  }
  return false
}

// A PowerPoint 97–2003 VBAInfoContainer holding its VBAInfoAtom: present when
// the presentation has a VBA project, with fHasMacros (4 bytes on) set to 1.
const PPT_VBA_INFO = [0x0f, 0x00, 0xff, 0x03, 0x14, 0, 0, 0, 0x02, 0x00, 0x00, 0x04, 0x0c, 0, 0, 0]

function pptHasVba(s: Uint8Array): boolean {
  for (let at = s.indexOf(0x0f); at >= 0 && at + 24 <= s.length; at = s.indexOf(0x0f, at + 1)) {
    if (startsWith(s, PPT_VBA_INFO, at) && view(s).getUint32(at + 20, true) === 1) return true
  }
  return false
}

/**
 * What a Compound File is: legacy Office ('ole2'), or a password-protected
 * DOCX/XLSX/PPTX, which Office stores as one ('ooxml'). Null for a Windows
 * Installer package, patch or transform ({000C108x-0000-0000-C000-000000000046}),
 * which runs when opened; for a document with a VBA project or an Excel 4.0
 * macro sheet; and for a file whose structure can't be read.
 */
function compoundFileKind(b: Uint8Array): FileFormat | null {
  const cfb = readCompoundFile(b)
  if (!cfb) return null
  const clsid = cfb.entries[0].clsid
  const installer =
    (clsid[0] & 0xf0) === 0x80 && clsid[1] === 0x10 && clsid[2] === 0x0c && clsid[3] === 0x00 &&
    startsWith(clsid, [0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46], 4)
  if (installer) return null
  const names = new Set(cfb.entries.map((e) => e.name.toLowerCase()))
  if ([...names].some((n) => VBA_STORAGES.has(n))) return null
  for (const e of cfb.entries) {
    const name = e.name.toLowerCase()
    const check = name === 'workbook' || name === 'book' ? hasMacroSheet : name === 'powerpoint document' ? pptHasVba : null
    if (e.type !== 2 || !check) continue
    const s = cfb.read(e)
    if (!s || check(s)) return null
  }
  return names.has('encryptioninfo') && names.has('encryptedpackage') ? 'ooxml' : 'ole2'
}

// ── CAD ─────────────────────────────────────────────────────────────────────

/** DWG: a release AC1012 (R13) through AC1032 (2018+), then five zero bytes. */
const DWG_VERSIONS = new Set(['AC1012', 'AC1014', 'AC1015', 'AC1018', 'AC1021', 'AC1024', 'AC1027', 'AC1032'])
const isDwg = (b: Uint8Array) =>
  b.length >= 11 && DWG_VERSIONS.has(latin1(b.subarray(0, 6))) && b.subarray(6, 11).every((v) => v === 0)

/** Binary STL: an 80-byte header, a triangle count, then exactly 50 bytes a triangle. */
function isBinaryStl(b: Uint8Array): boolean {
  if (b.length < 84 + 50) return false
  const triangles = view(b).getUint32(80, true)
  return triangles > 0 && b.length === 84 + 50 * triangles
}

// ── Audio frames with no container ──────────────────────────────────────────

/** An MPEG audio frame header with no ID3 tag in front. */
function mpegFrame(b: Uint8Array): boolean {
  if (b.length < 4 || b[0] !== 0xff || (b[1] & 0xe0) !== 0xe0) return false
  return ((b[1] >> 3) & 3) !== 1 && ((b[1] >> 1) & 3) !== 0 // not the reserved version / layer
}

/** An ADTS frame header: 12-bit sync, layer 0, a sampling index that exists. */
const adtsFrame = (b: Uint8Array) => b.length >= 7 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0 && ((b[2] >> 2) & 0xf) < 13

// ── Text ────────────────────────────────────────────────────────────────────

const CR = 0x0d
const LF = 0x0a
const SPACE = 0x20
const TAB = 0x09

/**
 * `b` with its folded lines joined (RFC 5545): every CRLF or bare LF followed by
 * one space or tab is dropped — exactly what replace(/\r?\n[ \t]/g, '') drops
 * from the decoded text, so decoding the result with the same decoder gives the
 * joined text. `unit` is the bytes per code unit: 1 for an 8-bit encoding, 2 for
 * UTF-16 in the byte order `littleEndian` names.
 *
 * Done on the bytes, into one array the input's size: the regex built a part
 * per fold, and a 25MB calendar of `x\r\n \n` took 0.7s and 400–500MB a claim.
 *
 * Each LF followed by a space or tab is a fold, and a CR just before it is part
 * of the fold too. That CR was always the last byte copied: a fold ends in a
 * space or a tab, so no earlier fold took it. With nothing folded — most files —
 * `b` itself comes back, read but not copied.
 */
export function unfoldLines(b: Uint8Array, unit: 1 | 2 = 1, littleEndian = true): Uint8Array {
  if (unit === 2) return unfoldUtf16(b, littleEndian)
  const length = b.length
  let i = 0
  for (; i < length; i++) {
    if (b[i] === LF) {
      const next = b[i + 1]
      if (next === SPACE || next === TAB) break
    }
  }
  if (i === length) return b
  const out = new Uint8Array(length)
  out.set(b.subarray(0, i))
  let n = i
  for (; i < length; i++) {
    const c = b[i]
    if (c === LF) {
      const next = b[i + 1]
      if (next === SPACE || next === TAB) {
        if (b[i - 1] === CR) n--
        i++ // past the space or tab
        continue
      }
    }
    out[n++] = c
  }
  return out.subarray(0, n)
}

/**
 * unfoldLines for UTF-16, a code unit (two bytes) at a time. A character must
 * have a zero high byte, so U+0A0D or U+200A is never read as a CR, LF or space.
 */
function unfoldUtf16(b: Uint8Array, littleEndian: boolean): Uint8Array {
  const lo = littleEndian ? 0 : 1
  const hi = 1 - lo
  const end = b.length - (b.length & 1) // whole units only
  // The character of the unit at byte `p`, or -1 for none or one above U+00FF.
  const at = (p: number) => (p >= 0 && p < end && b[p + hi] === 0 ? b[p + lo] : -1)
  const folds = (p: number) => at(p) === LF && (at(p + 2) === SPACE || at(p + 2) === TAB)
  let p = 0
  while (p < end && !folds(p)) p += 2
  if (p >= end) return b
  const out = new Uint8Array(b.length)
  out.set(b.subarray(0, p))
  let n = p
  for (; p < end; p += 2) {
    if (folds(p)) {
      if (at(p - 2) === CR) n -= 2
      p += 2 // past the space or tab
      continue
    }
    out[n++] = b[p]
    out[n++] = b[p + 1]
  }
  if (end < b.length) out[n++] = b[end] // half a unit: kept, though valid UTF-16 never has one
  return out.subarray(0, n)
}

/**
 * Whether 8-bit text opens as /^\s*BEGIN:VCALENDAR\r?\n/i would find it once
 * decoded, read without decoding the rest. Which bytes are leading space is
 * asked of the decoder itself, so this can't drift from what `\s` matches.
 */
const DECODES_TO_SPACE = Uint8Array.from({ length: 256 }, (_, i) => (/\s/.test(latin1(Uint8Array.of(i))) ? 1 : 0))
function opensAsCalendar(bytes: Uint8Array): boolean {
  let at = 0
  while (at < bytes.length && DECODES_TO_SPACE[bytes[at]]) at++
  return /^BEGIN:VCALENDAR\r?\n/i.test(latin1(bytes.subarray(at, at + 17)))
}

/**
 * A calendar may carry markup only in X-ALT-DESC, the HTML description Outlook
 * and Teams add. `unfolded` is the calendar with its folded lines joined (see
 * unfoldLines), so no tag spans a fold.
 *
 * Lines are read as split(/\r?\n/) would cut them, without splitting: 25MB of
 * bare newlines made millions of strings, about 1.8s and 600MB a claim. A tag
 * search over the whole file finds the next line that could hold one (the
 * search may run past a line end; the line check never does), that line alone
 * is read, and the search resumes after it, so no line is read twice.
 */
function calendarMarkupFree(unfolded: string): boolean {
  const search = new RegExp(MARKUP_TAG.source, 'gi')
  for (let found = search.exec(unfolded); found; found = search.exec(unfolded)) {
    const start = unfolded.lastIndexOf('\n', found.index) + 1
    const newline = unfolded.indexOf('\n', found.index)
    let end = newline === -1 ? unfolded.length : newline
    if (newline !== -1 && unfolded[end - 1] === '\r') end -= 1
    const line = unfolded.slice(start, end)
    if (!/^X-ALT-DESC[;:]/i.test(line) && MARKUP_TAG.test(line)) return false
    if (newline === -1) return true
    search.lastIndex = newline + 1
  }
  return true
}

/** Every byte of a text file is checked, not a sample: a tag can sit anywhere. */
function text(b: Uint8Array): FileFormat | null {
  let decoded: string
  if (startsWith(b, [0xff, 0xfe]) || startsWith(b, [0xfe, 0xff])) {
    // UTF-16, as Excel's "Unicode text" export writes it.
    const littleEndian = b[0] === 0xff
    const encoding = littleEndian ? 'utf-16le' : 'utf-16be'
    const body = b.subarray(2)
    try {
      decoded = new TextDecoder(encoding, { fatal: true }).decode(body)
    } catch {
      return null
    }
    for (let i = 0; i < decoded.length; i++) {
      const c = decoded.charCodeAt(i)
      if (c < 0x20 && !TEXT_CONTROLS.has(c)) return null
    }
    if (/^\s*BEGIN:VCALENDAR\r?\n/i.test(decoded)) {
      // Most calendars have no folds, and are judged as decoded: no copy of the
      // bytes and no second decode, which doubled their memory and time.
      if (!/\n[ \t]/.test(decoded)) return calendarMarkupFree(decoded) ? 'calendar' : null
      // Valid UTF-16 (it decoded), so dropping folds can't pair up a stray
      // surrogate. The decoder took a byte-order mark off the front of `body`,
      // so that one is dropped here too; one that only reaches the front once a
      // fold is dropped stays, as it did when the decoded text was joined.
      const mark = littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]
      const joined = unfoldLines(body.subarray(startsWith(body, mark) ? 2 : 0), 2, littleEndian)
      return calendarMarkupFree(new TextDecoder(encoding, { ignoreBOM: true }).decode(joined)) ? 'calendar' : null
    }
  } else {
    // Any 8-bit encoding: a Windows-1252 CSV is as legitimate as a UTF-8 one,
    // so this asks only "no binary control bytes", not "valid UTF-8".
    const bytes = b.subarray(startsWith(b, [0xef, 0xbb, 0xbf]) ? 3 : 0)
    if (bytes.length === 0 || !controlFree(bytes)) return null
    // One byte is one character in this decoder, so folds are joined on the
    // bytes and the calendar is decoded once, already joined.
    if (opensAsCalendar(bytes)) return calendarMarkupFree(latin1(unfoldLines(bytes))) ? 'calendar' : null
    decoded = latin1(bytes)
  }
  return MARKUP_START.test(decoded) || MARKUP_TAG.test(decoded) ? null : 'text'
}

// ── Sniffing ────────────────────────────────────────────────────────────────

/**
 * The format `bytes` really are, or null when they are none we accept anywhere.
 *
 * `accepted`, when given, is every format the caller takes, and a file that is
 * none of them may come back as null rather than as what it is: text is read
 * end to end (a tag can sit anywhere), so a caller that takes neither text nor
 * a calendar is spared reading 25MB to refuse it.
 */
export function sniffFileFormat(bytes: Uint8Array, accepted?: readonly FileFormat[]): FileFormat | null {
  if (bytes.length === 0 || denied(bytes)) return null

  for (const [format, sig] of SIGNATURES) if (startsWith(bytes, sig)) return format
  if (isPdf(bytes)) return 'pdf'
  if (startsWith(bytes, ZIP_LOCAL)) return zipKind(bytes)
  if (startsWith(bytes, OLE2)) return compoundFileKind(bytes)
  if (isId3(bytes)) return 'mp3'
  if (isTiff(bytes)) return 'tiff'
  if (isBmp(bytes)) return 'bmp'
  if (isPsd(bytes)) return 'psd'
  if (isFlac(bytes)) return 'flac'
  const contained = riff(bytes)
  if (contained) return contained

  // A HEIC/AVIF still keeps its metadata (XMP included) in the header, and its
  // brands are checked; it isn't scanned.
  const iso = isoMedia(bytes)
  if (iso === 'heif') return iso
  // Weak signatures: a few bytes, or bytes at an offset, that markup could sit
  // behind. Each must also be free of page tags in its opening bytes.
  const weak: FileFormat | null = iso ?? (isDwg(bytes) ? 'dwg' : null)
  if (weak) return carriesMarkup(bytes) ? null : weak

  // Text before the frame checks: a UTF-16 byte-order mark is also a frame sync,
  // so a file that opens with one is text or nothing — never an MP3 whose
  // "markup scan" read UTF-16 page tags as single bytes and saw none.
  const readsText = !accepted || accepted.includes('text') || accepted.includes('calendar')
  const plain = readsText ? text(bytes) : null
  if (plain) return plain
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return null

  const frame: FileFormat | null =
    mpegFrame(bytes) ? 'mp3' : adtsFrame(bytes) ? 'aac' : isBinaryStl(bytes) ? 'stl' : null
  if (!frame) return null
  // Text still wins over a frame when it was skipped above, but it is read
  // only if the caller takes this frame (no purpose does without text).
  if (!readsText && (!accepted?.includes(frame) || text(bytes))) return null
  return carriesMarkup(bytes) ? null : frame
}

// ── Names ───────────────────────────────────────────────────────────────────

/** The extensions a file of each format may carry. The first is the usual one. */
export const FORMAT_EXTENSIONS: Record<FileFormat, readonly string[]> = {
  pdf: ['pdf'],
  png: ['png'],
  jpeg: ['jpg', 'jpeg', 'jpe', 'jfif'],
  gif: ['gif'],
  webp: ['webp'],
  bmp: ['bmp', 'dib'],
  tiff: ['tif', 'tiff'],
  psd: ['psd', 'psb'],
  heif: ['heic', 'heif', 'hif', 'avif'],
  mp4: ['mp4', 'm4v', 'mov', 'qt', 'm4a', 'm4b', '3gp', '3g2'],
  webm: ['webm', 'mkv', 'mka'],
  avi: ['avi'],
  asf: ['wmv', 'wma', 'asf'],
  mp3: ['mp3'],
  aac: ['aac'],
  wav: ['wav'],
  ogg: ['ogg', 'oga', 'ogv', 'opus'],
  flac: ['flac'],
  ooxml: ['docx', 'xlsx', 'pptx', 'ppsx', 'dotx', 'xltx', 'potx'],
  odf: ['odt', 'ods', 'odp', 'odg', 'ott', 'ots', 'otp'],
  iwork: ['key', 'pages', 'numbers'],
  zip: ['zip', 'f3d', '3mf', 'sb3', 'sb2', 'ggb', 'kmz', 'epub'],
  ole2: ['doc', 'xls', 'ppt', 'pps', 'dot', 'xlt', 'pot'],
  rar: ['rar'],
  '7z': ['7z'],
  dwg: ['dwg'],
  stl: ['stl'],
  skp: ['skp'],
  text: [
    'txt', 'csv', 'tsv', 'dxf', 'step', 'stp', 'stl', 'obj', 'gcode', 'nc', 'md', 'json', 'ino', 'c', 'cpp',
    'h', 'hpp', 'srt', 'vtt', 'log',
  ],
  calendar: ['ics', 'ical', 'ifb'],
}

/**
 * Names the shared-file purposes (a space, a lesson, the Resources catalogue)
 * also take, by sniffed format: files whose bytes are one of these containers
 * but whose name belongs to the program that made them. An explicit list, not
 * "anything that isn't dangerous": add a name here when people need it.
 */
export const SHARED_EXTENSIONS: Partial<Record<FileFormat, readonly string[]>> = {
  pdf: ['ai'], // Illustrator saves a PDF
  // 3D printing (3MF), Visio and XPS are built on the Office package format.
  ooxml: ['3mf', 'vsdx', 'vstx', 'vssx', 'xps', 'oxps'],
  ole2: ['vsd', 'vss', 'vst', 'pub', 'sldprt', 'sldasm', 'slddrw', 'ipt', 'iam', 'idw'],
  zip: ['fcstd', 'aia', 'mcworld'],
  text: ['ipynb', 'scad', 'm', 'java', 'cs', 'r', 'sql', 'yaml', 'yml', 'toml', 'tex', 'bib', 'xyz', 'pdb', 'mol', 'sdf', 'ply'],
}

const IMAGE_FORMATS: ReadonlySet<FileFormat> = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heif'])
const IMAGE_EXTENSIONS = new Set([...IMAGE_FORMATS].flatMap((f) => FORMAT_EXTENSIONS[f]))

// Extensions a desktop or browser renders, runs or installs when the file is
// opened — pages, scripts, executables, installers and app packages, shortcuts
// and remote connections, disk images and macro documents. Refused for every
// purpose, whatever the bytes are: a downloaded `notes.html` or `sketch.py` runs
// on a double-click. (No format lists these, so none would pass anyway; listing
// them gets the uploader a clearer reason.)
const DANGEROUS_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'xht', 'shtml', 'mht', 'mhtml', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'hta',
  'js', 'mjs', 'cjs', 'jse', 'vb', 'vbs', 'vbe', 'wsf', 'wsh', 'wsc', 'sct', 'ps1', 'psm1', 'bat', 'cmd',
  'com', 'exe', 'msi', 'msp', 'mst', 'msc', 'scr', 'pif', 'cpl', 'dll', 'sys', 'ocx', 'lnk', 'url', 'scf',
  'reg', 'inf', 'chm', 'appref-ms', 'application', 'gadget', 'jar', 'jnlp', 'apk', 'ipa', 'app', 'dmg',
  'pkg', 'mpkg', 'iso', 'img', 'vhd', 'vhdx', 'command', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'desktop',
  'swf', 'xap', 'xbap', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'library-ms', 'settingcontent-ms',
  'searchconnector-ms', 'msix', 'msixbundle', 'appx', 'appxbundle', 'appinstaller', 'vsix', 'xpi', 'cab',
  'diagcab', 'msu', 'rdp', 'website', 'terminal', 'tool', 'py', 'pyw', 'pyz', 'pyzw', 'pyc', 'pyo', 'pl',
  'rb', 'ahk', 'au3', 'iqy', 'dqy', 'rqy', 'slk', 'xll', 'xla', 'ppa',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppsm', 'ppam', 'sldm', 'vsdm', 'vstm', 'vssm',
])

/** One character Windows drops from the end of a name: a dot or whitespace. */
const TRAILING_JUNK = /^[.\s]$/

/** A file name's extension, lower-cased, or '' when it has none. */
export function fileExtension(name: string): string {
  // Windows drops trailing dots and spaces when it saves a file, so `x.html.`
  // lands in Downloads as x.html: read the extension the saved file will have.
  // Trimmed one character at a time, never with /[.\s]+$/: V8 runs that in time
  // quadratic in a run of dots or spaces that isn't at the end (80,000 spaces
  // took 10 seconds), and names reach here from callers who haven't signed in.
  const base = name.slice(name.lastIndexOf('/') + 1)
  let end = base.length
  while (end > 0 && TRAILING_JUNK.test(base[end - 1])) end--
  const dot = base.lastIndexOf('.', end - 1)
  return dot > 0 ? base.slice(dot + 1, end).toLowerCase() : ''
}

/**
 * `name` in at most `max` characters, cut from the end of the stem so it keeps
 * its extension (one of up to 16 characters) as written: `… v1.2 … packet.pdf`
 * must not become `… v1.2 … pack`, an extension of `2 … pack`. The dots and
 * spaces Windows drops after an extension go with the cut, and the cut never
 * leaves half a surrogate pair.
 */
export function shortenFileName(name: string, max: number): string {
  if (name.length <= max) return name
  const ext = fileExtension(name)
  let end = name.length
  while (end > 0 && TRAILING_JUNK.test(name[end - 1])) end--
  const tail = ext && ext.length <= 16 ? name.slice(end - ext.length - 1, end) : ''
  let cut = max - tail.length
  const last = name.charCodeAt(cut - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut--
  return name.slice(0, cut) + tail
}

/** True for an extension that is never accepted, whatever the bytes are. */
export function isDangerousExtension(ext: string): boolean {
  return DANGEROUS_EXTENSIONS.has(ext.toLowerCase())
}

const extensionsOf = (format: FileFormat, strict: boolean): readonly string[] =>
  strict ? FORMAT_EXTENSIONS[format] : [...FORMAT_EXTENSIONS[format], ...(SHARED_EXTENSIONS[format] ?? [])]

/**
 * Whether a file called `name` may hold bytes of `format`. Never for a dangerous
 * extension. An image may carry any image extension (viewers read the bytes). A
 * name with no extension is allowed. Otherwise the extension must be one of the
 * format's — and, when `strict` is false, its SHARED_EXTENSIONS too (a notebook
 * `.ipynb` as text, a 3D print `.3mf` as an Office package).
 */
export function nameMatchesFormat(name: string, format: FileFormat, strict: boolean): boolean {
  const ext = fileExtension(name)
  if (!ext) return true
  if (isDangerousExtension(ext)) return false
  if (IMAGE_FORMATS.has(format) && IMAGE_EXTENSIONS.has(ext)) return true
  return extensionsOf(format, strict).includes(ext)
}

/** Every extension a file of one of `formats` may carry (see nameMatchesFormat). */
export function extensionsFor(formats: readonly FileFormat[], strict = true): Set<string> {
  const exts = new Set(formats.flatMap((f) => extensionsOf(f, strict)))
  if (formats.some((f) => IMAGE_FORMATS.has(f))) for (const e of IMAGE_EXTENSIONS) exts.add(e)
  return exts
}

// ── Types to serve under ────────────────────────────────────────────────────

const BY_EXTENSION: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  odt: 'application/vnd.oasis.opendocument.text',
  ott: 'application/vnd.oasis.opendocument.text-template',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ots: 'application/vnd.oasis.opendocument.spreadsheet-template',
  odp: 'application/vnd.oasis.opendocument.presentation',
  otp: 'application/vnd.oasis.opendocument.presentation-template',
  odg: 'application/vnd.oasis.opendocument.graphics',
  key: 'application/vnd.apple.keynote',
  pages: 'application/vnd.apple.pages',
  numbers: 'application/vnd.apple.numbers',
  doc: 'application/msword',
  dot: 'application/msword',
  xls: 'application/vnd.ms-excel',
  xlt: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint',
  pot: 'application/vnd.ms-powerpoint',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
}

const BY_FORMAT: Partial<Record<FileFormat, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  psd: 'image/vnd.adobe.photoshop',
  heif: 'image/heic',
  mp4: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  asf: 'video/x-ms-asf',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  dwg: 'image/vnd.dwg',
  stl: 'model/stl',
  skp: 'application/vnd.sketchup.skp',
  text: 'text/plain',
  calendar: 'text/calendar',
}

/**
 * The type to store or send a file under, from what it really is — never the
 * type the uploader declared. The name only picks between members of one format
 * (DOCX or XLSX, CSV or plain text), so it can't turn a document into a page.
 */
export function contentTypeFor(format: FileFormat, name = ''): string {
  const ext = fileExtension(name)
  if (BY_EXTENSION[ext] && FORMAT_EXTENSIONS[format].includes(ext)) return BY_EXTENSION[ext]
  return BY_FORMAT[format] ?? 'application/octet-stream'
}

// ── Declared types ──────────────────────────────────────────────────────────

// Types a browser runs rather than downloads or displays inertly. Storage serves
// an object under the type declared when it was PUT, so a real PDF stored as
// text/html is still a page on the storage origin.
const ACTIVE_TYPES = new Set([
  'text/html',
  'text/xml',
  'application/xml',
  'text/xsl',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
  'text/jscript',
  'text/x-component',
  'application/hta',
  'application/x-shockwave-flash',
  'multipart/x-mixed-replace',
])

/** True for a declared type a browser would render or execute (HTML, SVG, XML, script). */
export function isActiveContentType(type: string | null | undefined): boolean {
  const essence = (type ?? '').split(';')[0].trim().toLowerCase()
  return ACTIVE_TYPES.has(essence) || essence.endsWith('+xml')
}
