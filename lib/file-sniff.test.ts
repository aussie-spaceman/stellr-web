import { describe, it, expect, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import {
  FORMAT_EXTENSIONS,
  contentTypeFor,
  fileExtension,
  isActiveContentType,
  isDangerousExtension,
  nameMatchesFormat,
  shortenFileName,
  sniffFileFormat,
  unfoldLines,
  type FileFormat,
} from './file-sniff'
import {
  EXCEL_CLSID,
  FORMAT_SAMPLES,
  HOSTILE_SAMPLES,
  MSI_CLSID,
  OUTLOOK_ICS,
  PPT_CLSID,
  WORD_CLSID,
  bytes,
  compoundFile,
  encryptedOoxml,
  powerPointStream,
  sharedChainCompoundFile,
  threeMf,
  workbookStream,
  zipOf,
} from '@/test/file-fixtures'
import { expectWithin } from '@/test/time-budget'

const FORMATS = Object.keys(FORMAT_SAMPLES) as FileFormat[]

describe('sniffFileFormat — every accepted format', () => {
  it.each(FORMATS)('recognises %s', (format) => {
    expect(sniffFileFormat(FORMAT_SAMPLES[format])).toBe(format)
  })

  it('has a sample and an extension list for every format', () => {
    expect(Object.keys(FORMAT_EXTENSIONS).sort()).toEqual([...FORMATS].sort())
  })
})

// Each of these is refused by every upload purpose, whatever it is named.
describe('sniffFileFormat — hostile files are no format', () => {
  it.each(Object.entries(HOSTILE_SAMPLES))('refuses %s', (_name, sample) => {
    expect(sniffFileFormat(sample)).toBeNull()
  })

  it('refuses an empty file', () => {
    expect(sniffFileFormat(new Uint8Array())).toBeNull()
  })
})

// The adversarial review's bypasses of the first version, one by one. Each of
// these sniffed as a media or CAD format before the signatures were tightened.
describe('sniffFileFormat — weak signatures need structure', () => {
  it('needs an ftyp box naming a known brand, not any box name at offset 4', () => {
    expect(sniffFileFormat(bytes([0, 0, 0, 0x10], 'moov', 'AAAAAAAA'))).toBeNull()
    expect(sniffFileFormat(bytes([0, 0, 0, 0x10], 'ftyp', 'evil', [0, 0, 0, 0]))).toBeNull()
  })

  it('accepts the brands phones and cameras write', () => {
    const ftyp = (major: string) => bytes([0, 0, 0, 0x14], 'ftyp', major, [0, 0, 0, 0], major, [0, 0, 0, 8], 'free')
    expect(sniffFileFormat(ftyp('qt  '))).toBe('mp4') // iPhone .mov
    expect(sniffFileFormat(ftyp('3gp5'))).toBe('mp4')
    expect(sniffFileFormat(ftyp('M4A '))).toBe('mp4')
    expect(sniffFileFormat(ftyp('avif'))).toBe('heif')
  })

  it('keeps a camera MP4 whose header carries an XML metadata block', () => {
    const sony = bytes(FORMAT_SAMPLES.mp4, [0, 0, 0, 0x60], 'meta', '<?xml version="1.0"?><NonRealTimeMeta><Duration value="12"/></NonRealTimeMeta>')
    expect(sniffFileFormat(sony)).toBe('mp4')
  })

  it('needs a known DWG release followed by zero bytes', () => {
    expect(sniffFileFormat(bytes('AC1015', [0, 0, 0, 0, 0, 0x06]))).toBe('dwg')
    expect(sniffFileFormat(bytes('AC1099', [0, 0, 0, 0, 0, 0x06]))).toBeNull()
    expect(sniffFileFormat(bytes('AC1015', 'xxxxx', [0]))).toBeNull()
  })

  it('needs a real ID3 header, not just the letters', () => {
    expect(sniffFileFormat(bytes('ID3', [0x03, 0, 0, 0x7f, 0x7f, 0x7f, 0x80]))).toBeNull()
  })

  it('refuses a binary STL with a page in its header', () => {
    const stl = Buffer.alloc(84 + 50)
    stl.write('solid model <script>alert(1)</script>', 0, 'latin1')
    stl.writeUInt32LE(1, 80)
    expect(sniffFileFormat(new Uint8Array(stl))).toBeNull()
  })

  it('refuses an ftyp box larger than the file that holds it', () => {
    expect(sniffFileFormat(bytes([0, 0, 0, 64], 'ftyp', 'isom', [0, 0, 0, 0], 'isom'))).toBeNull()
  })
})

// What phones, Office, Google and CAD tools actually write, beyond the minimal
// samples in test/file-fixtures.
describe('sniffFileFormat — real-world variants', () => {
  const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  const zeros = (n: number) => Array<number>(n).fill(0)

  it.each([
    ['a JPEG with an EXIF header (phone camera)', bytes([0xff, 0xd8, 0xff, 0xe1, 0, 0x10], 'Exif\0\0', zeros(8)), 'jpeg'],
    ['a PDF 1.4 (Word "Save as PDF")', bytes('%PDF-1.4\n%\xc7\xec\x8f\xa2\n'), 'pdf'],
    ['an iPhone HEIC photo', bytes(be32(24), 'ftypheic', zeros(4), 'mif1heic', zeros(8)), 'heif'],
    ['an AVIF still', bytes(be32(28), 'ftypavif', zeros(4), 'avifmif1miaf', zeros(8)), 'heif'],
    ['a QuickTime .mov from an iPhone', bytes(be32(20), 'ftypqt  ', [0, 0, 2, 0], 'qt  ', zeros(8)), 'mp4'],
    ['an M4A voice memo', bytes(be32(24), 'ftypM4A ', zeros(4), 'M4A isom', zeros(8)), 'mp4'],
    ['an MP3 with no ID3 tag', bytes([0xff, 0xfb, 0x90, 0x64], zeros(12)), 'mp3'],
    ['a CSV with a UTF-8 byte-order mark', bytes([0xef, 0xbb, 0xbf], 'Name,Grade\r\nAda,9\r\n'), 'text'],
    ['a STEP model', bytes("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"), 'text'],
    ['an ASCII STL', bytes('solid rover\n facet normal 0 0 1\n  outer loop\n'), 'text'],
    ['a text file that reads "free" at byte 4', bytes('The free shuttle leaves at 7:30.\n'), 'text'],
    ['a text file that reads "ftyp" at byte 4', bytes('See ftyp boxes in the MP4 spec.\n'), 'text'],
  ] as const)('%s', (_name, sample, format) => {
    expect(sniffFileFormat(sample)).toBe(format)
  })

  it('reads a binary STL whose header starts "solid" as STL, not text', () => {
    const stl = Buffer.alloc(84 + 50)
    stl.write('solid exported by a careless CAD tool', 0, 'latin1')
    stl.writeUInt32LE(1, 80)
    stl.writeFloatLE(1.5, 84)
    expect(sniffFileFormat(new Uint8Array(stl))).toBe('stl')
  })
})

// The whole of a text file is checked, so a tag can't hide past a sample.
describe('sniffFileFormat — markup anywhere in text', () => {
  it.each([
    ['an iframe deep in a CSV', `${'row,1\n'.repeat(200)}<iframe src=//evil.example>`],
    ['a comment opener', 'notes\n<!-- <script>alert(1)</script> -->'],
    ['a CDATA section', 'data <![CDATA[ x ]]>'],
    ['an uppercase tag', 'x\n<SCRIPT>alert(1)</SCRIPT>'],
    ['a closing body tag', 'x </body>'],
  ])('refuses %s', (_name, text) => {
    expect(sniffFileFormat(bytes(text))).toBeNull()
  })

  it('allows a less-than sign that is not markup', () => {
    expect(sniffFileFormat(bytes('score < 10 means retry; a<b and 3 <= 4\n'))).toBe('text')
  })
})

describe('sniffFileFormat — zip is a document only when it is one', () => {
  it('reads a macro-enabled Office file as an archive, never a document', () => {
    const docm = zipOf([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'word/vbaProject.bin' }])
    expect(sniffFileFormat(docm)).toBe('zip')
  })

  it('reads an EPUB or a jar as a plain archive', () => {
    expect(sniffFileFormat(zipOf([{ name: 'mimetype', data: 'application/epub+zip' }]))).toBe('zip')
    expect(sniffFileFormat(zipOf([{ name: 'META-INF/MANIFEST.MF' }, { name: 'Main.class' }]))).toBe('zip')
  })

  it('reads OOXML from the central directory, wherever [Content_Types].xml sits', () => {
    const late = zipOf([{ name: 'ppt/presentation.xml' }, { name: '[Content_Types].xml', data: '<Types/>' }])
    expect(sniffFileFormat(late)).toBe('ooxml')
  })

  it('reads an OpenDocument spreadsheet and a Pages file', () => {
    expect(sniffFileFormat(zipOf([{ name: 'mimetype', data: 'application/vnd.oasis.opendocument.spreadsheet' }]))).toBe('odf')
    expect(sniffFileFormat(zipOf([{ name: 'Index/Document.iwa' }]))).toBe('iwork')
  })
})

describe('sniffFileFormat — Compound Files', () => {
  it('refuses a Windows Installer patch and transform as well as a package', () => {
    const family = (low: number) => compoundFile([low, 0x10, 0x0c, 0x00, 0, 0, 0, 0, 0xc0, 0, 0, 0, 0, 0, 0, 0x46])
    expect(sniffFileFormat(family(0x84))).toBeNull() // .msi
    expect(sniffFileFormat(family(0x86))).toBeNull() // .msp
    expect(sniffFileFormat(family(0x82))).toBeNull() // .mst
  })

  it('refuses a truncated Compound File header', () => {
    expect(sniffFileFormat(FORMAT_SAMPLES.ole2.subarray(0, 64))).toBeNull()
  })

  // Macro documents are in HOSTILE_SAMPLES; these are their macro-free twins.
  it('reads legacy Word, Excel and PowerPoint files without macros as Office documents', () => {
    expect(sniffFileFormat(compoundFile(WORD_CLSID, [{ name: 'WordDocument', data: Buffer.alloc(4096) }, { name: '1Table', data: Buffer.alloc(600) }]))).toBe('ole2')
    expect(sniffFileFormat(compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0) }]))).toBe('ole2')
    expect(sniffFileFormat(compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0, 6000) }]))).toBe('ole2')
    expect(sniffFileFormat(compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(2) }]))).toBe('ole2') // a chart sheet
    expect(sniffFileFormat(compoundFile(PPT_CLSID, [{ name: 'PowerPoint Document', data: powerPointStream(false) }]))).toBe('ole2')
  })

  it('reads a password-protected DOCX, XLSX or PPTX as an Office package', () => {
    expect(sniffFileFormat(encryptedOoxml())).toBe('ooxml')
  })

  it('reads the installer class from the root entry, whatever its name length says', () => {
    const msi = Buffer.from(compoundFile(MSI_CLSID, [{ name: 'SummaryInformation', data: Buffer.alloc(64) }]))
    const root = (msi.readUInt32LE(0x30) + 1) * 512
    msi.writeUInt16LE(0, root + 0x40)
    expect(sniffFileFormat(new Uint8Array(msi))).toBeNull()
  })

  it('finds a VBA storage the directory tree no longer links to', () => {
    const doc = Buffer.from(compoundFile(WORD_CLSID, [{ name: 'Macros', storage: true }]))
    const root = (doc.readUInt32LE(0x30) + 1) * 512
    doc.writeUInt32LE(0xffffffff, root + 0x4c) // the root's child: none
    expect(sniffFileFormat(new Uint8Array(doc))).toBeNull()
  })

  it('refuses a Compound File whose sector chain loops or runs off the file', () => {
    const doc = Buffer.from(compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0, 6000) }]))
    const start = doc.readUInt32LE(0x30)
    doc.writeUInt32LE(start, 512 + start * 4) // the directory's sector points back at itself
    expect(sniffFileFormat(new Uint8Array(doc))).toBeNull()
    const cut = compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0, 6000) }])
    expect(sniffFileFormat(cut.subarray(0, 2048))).toBeNull()
  })

  // Each "Workbook" stream is read to look for a macro sheet. Following the
  // shared chain once per entry was quadratic: 1.2MB took 0.6s, and a member's
  // 25MB upload would have run for minutes. Now no file reads more sectors than
  // it has, so this one is refused in milliseconds.
  it('refuses, in linear time, thousands of streams sharing one chain', () => {
    const sample = sharedChainCompoundFile(16384, 8192) // about 6MB
    const started = performance.now()
    expect(sniffFileFormat(sample)).toBeNull()
    expectWithin(started, 500)
  })

  it('holds streams in the mini stream to the same budget', () => {
    const small = Array.from({ length: 200 }, () => ({ name: 'Workbook', data: workbookStream(0, 64) }))
    const doc = Buffer.from(compoundFile(EXCEL_CLSID, [{ name: 'Workbook', data: workbookStream(0, 4000) }, ...small]))
    expect(sniffFileFormat(new Uint8Array(doc))).toBe('ole2')
    // Point every small stream at the big one's 63-sector chain.
    const dir = (doc.readUInt32LE(0x30) + 1) * 512
    const big = doc.readUInt32LE(dir + 128 + 0x74)
    for (let i = 2; i <= small.length + 1; i++) doc.writeUInt32LE(big, dir + i * 128 + 0x74)
    expect(sniffFileFormat(new Uint8Array(doc))).toBeNull()
  })

  it('still reads a workbook whose streams share no sectors', () => {
    expect(sniffFileFormat(sharedChainCompoundFile(2, 8))).toBe('ole2') // the root and one Workbook
    expect(sniffFileFormat(sharedChainCompoundFile(3, 8))).toBeNull() // two Workbooks, one chain
  })
})

describe('sniffFileFormat — PDFs and text', () => {
  it('accepts a PDF with junk before the header, as Acrobat does', () => {
    expect(sniffFileFormat(bytes([0, 0, 0, 0], '\r\n%PDF-1.4\n1 0 obj\n%%EOF\n'))).toBe('pdf')
  })

  it('keeps a CSV that merely mentions %PDF- as text', () => {
    expect(sniffFileFormat(bytes('format,header\npdf,%PDF-1.7\n'))).toBe('text')
  })

  it('reads Windows-1252 and UTF-16 CSVs and DXF as text, and ICS as a calendar', () => {
    expect(sniffFileFormat(bytes('name,city\nZo\xeb,M\xfcnster\n'))).toBe('text') // Windows-1252
    expect(sniffFileFormat(new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\tb\r\n1\t2\r\n', 'utf16le')])))).toBe('text')
    expect(sniffFileFormat(bytes('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'))).toBe('calendar')
    expect(sniffFileFormat(bytes('  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n'))).toBe('text')
  })

  // Outlook and Teams put an HTML copy of the description in X-ALT-DESC; the
  // file is only ever opened as a calendar, served as text/calendar.
  it('reads a calendar Outlook saved, HTML description and all', () => {
    expect(sniffFileFormat(OUTLOOK_ICS)).toBe('calendar')
  })

  it('takes markup in a calendar only in X-ALT-DESC', () => {
    const ics = (line: string) => bytes(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${line}\r\nEND:VCALENDAR\r\n`)
    expect(sniffFileFormat(ics('X-ALT-DESC;FMTTYPE=text/html:<html><body><p>Hi</p></body></html>'))).toBe('calendar')
    expect(sniffFileFormat(ics('DESCRIPTION:<html><body><p>Hi</p></body></html>'))).toBeNull()
    expect(sniffFileFormat(ics('X-ALT-DESC;FMTTYPE=text/html:<p>Hi</p>\r\nLOCATION:<iframe src=//evil.example>'))).toBeNull()
    // Text, not a calendar, when it isn't one from the first line.
    expect(sniffFileFormat(bytes('Notes\r\nX-ALT-DESC:<html><script>alert(1)</script></html>\r\n'))).toBeNull()
  })

  // RFC 5545 folds a long line by starting the next with a space or tab, and a
  // calendar app joins them before reading. A tag split across a fold is whole
  // again by then, so the check joins them first: each half here is clean alone.
  it('joins folded lines before looking for a tag', () => {
    const ics = (lines: string) => bytes(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${lines}\r\nEND:VCALENDAR\r\n`)
    expect(sniffFileFormat(ics('DESCRIPTION:<scr'))).toBe('calendar')
    expect(sniffFileFormat(ics('DESCRIPTION:Bring a\r\n ipt src=x>'))).toBe('calendar')
    expect(sniffFileFormat(ics('DESCRIPTION:<scr\r\n ipt src=x>'))).toBeNull()
    expect(sniffFileFormat(ics('DESCRIPTION:<scr\r\n\tipt src=x>'))).toBeNull()
    expect(sniffFileFormat(ics('DESCRIPTION:<scr\n ipt src=x>'))).toBeNull()
    expect(sniffFileFormat(ics('LOCATION:Hall B <i\r\n frame src=//evil.example>'))).toBeNull()
  })

  // The calendar check split the joined file into lines, so 25MB of bare
  // newlines made 25 million strings: 1.8s and 600MB for one claim. It now reads
  // only lines a tag search lands on, and must judge every calendar as the
  // split did.
  it('judges every calendar as splitting it into lines did', () => {
    const MARKUP_TAG =
      /<(?:!doctype|\?xml|!\[cdata\[|!--|\/?\s*(?:html|head|body|script|style|iframe|frame|frameset|object|embed|applet|svg|math|meta|link|base|form|img|template|xml)[\s/>])/i
    const before = (ics: string) =>
      ics
        .replace(/\r?\n[ \t]/g, '')
        .split(/\r?\n/)
        .every((line) => /^X-ALT-DESC[;:]/i.test(line) || !MARKUP_TAG.test(line))
    const tokens = [
      '<', '>', '/', ' ', '\t', '\r', '\n', '\r\n', '\r\n ', '\n\t', 'a', 'img', 'script', 'html', '!--', '?xml',
      '![CDATA[', '!DOCTYPE', 'X-ALT-DESC:', 'x-alt-desc;FMTTYPE=text/html:', 'X-ALT-DESC', 'DESCRIPTION:', ':',
    ]
    let seed = 0x5eed
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    let calendars = 0
    let refused = 0
    for (let i = 0; i < 20000; i++) {
      let body = ''
      for (let n = Math.floor(random() * 24); n > 0; n--) body += tokens[Math.floor(random() * tokens.length)]
      const ics = `BEGIN:VCALENDAR\r\n${body}`
      const expected = before(ics) ? 'calendar' : null
      expect(sniffFileFormat(bytes(ics)), JSON.stringify(ics)).toBe(expected)
      // The same calendar exported as UTF-16, either byte order.
      const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ics, 'utf16le')])
      const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(ics, 'utf16le').swap16()])
      expect(sniffFileFormat(new Uint8Array(le)), `UTF-16LE ${JSON.stringify(ics)}`).toBe(expected)
      expect(sniffFileFormat(new Uint8Array(be)), `UTF-16BE ${JSON.stringify(ics)}`).toBe(expected)
      if (expected) calendars++
      else refused++
    }
    // Both outcomes are well represented, so the comparison means something.
    expect(Math.min(calendars, refused)).toBeGreaterThan(1000)
  })

  // Folds were joined with replace(/\r?\n[ \t]/g, ''), which built a part per
  // fold: a 25MB calendar of `x\r\n \n` took 0.7s and 400–500MB a claim. They
  // are joined on the bytes now, and must come out exactly as the regex did.
  it('joins folded lines on the bytes exactly as the regex joined the text', () => {
    let seed = 0xf01d
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]
    const regex = (s: string) => s.replace(/\r?\n[ \t]/g, '')

    // 8-bit: any byte at all, weighted towards the ones a fold is made of.
    const latin1 = new TextDecoder('latin1')
    const byteTokens = [[0x0d], [0x0a], [0x20], [0x09], [0x0d, 0x0a], [0x0d, 0x0a, 0x20], [0x0a, 0x09], [0x0d, 0x0d, 0x0a], [0x78]]
    for (let i = 0; i < 20000; i++) {
      const parts: number[] = []
      for (let n = Math.floor(random() * 32); n > 0; n--) {
        parts.push(...(random() < 0.2 ? [Math.floor(random() * 256)] : pick(byteTokens)))
      }
      const b = Uint8Array.from(parts)
      expect(latin1.decode(unfoldLines(b)), JSON.stringify(parts)).toBe(regex(latin1.decode(b)))
    }

    // UTF-16, both byte orders. Code units whose bytes are a CR, LF, space or
    // tab in the other half (U+0A0D, U+200A, U+0D00…) must not be read as one.
    const unitTokens = [
      '\r', '\n', ' ', '\t', '\r\n', '\r\n ', '\n\t', 'x', 'é', '﻿', ' ', '🚀',
      '਍', ' ', 'ഀ', '਀', 'ठ', ' ', 'ഊ',
    ]
    for (let i = 0; i < 20000; i++) {
      let s = ''
      for (let n = Math.floor(random() * 24); n > 0; n--) s += pick(unitTokens)
      const le = new Uint8Array(Buffer.from(s, 'utf16le'))
      const be = new Uint8Array(Buffer.from(s, 'utf16le').swap16())
      const decodeLe = new TextDecoder('utf-16le', { ignoreBOM: true })
      const decodeBe = new TextDecoder('utf-16be', { ignoreBOM: true })
      expect(decodeLe.decode(unfoldLines(le, 2, true)), JSON.stringify(s)).toBe(regex(s))
      expect(decodeBe.decode(unfoldLines(be, 2, false)), JSON.stringify(s)).toBe(regex(s))
    }
  })

  // A UTF-16 calendar is decoded once to validate it. One with no folds was then
  // copied and decoded again: a 25MB one added about 100MB and 260ms a claim,
  // against 50MB and 135ms judged as first decoded, as it is now. (A capped
  // worker heap can't show this: strings that size are kept outside the heap.)
  it('decodes a UTF-16 calendar with no folds only once', () => {
    const utf16 = (ics: string) => [
      new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ics, 'utf16le')])),
      new Uint8Array(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(ics, 'utf16le').swap16()])),
    ]
    const lines = 'X-ALT-DESC;FMTTYPE=text/html:<p>Bring water</p>\r\nDESCRIPTION:Bring water\r\n\n'.repeat(2000)
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    try {
      for (const b of utf16(`BEGIN:VCALENDAR\r\n${lines}END:VCALENDAR\r\n`)) {
        decode.mockClear()
        expect(sniffFileFormat(b)).toBe('calendar')
        const whole = decode.mock.calls.filter(([input]) => ((input as Uint8Array | undefined)?.byteLength ?? 0) > 4096)
        expect(whole).toHaveLength(1)
        // Nothing to join, so the bytes come back as they are, not copied.
        expect(unfoldLines(b, 2, b[0] === 0xff)).toBe(b)
      }
    } finally {
      decode.mockRestore()
    }
    // Still judged line by line.
    for (const b of utf16(`BEGIN:VCALENDAR\r\n${lines}DESCRIPTION:<script>alert(1)</script>\r\n`)) {
      expect(sniffFileFormat(b)).toBeNull()
    }
  })

  // What the regex join cost was memory: held to a 64MB heap, it ran out on a
  // 25MB calendar of folds (it did at 256MB too). Joining on the bytes needs
  // about 25MB. The worker loads lib/file-sniff.ts from source with Node's own
  // type stripping, so that module must go on importing nothing.
  it('joins the folds of a 25MB calendar within a 64MB heap', async () => {
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads')
       import(workerData.source).then(({ sniffFileFormat }) => {
         const b = Buffer.alloc(25 * 1024 * 1024, 'x\\r\\n \\n')
         b.write('BEGIN:VCALENDAR\\r\\n', 0, 'latin1')
         parentPort.postMessage(sniffFileFormat(new Uint8Array(b.buffer, b.byteOffset, b.length)))
       })`,
      {
        eval: true,
        // Not new URL('./file-sniff.ts', import.meta.url): Vite turns that into a served asset URL.
        workerData: { source: pathToFileURL(`${import.meta.dirname}/file-sniff.ts`).href },
        resourceLimits: { maxOldGenerationSizeMb: 64 },
        stderr: true,
      },
    )
    worker.stderr.resume() // Node's notice that it stripped the types
    const outcome = await new Promise((resolve) => {
      worker.once('message', resolve)
      worker.once('error', (e: Error & { code?: string }) => resolve(`${e.code}: ${e.message}`))
    })
    await worker.terminate()
    expect(outcome).toBe('calendar')
  }, 30_000)

  it('reads a calendar of millions of lines, or of folds, in about the time plain text takes', () => {
    const sample = (head: string, fill: string) => {
      const out = new Uint8Array(Buffer.alloc(8 * 1024 * 1024, fill))
      out.set(Buffer.from(head))
      return out
    }
    const fastest = (b: Uint8Array) => {
      let best = Infinity
      for (let run = 0; run < 3; run++) {
        const started = performance.now()
        sniffFileFormat(b)
        best = Math.min(best, performance.now() - started)
      }
      return best
    }
    // Bare newlines: splitting took about five times as long as reading the
    // same bytes as text. Folds: the regex that joined them, about four times.
    for (const fill of ['\n', 'x\r\n \n']) {
      const calendar = sample('BEGIN:VCALENDAR\r\n', fill)
      const plain = sample('BEGIN:NOTHING\r\n', fill)
      expect(sniffFileFormat(calendar)).toBe('calendar')
      expect(sniffFileFormat(plain)).toBe('text')
      expect(fastest(calendar), JSON.stringify(fill)).toBeLessThan(2.5 * fastest(plain) + 50)
    }
  })

  // A caller that takes no text is spared reading every byte of one to refuse it.
  it('given formats that take no text, refuses text without reading it all', () => {
    const big = new Uint8Array(1024 * 1024).fill(0x61)
    const decode = vi.spyOn(TextDecoder.prototype, 'decode')
    try {
      expect(sniffFileFormat(big, ['pdf', 'ole2', 'ooxml', 'odf', 'iwork'])).toBeNull()
      const longest = Math.max(0, ...decode.mock.calls.map(([input]) => (input as Uint8Array | undefined)?.byteLength ?? 0))
      expect(longest).toBeLessThanOrEqual(4096)
      // Still read, and still text, for a caller that takes it.
      expect(sniffFileFormat(big, ['text'])).toBe('text')
      expect(sniffFileFormat(big)).toBe('text')
    } finally {
      decode.mockRestore()
    }
  })

  it('given formats that take no text, still lets text win over an audio frame', () => {
    // An MPEG frame header, then text: text without `accepted`, so never mp3.
    const framed = new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...Buffer.from('a CSV, really\n')])
    expect(sniffFileFormat(framed)).toBe('text')
    expect(sniffFileFormat(framed, ['mp3'])).toBeNull()
    expect(sniffFileFormat(framed, ['pdf'])).toBeNull()
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01, 0x02])
    expect(sniffFileFormat(audio, ['mp3'])).toBe('mp3')
  })

  it('reads a CSV that happens to start with "MZ" as text, not an executable', () => {
    expect(sniffFileFormat(bytes('MZ Robotics,Lincoln High,92\n'))).toBe('text')
  })
})

describe('names', () => {
  it('reads the extension of a path or a name', () => {
    expect(fileExtension('event-email/nv/123-Schedule.PDF')).toBe('pdf')
    expect(fileExtension('notes')).toBe('')
    expect(fileExtension('.env')).toBe('')
  })

  it('refuses a page, script, executable, installer or shortcut name for every format', () => {
    for (const ext of [
      'html', 'svg', 'js', 'exe', 'msi', 'bat', 'ps1', 'jar', 'docm', 'xlsm', 'msix', 'appx', 'appinstaller',
      'vsix', 'xpi', 'cab', 'rdp', 'website', 'py', 'pyw', 'pyz', 'rb', 'pl', 'ahk', 'iqy', 'slk', 'xll', 'xla',
    ]) {
      expect(isDangerousExtension(ext)).toBe(true)
      for (const format of FORMATS) expect(nameMatchesFormat(`x.${ext}`, format, false)).toBe(false)
    }
  })

  it('in strict mode, needs the format’s own extension', () => {
    expect(nameMatchesFormat('proposal.docx', 'ooxml', true)).toBe(true)
    expect(nameMatchesFormat('proposal.zip', 'ooxml', true)).toBe(false)
    expect(nameMatchesFormat('setup.msi', 'ole2', true)).toBe(false)
    expect(nameMatchesFormat('roster.csv', 'pdf', true)).toBe(false)
    expect(nameMatchesFormat('lesson.ggb', 'zip', true)).toBe(true)
    expect(nameMatchesFormat('lesson.ipynb', 'text', true)).toBe(false)
  })

  it('outside strict mode, also takes the listed shared-file names — and nothing unlisted', () => {
    expect(nameMatchesFormat('lesson.ipynb', 'text', false)).toBe(true)
    expect(nameMatchesFormat('bracket.3mf', 'ooxml', false)).toBe(true)
    expect(nameMatchesFormat('bracket.3mf', 'ooxml', true)).toBe(false)
    expect(nameMatchesFormat('report.pdf', 'text', false)).toBe(false)
    // An app package, a remote connection, an unfamiliar name: whatever the bytes.
    expect(nameMatchesFormat('tool.msixbundle', 'ooxml', false)).toBe(false)
    expect(nameMatchesFormat('homework.foo', 'zip', false)).toBe(false)
    expect(nameMatchesFormat('notes.diagcab', 'zip', false)).toBe(false)
  })

  it('reads a 3MF print file as an Office-style package', () => {
    expect(sniffFileFormat(threeMf())).toBe('ooxml')
  })

  // A double extension is judged by its last part, and Windows saves `x.html.`
  // and `x.html ` as x.html, so those are pages too.
  it('reads the extension the saved file will have', () => {
    expect(fileExtension('trailing.html.')).toBe('html')
    expect(fileExtension('spaced.html ')).toBe('html')
    expect(fileExtension('event-email/nv/1-notes.html. .')).toBe('html')
    expect(fileExtension('README')).toBe('')
    for (const name of ['trailing.html.', 'spaced.html ', 'schedule.pdf.exe', 'report.pdf.html']) {
      for (const format of FORMATS) expect(nameMatchesFormat(name, format, false)).toBe(false)
    }
    expect(nameMatchesFormat('notes.html.pdf', 'pdf', true)).toBe(true)
  })

  // The trailing trim was /[.\s]+$/, which V8 runs in time quadratic in a run of
  // dots or spaces that isn't at the end — 80,000 spaces took 10 seconds, and
  // POST /api/uploads/sign read the name before checking who was asking. The
  // loop that replaced it must read every name exactly as the regex did.
  it('reads every name as the old trailing-trim regex did', () => {
    const before = (name: string) => {
      const base = (name.split('/').pop() ?? '').replace(/[.\s]+$/, '')
      const dot = base.lastIndexOf('.')
      return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
    }
    const nbsp = String.fromCharCode(0xa0)
    const lineSeparator = String.fromCharCode(0x2028)
    const bom = String.fromCharCode(0xfeff)
    const names = [
      '', '.', '..', ' ', ' . ', 'a', 'a.', '.a', '..a', 'a..b', 'a.b', 'A.PDF', 'a.b.c', 'a .b', 'a. b',
      'x.html.', 'x.html ', 'x.html. .', 'x.html\t', 'x.html\r\n', `x.html${nbsp}`, `x.html${lineSeparator}`,
      `x.html${bom}`, `x.ht${nbsp}ml`, 'x.html.\u0000', 'dir/', 'dir/.', 'a.b/c', 'a/b.c', 'a/b.c/', 'a/b.c/.',
      'event-email/nv/123-Schedule.PDF', 'event-email/nv/1-notes.html. .', '.env', 'README', 'a.tar.gz',
      `a${' '.repeat(50)}x`, `a${'.'.repeat(50)}x`, `a.${'. '.repeat(25)}`, `${'.'.repeat(10)}pdf`,
    ]
    for (const name of names) expect(fileExtension(name), JSON.stringify(name)).toBe(before(name))
  })

  it('reads a megabyte of dots or spaces in linear time', () => {
    const run = 1024 * 1024
    for (const name of [
      `a${' '.repeat(run)}x`,
      `a${'.'.repeat(run)}x`,
      `a${'. '.repeat(run / 2)}x`,
      `a${'\t'.repeat(run)}x.pdf`,
      `x.pdf${' '.repeat(run)}`,
      `x.pdf${'.'.repeat(run)}`,
    ]) {
      const started = performance.now()
      fileExtension(name)
      expectWithin(started, 500)
    }
    expect(fileExtension(`a${' '.repeat(run)}x`)).toBe('')
    expect(fileExtension(`a.${' '.repeat(run)}pdf`)).toBe(`${' '.repeat(run)}pdf`)
    expect(fileExtension(`x.pdf${' . '.repeat(run / 3)}`)).toBe('pdf')
  })

  it('lets an image carry another image extension, and any file carry none', () => {
    expect(nameMatchesFormat('IMG_0001.HEIC', 'jpeg', true)).toBe(true)
    expect(nameMatchesFormat('art.png', 'jpeg', true)).toBe(true)
    expect(nameMatchesFormat('art.png', 'pdf', true)).toBe(false)
    expect(nameMatchesFormat('scan', 'pdf', true)).toBe(true)
  })
})

describe('shortenFileName', () => {
  it('leaves a name that fits alone', () => {
    expect(shortenFileName('Schedule.pdf', 200)).toBe('Schedule.pdf')
    expect(shortenFileName(`${'x'.repeat(196)}.pdf`, 200)).toBe(`${'x'.repeat(196)}.pdf`)
  })

  it('cuts the stem and keeps the extension as it is written', () => {
    expect(shortenFileName(`${'x'.repeat(226)}.pdf`, 200)).toBe(`${'x'.repeat(196)}.pdf`)
    expect(shortenFileName(`Parent packet ${'é'.repeat(220)}.PDF`, 200)).toBe(`Parent packet ${'é'.repeat(182)}.PDF`)
    // The dots and spaces Windows drops after an extension go with the cut.
    expect(shortenFileName(`${'x'.repeat(226)}.pdf. .`, 200)).toBe(`${'x'.repeat(196)}.pdf`)
  })

  it('keeps no extension it can’t fit, and cuts a name without one at the end', () => {
    expect(shortenFileName(`${'x'.repeat(226)}.${'e'.repeat(20)}`, 200)).toBe('x'.repeat(200))
    expect(shortenFileName('x'.repeat(230), 200)).toBe('x'.repeat(200))
  })

  it('never leaves half of a character outside the Basic Multilingual Plane', () => {
    const name = `${'x'.repeat(195)}🚀🚀🚀.pdf` // the rocket straddles the cut
    const short = shortenFileName(name, 200)
    expect(short).toBe(`${'x'.repeat(195)}.pdf`)
    expect(short.isWellFormed()).toBe(true)
  })
})

describe('contentTypeFor', () => {
  it('derives the type from the format, using the name only within it', () => {
    expect(contentTypeFor('pdf', 'schedule.pdf')).toBe('application/pdf')
    expect(contentTypeFor('ooxml', 'roster.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(contentTypeFor('ooxml', 'packet.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(contentTypeFor('text', 'roster.csv')).toBe('text/csv')
    expect(contentTypeFor('calendar', 'event.ics')).toBe('text/calendar')
    expect(contentTypeFor('text', 'event.ics')).toBe('text/plain')
    expect(contentTypeFor('text', 'notes.txt')).toBe('text/plain')
    expect(contentTypeFor('text', 'roster.docx')).toBe('text/plain')
  })

  it('never yields a type a browser runs, whatever the name', () => {
    for (const format of FORMATS) {
      for (const name of ['x.html', 'x.svg', 'x.xml', 'x.js', `x.${FORMAT_EXTENSIONS[format][0]}`, '']) {
        expect(isActiveContentType(contentTypeFor(format, name))).toBe(false)
      }
    }
  })
})

describe('isActiveContentType', () => {
  it.each([
    'text/html', 'TEXT/HTML; charset=utf-8', 'image/svg+xml', 'application/xhtml+xml', 'text/xml',
    'application/xml', 'application/javascript', 'text/javascript', 'application/x-shockwave-flash',
  ])('flags %s', (type) => {
    expect(isActiveContentType(type)).toBe(true)
  })

  it.each([
    'application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'text/csv', 'text/plain', 'text/calendar',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream', '',
  ])('passes %j', (type) => {
    expect(isActiveContentType(type)).toBe(false)
  })

  it('passes a missing type', () => {
    expect(isActiveContentType(undefined)).toBe(false)
    expect(isActiveContentType(null)).toBe(false)
  })
})
