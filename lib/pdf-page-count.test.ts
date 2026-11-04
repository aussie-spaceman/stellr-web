import { describe, it, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import {
  LOAD_OBJECT_LIMIT,
  MAX_FLATE_STREAMS,
  MAX_MEMBER_PDF_PAGES,
  MAX_OBJECT_STREAMS,
  checkPdfPageLimit,
  scanPdfPages,
} from './pdf-page-count'

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))
const join = (...parts: (string | Uint8Array)[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)))))

async function pdfOf(pages: number, useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save({ useObjectStreams })
}

const scan = (b: Uint8Array, stopAbove?: number) => scanPdfPages(b, stopAbove)

/**
 * A PDF whose objects sit in one object stream, as a crafted file packs them.
 * `body` is what follows the header; `offsets` are the entries' offsets in it,
 * object numbers from 3. `dict` is the stream's dictionary, with {N}, {F} and
 * {L} filled in.
 */
function objectStreamPdf(
  body: string,
  offsets: number[],
  opts: { dict?: string; data?: (raw: Buffer) => Buffer } = {},
): Uint8Array {
  const header = offsets.map((off, i) => `${i + 3} ${off}`).join(' ')
  const raw = Buffer.from(`${header}\n${body}`, 'latin1')
  const data = opts.data ? opts.data(raw) : deflateSync(raw)
  const dict = (opts.dict ?? '<< /Type /ObjStm /N {N} /First {F} /Filter /FlateDecode /Length {L} >>')
    .replace('{N}', String(offsets.length))
    .replace('{F}', String(header.length + 1))
    .replace('{L}', String(data.length))
  return join(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n',
    `2 0 obj\n${dict}\nstream\n`,
    data,
    '\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  )
}

/** Objects laid out one after another; their offsets. */
function layout(objects: string[]): { body: string; offsets: number[] } {
  const offsets: number[] = []
  let body = ''
  for (const o of objects) {
    offsets.push(body.length)
    body += `${o}\n`
  }
  return { body, offsets }
}

const PAGE = '<< /Type /Page /Parent 3 0 R /MediaBox [0 0 10 10] >>'
const kids = (n: number, from = 4) => Array.from({ length: n }, (_, i) => `${i + from} 0 R`).join(' ')

/** `pages` honest pages and their tree, every object in one object stream. */
function crafted(pages: number, dict?: string): Uint8Array {
  const { body, offsets } = layout([
    `<< /Type /Pages /Count ${pages} /Kids [${kids(pages)}] >>`,
    ...Array.from({ length: pages }, () => PAGE),
  ])
  return objectStreamPdf(body, offsets, { dict })
}

/**
 * One `/Type /Page` read as `n` pages: `n` header entries point into the run
 * of whitespace before it, and pdf-lib skips whitespace before parsing each.
 */
function whitespaceAlias(n: number): Uint8Array {
  const body = `${' '.repeat(n)}${PAGE}\n<< /Type /Pages /Count ${n} /Kids [${kids(n, 4)}] >>`
  const offsets = [n + PAGE.length + 1, ...Array.from({ length: n }, (_, i) => i)]
  return objectStreamPdf(body, offsets)
}

/**
 * One `/Type /Page` read as `n + 1` pages: entries point at `<<` inside
 * comments, and from each pdf-lib skips the comments after it to the same
 * `/Type /Page`. Every entry starts on a byte that isn't whitespace.
 */
function commentAlias(n: number): Uint8Array {
  let page = '<< '
  const pageOffsets = [0]
  for (let i = 0; i < n; i++) {
    page += '% '
    pageOffsets.push(page.length)
    page += '<<\n'
  }
  page += '/Parent 3 0 R /MediaBox [0 0 10 10] /Type /Page >>\n'
  const body = `${page}<< /Type /Pages /Count ${n + 1} /Kids [${kids(n + 1)}] >>`
  return objectStreamPdf(body, [page.length, ...pageOffsets])
}

/** The pages pdf-lib builds from a file. */
async function pdfLibPages(file: Uint8Array): Promise<number> {
  return (await PDFDocument.load(file, { updateMetadata: false, ignoreEncryption: true })).getPageCount()
}

/**
 * One object stream as an indirect object `num 0 obj`, holding `objects`
 * ([object number, source] pairs). `dict` fills {N}, {F} and {L}; `encode`
 * turns the raw stream into its data (Flate by default).
 */
function objStmObject(
  num: number,
  objects: [number, string][],
  dict = '<< /Type /ObjStm /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
  encode: (raw: Buffer) => Buffer = (raw) => deflateSync(raw),
): Uint8Array {
  const offsets: number[] = []
  let body = ''
  for (const [, o] of objects) {
    offsets.push(body.length)
    body += `${o}\n`
  }
  const header = objects.map(([n], i) => `${n} ${offsets[i]}`).join(' ')
  const data = encode(Buffer.from(`${header}\n${body}`, 'latin1'))
  const filled = dict
    .replace('{N}', String(objects.length))
    .replace('{F}', String(header.length + 1))
    .replace('{L}', String(data.length))
  return join(`${num} 0 obj\n${filled}\nstream\n`, data, '\nendstream\nendobj\n')
}

/** `n` page objects numbered from `from`, each a leaf of tree `parent`. */
const pageObjects = (n: number, from: number, parent = 3): [number, string][] =>
  Array.from({ length: n }, (_, i) => [from + i, `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 10 10] >>`])

/** A page tree object `num` whose kids are objects `from`…`from + n - 1`, claiming `count`. */
const treeObject = (num: number, n: number, from: number, count = n): [number, string] => [
  num,
  `<< /Type /Pages /Count ${count} /Kids [${kids(n, from)}] >>`,
]

const top = ([num, src]: [number, string]) => `${num} 0 obj\n${src}\nendobj\n`
const CATALOG = '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 3 0 R >>\nendobj\n'
const TRAILER = 'trailer\n<< /Root 1 0 R >>\n%%EOF\n'
const hexEncode = (raw: Buffer) => Buffer.from(`${raw.toString('hex')}>`, 'latin1')

/**
 * The review finding: an object stream under /ASCIIHexDecode whose /Filter is
 * `filter`, the name /ASCIIHexDecode written only as object 9 inside a small
 * Flate object stream the scan sniffs but doesn't read.
 */
function hiddenFilter(pages: number, filter: string, extraDict = ''): Uint8Array {
  return join(
    CATALOG,
    objStmObject(2, [[9, '/ASCIIHexDecode'], [8, '[/ASCIIHexDecode]']]),
    objStmObject(
      5,
      [treeObject(3, pages, 10), ...pageObjects(pages, 10)],
      `<< /Type /ObjStm /N {N} /First {F} /Filter ${filter}${extraDict} /Length {L} >>`,
      hexEncode,
    ),
    TRAILER,
  )
}

describe('scanPdfPages', () => {
  it('bounds the pages pdf-lib writes, with and without object streams', async () => {
    for (const streams of [true, false]) {
      for (const pages of [1, 50, 51]) {
        expect(scan(await pdfOf(pages, streams))?.bound).toBeGreaterThanOrEqual(pages)
      }
    }
    // Without object streams, every page is counted where it lies.
    expect(scan(await pdfOf(50, false))?.bound).toBe(50)
  })

  it('counts no pages in a PDF without any', () => {
    expect(scan(enc('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n'))).toEqual({
      bound: 0,
      objects: 1,
      markers: 0,
    })
  })

  it('stops counting past the limit it is given', async () => {
    expect(scan(await pdfOf(80, false), 60)?.markers).toBe(61)
  })

  it('reads names as pdf-lib decodes them', () => {
    expect(scan(enc('%PDF-1.7\n<< /Type /P#61ge >>\n<< /T#79pe/Page >>\n'))?.bound).toBe(2)
    expect(scan(enc('%PDF-1.7\n<< /Type /Pages >> << /Type /PageLabel >> << /Typed /Page >>'))?.bound).toBe(0)
  })

  // A comment pdf-lib skips could hide the value; a long gap could too.
  it('counts a /Type whose value it cannot see as a page', () => {
    expect(scan(enc('%PDF-1.7\n<< /Type %x /Pages\n /Page >>'))?.bound).toBe(1)
    expect(scan(enc(`%PDF-1.7\n<< /Type${' '.repeat(64)}/Page >>`))?.bound).toBe(1)
    expect(scan(enc('%PDF-1.7\n<< /Type 7 0 R >>'))?.bound).toBe(0)
  })

  it('counts every object-stream entry as a possible page', () => {
    // The page tree's own entry counts too.
    expect(scan(crafted(50))?.bound).toBe(51)
    expect(scan(crafted(51))?.bound).toBe(52)
  })

  // Streams are judged by their bytes, not by what their dictionary says.
  it('reads an object stream whatever its dictionary says', () => {
    const { body, offsets } = layout([PAGE, PAGE])
    for (const dict of [
      '<< /Type /Obj#53tm /N {N} /First {F} /Filter /FlateDecode >>',
      '<< /Type 9 0 R /N {N} /First {F} /Filter /FlateDecode >>',
      '<< /N {N} /First {F} /Filter /FlateDecode >>',
      '<< /Type /XObject /N {N} /First {F} >>',
    ]) {
      expect(scan(objectStreamPdf(body, offsets, { dict }))?.bound).toBe(2)
    }
    // Unfiltered: the header is read where it lies.
    expect(scan(objectStreamPdf(body, offsets, { data: (raw) => raw, dict: '<< /Type /ObjStm /N {N} /First {F} >>' }))?.bound).toBe(
      4, // two entries, and the two pages counted in the file as well
    )
  })

  it('reads Flate inside Flate', () => {
    const { body, offsets } = layout([PAGE, PAGE, PAGE])
    const twice = objectStreamPdf(body, offsets, {
      dict: '<< /Type /ObjStm /N {N} /First {F} /Filter [/FlateDecode /FlateDecode] >>',
      data: (raw) => deflateSync(deflateSync(raw)),
    })
    expect(scan(twice)?.bound).toBe(3)
  })

  it('can’t tell an object stream under a filter it doesn’t read', () => {
    const { body, offsets } = layout([PAGE])
    const hex = (raw: Buffer) => Buffer.from(raw.toString('hex') + '>', 'latin1')
    expect(
      scan(objectStreamPdf(body, offsets, { dict: '<< /Type /ObjStm /N 1 /First {F} /Filter /ASCIIHexDecode >>', data: hex })),
    ).toBeNull()
    expect(
      scan(objectStreamPdf(body, offsets, { dict: '<< /Type /ObjStm /N 1 /First {F} /Filter [/FlateDecode /LZWDecode] >>' })),
    ).toBeNull()
    // The filter by reference, the name written elsewhere.
    expect(
      scan(join(objectStreamPdf(body, offsets, { dict: '<< /Type /ObjStm /N 1 /First {F} /Filter 9 0 R >>' }), '9 0 obj /LZW#44ecode endobj\n')),
    ).toBeNull()
    // A file naming those filters but no object stream is read as usual.
    expect(scan(enc('%PDF-1.7\n4 0 obj\n<< /Filter /LZWDecode >>\nstream\nxx\nendstream\nendobj\n'))?.bound).toBe(0)
  })

  it('can’t tell a damaged or truncated Flate stream', () => {
    const { body, offsets } = layout([PAGE])
    expect(scan(objectStreamPdf(body, offsets, { data: (raw) => deflateSync(raw).subarray(0, 8) }))).toBeNull()
    const corrupt = (raw: Buffer) => {
      const z = Buffer.from(deflateSync(raw))
      z.fill(0xff, 2, 12)
      return z
    }
    expect(scan(objectStreamPdf(body, offsets, { data: corrupt }))).toBeNull()
  })

  // Review finding: distinct offsets into one run of whitespace made one
  // `/Type /Page` into thousands of pages.
  it('bounds a header whose entries point into whitespace before one page', async () => {
    const file = whitespaceAlias(2000)
    expect(await pdfLibPages(file)).toBe(2000)
    expect(scan(file)?.bound).toBeGreaterThanOrEqual(2000)
    expect(await checkPdfPageLimit(file, 50)).not.toBe('ok')
  })

  // Found in review of that finding: comments do what whitespace did, with
  // every entry on a byte that isn't whitespace.
  it('bounds a header whose entries point at `<<` inside comments', async () => {
    const file = commentAlias(2000)
    expect(await pdfLibPages(file)).toBe(2001)
    expect(scan(file)?.bound).toBeGreaterThanOrEqual(2001)
    expect(await checkPdfPageLimit(file, 50)).not.toBe('ok')
  })

  // Review findings: a `stream` in a string or a comment of the object
  // stream's dictionary hid the stream from a scan that read dictionaries.
  describe('a `stream` keyword where pdf-lib reads none', () => {
    const variants = [
      '<< /Filter /FlateDecode /X (stream) /Type /ObjStm /N {N} /First {F} /Length {L} >>',
      '<< /Type /ObjStm /X (stream) /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
      '<< /Type /ObjStm /X (upstream) /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
      '<< /Type /ObjStm %stream\n /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
      '<< /Type /ObjStm /X <73747265616d> /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
      '<< /Type /ObjStm /stream 1 /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
      '<< /Type /ObjStm /X (endstream) /N {N} /First {F} /Filter /FlateDecode /Length {L} >>',
    ]
    for (const dict of variants) {
      it(dict.replace(/ \/(N|First|Length) \{.\}/g, ''), async () => {
        const file = crafted(2000, dict)
        expect(await pdfLibPages(file)).toBe(2000)
        expect(scan(file)?.bound).toBeGreaterThanOrEqual(2000)
        expect(await checkPdfPageLimit(file, 50)).not.toBe('ok')
      })
    }
  })

  // The scan's bound must never fall below what pdf-lib builds.
  it('bounds what pdf-lib builds, honest files and crafted alike', async () => {
    const files = [
      await pdfOf(7, true),
      await pdfOf(7, false),
      crafted(120),
      whitespaceAlias(120),
      commentAlias(120),
      crafted(120, '<< /Type /ObjStm /X (stream) /N {N} /First {F} /Filter /FlateDecode >>'),
    ]
    for (const file of files) expect(scan(file)?.bound).toBeGreaterThanOrEqual(await pdfLibPages(file))
  })

  // Review finding (HIGH): /Filter 9 0 R, object 9 the name /ASCIIHexDecode
  // inside another object stream, skipped the scan — 2,000 pages passed as 1.
  describe('a /Filter the scan can’t read where it is written', () => {
    const cases: [string, string, string?][] = [
      ['a reference', '9 0 R'],
      ['a reference to an array', '8 0 R'],
      ['a reference in an array', '[9 0 R]'],
      ['a reference after Flate in an array', '[/FlateDecode 9 0 R]'],
      ['a signed reference', '+9 0 R'],
      ['a reference written 9.', '9. 0 R'],
      ['a value behind a comment', '%x\n/ASCIIHexDecode'],
      ['a comment in an array', '[%x\n/ASCIIHexDecode]'],
      ['a value past the window', `${' '.repeat(80)}/ASCIIHexDecode`],
      ['an array past the window', `[${'/FlateDecode '.repeat(6)}]`],
      ['a nested array', '[[/ASCIIHexDecode]]'],
    ]
    for (const [name, filter] of cases) {
      it(name, async () => {
        const file = hiddenFilter(2000, filter)
        expect(scan(file)).toBeNull()
        expect(await checkPdfPageLimit(file, MAX_MEMBER_PDF_PAGES)).toBe('unknown')
      })
    }

    it('a /DecodeParms that is a reference or hidden', () => {
      for (const parms of ['9 0 R', '+9 0 R', '%x\n<< >>', `${' '.repeat(40)}<< >>`]) {
        const file = join(
          CATALOG,
          objStmObject(5, [treeObject(3, 3, 10), ...pageObjects(3, 10)], `<< /Type /ObjStm /N {N} /First {F} /Filter /FlateDecode /DecodeParms ${parms} >>`),
          TRAILER,
        )
        expect(scan(file)).toBeNull()
      }
      // Written out directly, as xref streams write theirs: read as before.
      for (const parms of ['<< /Predictor 12 /Columns 4 >>', '[<< >>]', 'null']) {
        const file = join(
          CATALOG,
          objStmObject(5, [treeObject(3, 3, 10), ...pageObjects(3, 10)], `<< /Type /ObjStm /N {N} /First {F} /Filter /FlateDecode /DecodeParms ${parms} >>`),
          TRAILER,
        )
        expect(scan(file)?.bound).toBe(4)
      }
    })

    it('is a bypass pdf-lib really builds', async () => {
      expect(await pdfLibPages(hiddenFilter(2000, '9 0 R'))).toBe(2000)
      expect(await pdfLibPages(hiddenFilter(2000, '[9 0 R]'))).toBe(2000)
      expect(await pdfLibPages(hiddenFilter(2000, '+9 0 R'))).toBe(2000)
    })

    it('is refused even in a file that names no object stream', () => {
      expect(scan(enc('%PDF-1.7\n4 0 obj\n<< /Filter 9 0 R >>\nstream\nxx\nendstream\nendobj\n'))).toBeNull()
    })

    it('reads filters written out directly as before', async () => {
      for (const filter of ['/FlateDecode', '[/FlateDecode]', '[ /FlateDecode ]', '/Fl#61teDecode']) {
        const file = join(CATALOG, objStmObject(5, [treeObject(3, 3, 10), ...pageObjects(3, 10)], `<< /Type /ObjStm /N {N} /First {F} /Filter ${filter} >>`), TRAILER)
        expect(scan(file)?.bound).toBe(4)
        expect(await checkPdfPageLimit(file, MAX_MEMBER_PDF_PAGES)).toBe('ok')
      }
    })
  })

  // A /Type that may be a reference marks the file as one that could hold an
  // object stream, so a filter pdf-lib decodes and the scan doesn't refuses it.
  it('treats a signed or hidden /Type as a reference', () => {
    for (const type of ['+9 0 R', '9. 0 R', '-9 0 R', '%x\n/ObjStm']) {
      const file = enc(`%PDF-1.7\n4 0 obj\n<< /Type ${type} /Filter /ASCIIHexDecode >>\nstream\n20>\nendstream\nendobj\n`)
      expect(scan(file)).toBeNull()
    }
  })

  // pdf-lib throws on a filter it doesn't decode, so no object comes out of
  // that stream: a photo (DCTDecode) is no reason to refuse a file.
  it('lets through a filter pdf-lib won’t decode, which builds nothing', async () => {
    const file = join(
      CATALOG,
      top(treeObject(3, 0, 10)),
      objStmObject(5, [treeObject(3, 60, 10), ...pageObjects(60, 10)], '<< /Type /ObjStm /N {N} /First {F} /Filter /DCTDecode >>', (raw) => raw),
      TRAILER,
    )
    expect(scan(file)).not.toBeNull()
    expect(await pdfLibPages(file)).toBe(0)

    const photo = Buffer.from(await pdfOf(3, true)).toString('latin1')
    const withJpeg = enc(
      `${photo}9 0 obj\n<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /Filter /DCTDecode /Length 4 >>\nstream\n\xff\xd8\xff\xd9\nendstream\nendobj\n`,
    )
    expect(await checkPdfPageLimit(withJpeg, MAX_MEMBER_PDF_PAGES)).toBe('ok')
  })

  // The case this exists for: 300,000 pages compressed into a few MB.
  describe('300,000 pages, refused quickly', () => {
    const cases: [string, () => Uint8Array][] = [
      ['honest pages', () => crafted(300_000)],
      ['one page behind 300,000 entries into whitespace', () => whitespaceAlias(300_000)],
      ['one page behind 300,000 comments', () => commentAlias(300_000)],
      ['honest pages behind a (stream) string', () => crafted(300_000, '<< /Type /ObjStm /X (stream) /N {N} /First {F} /Filter /FlateDecode >>')],
    ]
    for (const [name, make] of cases) {
      it(name, async () => {
        const file = make()
        expect(file.byteLength).toBeLessThan(25 * 1024 * 1024)
        const started = performance.now()
        expect(await checkPdfPageLimit(file, MAX_MEMBER_PDF_PAGES)).not.toBe('ok')
        expect(performance.now() - started).toBeLessThan(1000)
      })
    }
  })

  // More than the inflate budget holds is "can't tell", never a partial count.
  it('stops inflating at its budget', () => {
    const offsets = Array.from({ length: 1_500_000 }, (_, i) => i * 7)
    const file = objectStreamPdf(PAGE, offsets)
    const started = performance.now()
    expect(scan(file)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('can’t tell a file of more Flate streams than any 50-page PDF has', () => {
    const one = join('stream\n', deflateSync(Buffer.from('q')), '\nendstream\n')
    const many = join('%PDF-1.7\n', ...Array.from({ length: MAX_FLATE_STREAMS + 1 }, () => one))
    const started = performance.now()
    expect(scan(many)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('can’t tell a file of more object streams than it inflates in full', () => {
    // A header longer than a sniff sees is inflated in full.
    const header = Array.from({ length: 2000 }, (_, i) => `${i + 3} ${i}`).join(' ')
    const one = join('stream\n', deflateSync(Buffer.from(header)), '\nendstream\n')
    const many = join('%PDF-1.7\n', ...Array.from({ length: MAX_OBJECT_STREAMS + 1 }, () => one))
    expect(scan(many)).toBeNull()
  })

  // Every pass is linear: 25MB of the worst each branch can be fed stays well
  // under a second.
  describe('25MB of hostile input', () => {
    const MB25 = 25 * 1024 * 1024
    const fill = (unit: string | Buffer) => {
      const b = Buffer.alloc(MB25, unit as string, 'latin1')
      b.write('%PDF-1.7\n', 0, 'latin1')
      return new Uint8Array(b.buffer, b.byteOffset, b.length)
    }
    const zlibStream = Buffer.concat([Buffer.from('stream\n'), deflateSync(Buffer.from('1 2 3 4 5 6 7 8 9 '.repeat(4)))])
    const cases: [string, () => Uint8Array][] = [
      ['a /Type before every gap', () => fill(`/Type${' '.repeat(30)}/X`)],
      ['nothing but /Type', () => fill('/Type')],
      ['escaped names', () => fill('/#54#79#70#65 /#50#61#67#66 /#4C#5A#57#44#65#63#6F#64#65 ')],
      ['long names', () => fill(`/${'T'.repeat(200)} `)],
      ['nothing but stream keywords', () => fill('stream\n')],
      ['endstream after endstream', () => fill('endstream\n')],
      ['obj after obj', () => fill('obj ')],
      ['streams whose headers run on', () => fill('stream\n1 0 2 1 ')],
      ['streams inside comments of headers', () => fill('stream 1 2 % stream 3 4 % ')],
      ['a long header after streams in comments', () => fill(`${'% stream '.repeat(1000)}\n${'1 '.repeat(100_000)}`)],
      ['Flate streams one after another', () => fill(zlibStream)],
      ['zlib headers after stream keywords', () => fill('stream\nx\x9c')],
      ['slashes', () => fill('/')],
      ['nothing but /Filter', () => fill('/Filter ')],
      ['filter arrays that run to the window', () => fill(`/Filter [${'/A '.repeat(20)}`)],
      ['nothing but /DecodeParms', () => fill('/DecodeParms ')],
    ]
    for (const [name, make] of cases) {
      it(name, () => {
        const b = make()
        const started = performance.now()
        const result = scan(b, 250)
        expect(performance.now() - started).toBeLessThan(1000)
        expect(result === null || result.bound >= 0).toBe(true)
      })
    }
  })

  // The fixture is built here and handed over, so the 64MB limit measures
  // only the scan (building 300,000 objects in the worker ran it out of
  // memory on its own). The worker loads lib/pdf-page-count.ts from source
  // with Node's own type stripping, so that module must import nothing but
  // Node built-ins up top.
  it('refuses the 300,000-page file within a 64MB heap', async () => {
    const file = crafted(300_000)
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads')
       import(workerData.source).then(({ scanPdfPages }) => {
         const result = scanPdfPages(new Uint8Array(workerData.file), 250)
         parentPort.postMessage(result && { bound: result.bound, markers: result.markers })
       })`,
      {
        eval: true,
        workerData: { source: pathToFileURL(`${import.meta.dirname}/pdf-page-count.ts`).href, file: file.buffer },
        transferList: [file.buffer as ArrayBuffer],
        resourceLimits: { maxOldGenerationSizeMb: 64 },
        stderr: true,
      },
    )
    worker.stderr.resume()
    const outcome = await new Promise((resolve) => {
      worker.once('message', resolve)
      worker.once('error', (e: Error & { code?: string }) => resolve(`${e.code}: ${e.message}`))
    })
    await worker.terminate()
    // Counted past the cap, or too much to inflate: either way, refused.
    expect(outcome === null || (outcome as { markers: number }).markers > 250).toBe(true)
  }, 30_000)
})

describe('checkPdfPageLimit', () => {
  it('passes 50 pages and refuses 51', async () => {
    for (const streams of [true, false]) {
      expect(await checkPdfPageLimit(await pdfOf(50, streams), 50)).toBe('ok')
      expect(await checkPdfPageLimit(await pdfOf(51, streams), 50)).toBe('over')
    }
  })

  it('refuses the 300,000-page file without loading it', async () => {
    const started = performance.now()
    // More to inflate than the budget allows: refused as uncountable.
    expect(await checkPdfPageLimit(crafted(300_000), 50)).toBe('unknown')
    expect(performance.now() - started).toBeLessThan(1000)
  })

  // An incremental save (a signature, an annotation) appends a new copy of each
  // page it changes; pdf-lib keeps the last. The old copies aren't pages.
  it('counts an incrementally saved PDF by its page tree', async () => {
    const appendCopies = async (pages: number, copies: number) => {
      const doc = await PDFDocument.create()
      for (let i = 0; i < pages; i++) doc.addPage([612, 792])
      const refs = doc.getPages().slice(0, copies).map((p) => p.ref.objectNumber)
      const saved = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1')
      const again = refs.map((n) => {
        const start = saved.indexOf(`\n${n} 0 obj`)
        return saved.slice(start, saved.indexOf('endobj', start) + 'endobj'.length)
      })
      return enc(`${saved}${again.join('\n')}\n%%EOF\n`)
    }
    expect(scan(await appendCopies(50, 10))?.bound).toBe(60)
    expect(await checkPdfPageLimit(await appendCopies(50, 10), 50)).toBe('ok')
    expect(await checkPdfPageLimit(await appendCopies(51, 10), 50)).toBe('over')
  })

  // Loading is what settles an ordinary object-stream file over the cap; a
  // file of more objects than that load is allowed is never opened.
  it('won’t load a file of more objects than LOAD_OBJECT_LIMIT', async () => {
    const { body, offsets } = layout(Array.from({ length: LOAD_OBJECT_LIMIT + 1 }, () => '<< /A 1 >>'))
    const file = objectStreamPdf(body, offsets)
    expect(scan(file)?.objects).toBeGreaterThan(LOAD_OBJECT_LIMIT)
    expect(await checkPdfPageLimit(file, 50)).toBe('unknown')
  })

  // /Count is never read: what counts is what pdf-lib builds.
  it('ignores what /Count claims', async () => {
    const file = (pages: number, count: number) =>
      join(CATALOG, top(treeObject(3, pages, 10, count)), ...pageObjects(pages, 10).map(top), TRAILER)
    expect(await checkPdfPageLimit(file(60, 1), 50)).toBe('over')
    expect(await checkPdfPageLimit(file(60, 0), 50)).toBe('over')
    expect(await pdfLibPages(file(60, 1))).toBe(60)
    expect(await checkPdfPageLimit(file(50, 5000), 50)).toBe('ok')
  })

  // Only the catalog's tree is the document; a second tree is pages pdf-lib
  // never builds, and the catalog's tree is never missed.
  it('counts the tree the catalog names, of several', async () => {
    const twoTrees = (catalogTree: number) =>
      join(
        `%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages ${catalogTree} 0 R >>\nendobj\n`,
        top(treeObject(3, 10, 100)),
        top(treeObject(4, 60, 200, 60)),
        ...pageObjects(10, 100, 3).map(top),
        ...pageObjects(60, 200, 4).map(top),
        TRAILER,
      )
    expect(await pdfLibPages(twoTrees(3))).toBe(10)
    expect(await checkPdfPageLimit(twoTrees(3), 50)).toBe('ok')
    expect(await pdfLibPages(twoTrees(4))).toBe(60)
    expect(await checkPdfPageLimit(twoTrees(4), 50)).toBe('over')
  })

  // An update appended to a file (its own xref section and trailer) can add
  // pages, swap the catalog to another tree, or carry pages in an object
  // stream; pdf-lib parses every section forwards, and so does the scan.
  describe('incremental updates', () => {
    const base = join(
      CATALOG,
      top(treeObject(3, 40, 10)),
      ...pageObjects(40, 10).map(top),
      'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 50 /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    )
    const update = (...body: (string | Uint8Array)[]) =>
      join(base, ...body, 'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 300 /Root 1 0 R /Prev 0 >>\nstartxref\n0\n%%EOF\n')

    it('adds pages', async () => {
      const file = update(top([3, `<< /Type /Pages /Count 60 /Kids [${kids(40, 10)} ${kids(20, 100)}] >>`]), ...pageObjects(20, 100).map(top))
      expect(await pdfLibPages(file)).toBe(60)
      expect(await checkPdfPageLimit(file, 50)).toBe('over')
    })

    it('moves the catalog to another tree', async () => {
      const file = update(
        '1 0 obj\n<< /Type /Catalog /Pages 4 0 R >>\nendobj\n',
        top(treeObject(4, 60, 100)),
        ...pageObjects(60, 100, 4).map(top),
      )
      expect(await pdfLibPages(file)).toBe(60)
      expect(await checkPdfPageLimit(file, 50)).toBe('over')
    })

    it('carries pages in an object stream', async () => {
      const file = update(
        objStmObject(7, [[3, `<< /Type /Pages /Count 60 /Kids [${kids(40, 10)} ${kids(20, 100)}] >>`], ...pageObjects(20, 100)]),
      )
      expect(await pdfLibPages(file)).toBe(60)
      expect(await checkPdfPageLimit(file, 50)).toBe('over')
    })

    it('replaces pages without adding any', async () => {
      const file = update(...pageObjects(40, 10).map(top))
      expect(await pdfLibPages(file)).toBe(40)
      expect(await checkPdfPageLimit(file, 50)).toBe('ok')
    })
  })

  // A hybrid file: a classic xref whose trailer points at an xref stream as
  // well (/XRefStm). Neither is what pdf-lib reads objects by.
  it('reads a hybrid-xref file’s object streams', async () => {
    const xrefRows = Buffer.from(Array.from({ length: 64 }, (_, i) => [1, 0, i, 0]).flat())
    const file = join(
      CATALOG,
      objStmObject(5, [treeObject(3, 60, 10), ...pageObjects(60, 10)]),
      `6 0 obj\n<< /Type /XRef /W [1 2 1] /Size 64 /Filter /FlateDecode /DecodeParms << /Columns 4 /Predictor 12 >> /Root 1 0 R >>\nstream\n`,
      deflateSync(xrefRows),
      '\nendstream\nendobj\n',
      'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 64 /Root 1 0 R /XRefStm 0 >>\nstartxref\n0\n%%EOF\n',
    )
    expect(await pdfLibPages(file)).toBe(60)
    expect(scan(file)?.bound).toBeGreaterThanOrEqual(60)
    expect(await checkPdfPageLimit(file, 50)).toBe('over')
  })

  // pdf-lib never decrypts: it reads an encrypted file's streams as the bytes
  // they are, and so does the scan. Pages in plain bytes are counted; bytes
  // that only look like Flate and won't inflate are "can't tell".
  it('reads an encrypted file as pdf-lib does', async () => {
    const encrypted = (stream: Uint8Array) =>
      join(CATALOG, stream, 'trailer\n<< /Root 1 0 R /Encrypt << /Filter /Standard /V 2 /R 3 /Length 128 /P -4 >> /ID [<00> <00>] >>\n%%EOF\n')
    const plain = encrypted(objStmObject(5, [treeObject(3, 60, 10), ...pageObjects(60, 10)]))
    expect(await pdfLibPages(plain)).toBe(60)
    expect(await checkPdfPageLimit(plain, 50)).toBe('over')

    const cipher = (raw: Buffer) => {
      const z = Buffer.from(deflateSync(raw))
      for (let i = 2; i < z.length; i++) z[i] ^= 0x5a
      return z
    }
    expect(scan(encrypted(objStmObject(5, [treeObject(3, 60, 10), ...pageObjects(60, 10)], undefined, cipher)))).toBeNull()
  })

  it('reports what it can’t tell', async () => {
    const { body, offsets } = layout([PAGE])
    expect(
      await checkPdfPageLimit(objectStreamPdf(body, offsets, { dict: '<< /Type /ObjStm /N 1 /First {F} /Filter /LZWDecode >>' }), 50),
    ).toBe('unknown')
  })
})
