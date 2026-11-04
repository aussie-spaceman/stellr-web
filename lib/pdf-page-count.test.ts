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
  return (await PDFDocument.load(file, { updateMetadata: false })).getPageCount()
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

  it('reports what it can’t tell', async () => {
    const { body, offsets } = layout([PAGE])
    expect(
      await checkPdfPageLimit(objectStreamPdf(body, offsets, { dict: '<< /Type /ObjStm /N 1 /First {F} /Filter /LZWDecode >>' }), 50),
    ).toBe('unknown')
  })
})
