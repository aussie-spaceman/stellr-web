import { describe, it, expect } from 'vitest'
import { Worker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { deflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_MEMBER_PDF_PAGES,
  MAX_OBJECT_STREAMS,
  checkPdfPageLimit,
  countPdfPageMarkers,
} from './pdf-page-count'

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))
const join = (...parts: (string | Uint8Array)[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)))))

async function pdfOf(pages: number, useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save({ useObjectStreams })
}

/**
 * A PDF whose objects 3… sit in one object stream, as a crafted file packs
 * them. `header` builds the stream's header from the objects' offsets.
 */
function objectStreamPdf(
  objects: string[],
  opts: { filter?: string; header?: (offsets: number[]) => string; data?: (raw: Buffer) => Buffer } = {},
): Uint8Array {
  const offsets: number[] = []
  let body = ''
  for (const o of objects) {
    offsets.push(body.length)
    body += `${o}\n`
  }
  const header = opts.header ? opts.header(offsets) : offsets.map((off, i) => `${i + 3} ${off}`).join(' ')
  const raw = Buffer.from(`${header}\n${body}`, 'latin1')
  const data = opts.data ? opts.data(raw) : deflateSync(raw)
  const filter = opts.filter ?? '/Filter /FlateDecode'
  return join(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `5000000 0 obj\n<< /Type /ObjStm /N ${objects.length} /First ${header.length + 1} ${filter} /Length ${data.length} >>\nstream\n`,
    data,
    '\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
  )
}

/** A page tree of `pages` pages, every object in one object stream. */
function crafted(pages: number): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 4} 0 R`).join(' ')
  const objects = [`<< /Type /Pages /Count ${pages} /Kids [${kids}] >>`]
  for (let i = 0; i < pages; i++) objects.push('<< /Type /Page /Parent 3 0 R >>')
  return objectStreamPdf(objects)
}

describe('countPdfPageMarkers', () => {
  it('counts the pages pdf-lib writes, with and without object streams', async () => {
    for (const streams of [true, false]) {
      expect(countPdfPageMarkers(await pdfOf(1, streams), 100)).toBe(1)
      expect(countPdfPageMarkers(await pdfOf(50, streams), 100)).toBe(50)
      expect(countPdfPageMarkers(await pdfOf(51, streams), 100)).toBe(51)
    }
  })

  it('counts no pages in a PDF without any', () => {
    expect(countPdfPageMarkers(enc('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n'), 100)).toBe(0)
  })

  it('stops counting past the limit it is given', async () => {
    expect(countPdfPageMarkers(await pdfOf(80, false), 60)).toBe(61)
  })

  it('reads names as pdf-lib decodes them', () => {
    expect(countPdfPageMarkers(enc('%PDF-1.7\n<< /Type /P#61ge >>\n<< /T#79pe/Page >>\n'), 10)).toBe(2)
    expect(countPdfPageMarkers(enc('%PDF-1.7\n<< /Type /Pages >> << /Type /PageLabel >> << /Typed /Page >>'), 10)).toBe(0)
  })

  // A comment pdf-lib skips could hide the value; a long gap could too.
  it('counts a /Type whose value it cannot see as a page', () => {
    expect(countPdfPageMarkers(enc('%PDF-1.7\n<< /Type %x /Pages\n /Page >>'), 10)).toBe(1)
    expect(countPdfPageMarkers(enc(`%PDF-1.7\n<< /Type${' '.repeat(64)}/Page >>`), 10)).toBe(1)
    expect(countPdfPageMarkers(enc('%PDF-1.7\n<< /Type 7 0 R >>'), 10)).toBe(0)
  })

  it('counts the pages in a compressed object stream', () => {
    expect(countPdfPageMarkers(crafted(50), 100)).toBe(50)
    expect(countPdfPageMarkers(crafted(51), 100)).toBe(51)
  })

  it('can’t tell an object stream under a filter it doesn’t read', () => {
    const hex = (raw: Buffer) => Buffer.from(raw.toString('hex') + '>', 'latin1')
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { filter: '/Filter /ASCIIHexDecode', data: hex }), 10)).toBeNull()
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { filter: '/Filter 9 0 R' }), 10)).toBeNull()
    expect(
      countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { filter: '/Filter [/FlateDecode /LZWDecode]' }), 10),
    ).toBeNull()
  })

  it('can’t tell a damaged or truncated object stream', () => {
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { data: (raw) => raw }), 10)).toBeNull()
    expect(
      countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { data: (raw) => deflateSync(raw).subarray(0, 8) }), 10),
    ).toBeNull()
  })

  it('reads an object stream whose /Type is escaped or a reference', () => {
    const escaped = join(
      '%PDF-1.7\n6 0 obj\n<< /Type /Obj#53tm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n',
      deflateSync(Buffer.from('7 0\n<< /Type /Page >>')),
      '\nendstream\nendobj\n',
    )
    expect(countPdfPageMarkers(escaped, 10)).toBe(1)
    const byRef = join(
      '%PDF-1.7\n6 0 obj\n<< /Type 9 0 R /Filter /FlateDecode >>\nstream\n',
      deflateSync(Buffer.from('7 0\n<< /Type /Page >>')),
      '\nendstream\nendobj\n',
    )
    expect(countPdfPageMarkers(byRef, 10)).toBe(1)
  })

  // pdf-lib parses an object at every offset in the header: two entries at one
  // offset would make one page in the text two pages in pdf-lib.
  it('can’t tell an object stream whose header repeats an offset', () => {
    const repeat = (offsets: number[]) => Array.from({ length: 1000 }, (_, i) => `${i + 3} ${offsets[0]}`).join(' ')
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { header: repeat }), 10)).toBeNull()
    // 0 and 00 are the same offset to pdf-lib.
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { header: () => '3 0 4 00' }), 10)).toBeNull()
    // A comment pdf-lib would read past could hide more entries.
    expect(countPdfPageMarkers(objectStreamPdf(['<< /Type /Page >>'], { header: () => '3 0 % 4 0' }), 10)).toBeNull()
  })

  // The case this exists for: 300,000 pages compressed into a few MB.
  it('refuses 300,000 pages in an object stream quickly', () => {
    const file = crafted(300_000)
    expect(file.byteLength).toBeLessThan(25 * 1024 * 1024)
    const started = performance.now()
    const count = countPdfPageMarkers(file, MAX_MEMBER_PDF_PAGES * 5)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(count === null || count > MAX_MEMBER_PDF_PAGES).toBe(true)
  })

  // More than the inflate budget holds is "can't tell", never a partial count.
  it('stops inflating at its budget', () => {
    const header = Array.from({ length: 1_500_000 }, (_, i) => `${i + 3} ${i * 7}`).join(' ')
    const file = objectStreamPdf(['<< /Type /Page >>'], { header: () => header })
    const started = performance.now()
    expect(countPdfPageMarkers(file, 250)).toBeNull()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('can’t tell a file of more object streams than any 50-page PDF has', () => {
    const one = join('<< /Type /ObjStm /Filter /FlateDecode >>\nstream\n', deflateSync(Buffer.from('3 0\nnull')), '\nendstream\n')
    const many = join('%PDF-1.7\n', ...Array.from({ length: MAX_OBJECT_STREAMS + 1 }, () => one))
    expect(countPdfPageMarkers(many, 250)).toBeNull()
  })

  // Every pass is linear: 25MB of the worst each branch can be fed stays well
  // under a second.
  describe('25MB of hostile input', () => {
    const MB25 = 25 * 1024 * 1024
    const fill = (unit: string) => {
      const b = Buffer.alloc(MB25, unit, 'latin1')
      b.write('%PDF-1.7\n', 0, 'latin1')
      return new Uint8Array(b.buffer, b.byteOffset, b.length)
    }
    const cases: [string, () => Uint8Array][] = [
      ['a /Type before every gap', () => fill(`/Type${' '.repeat(30)}/X`)],
      ['nothing but /Type', () => fill('/Type')],
      ['escaped names', () => fill('/#54#79#70#65 /#50#61#67#66 ')],
      ['long names', () => fill(`/${'T'.repeat(200)} `)],
      ['nothing but stream keywords', () => fill('stream\n')],
      ['endstream after endstream', () => fill('endstream\n')],
      ['object streams that run to the end of the file', () => fill('/ObjStm/Filter/FlateDecode stream\n')],
      ['uncompressed object streams', () => fill('/ObjStm stream\n1 0 2 1 ')],
      ['slashes', () => fill('/')],
    ]
    for (const [name, make] of cases) {
      it(name, () => {
        const b = make()
        const started = performance.now()
        const count = countPdfPageMarkers(b, 250)
        expect(performance.now() - started).toBeLessThan(1000)
        expect(count === null || count >= 0).toBe(true)
      })
    }
  })

  // The worker loads lib/pdf-page-count.ts from source with Node's own type
  // stripping, so that module must import nothing but Node built-ins up top.
  it('refuses the 300,000-page file within a 64MB heap', async () => {
    const worker = new Worker(
      `const { parentPort, workerData } = require('node:worker_threads')
       const { deflateSync } = require('node:zlib')
       import(workerData.source).then(({ countPdfPageMarkers }) => {
         const kids = Array.from({ length: 300000 }, (_, i) => (i + 4) + ' 0 R').join(' ')
         const objects = ['<< /Type /Pages /Kids [' + kids + '] >>']
         for (let i = 0; i < 300000; i++) objects.push('<< /Type /Page /Parent 3 0 R >>')
         const offsets = []
         let body = ''
         for (const o of objects) { offsets.push(body.length); body += o + '\\n' }
         const header = offsets.map((off, i) => (i + 3) + ' ' + off).join(' ')
         const data = deflateSync(Buffer.from(header + '\\n' + body, 'latin1'))
         const file = Buffer.concat([
           Buffer.from('%PDF-1.7\\n4 0 obj\\n<< /Type /ObjStm /First ' + (header.length + 1) + ' /Filter /FlateDecode >>\\nstream\\n'),
           data,
           Buffer.from('\\nendstream\\nendobj\\n%%EOF\\n'),
         ])
         objects.length = 0; body = ''
         parentPort.postMessage(countPdfPageMarkers(new Uint8Array(file.buffer, file.byteOffset, file.length), 250))
       })`,
      {
        eval: true,
        workerData: { source: pathToFileURL(`${import.meta.dirname}/pdf-page-count.ts`).href },
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
    // Too much to inflate within the budget, or counted past the cap: either way, refused.
    expect([null, 251]).toContain(outcome)
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
    expect(await checkPdfPageLimit(crafted(300_000), 50)).not.toBe('ok')
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
    expect(countPdfPageMarkers(await appendCopies(50, 10), 250)).toBe(60)
    expect(await checkPdfPageLimit(await appendCopies(50, 10), 50)).toBe('ok')
    expect(await checkPdfPageLimit(await appendCopies(51, 10), 50)).toBe('over')
  })

  it('reports what it can’t tell', async () => {
    expect(await checkPdfPageLimit(objectStreamPdf(['<< /Type /Page >>'], { filter: '/Filter /LZWDecode' }), 50)).toBe(
      'unknown',
    )
  })
})
