// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { PDFDocument, PDFName, PDFRef, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'
import {
  PDF_QUEUE_MAX_WAIT_MS,
  PDF_WORKER_EXTERNAL_MB,
  PDF_WORKER_TIMEOUT_MS,
  countPdfPagesSandboxed,
  exhaustBuffersSandboxed,
  exhaustMemorySandboxed,
  stampPdfSandboxed,
} from './pdf-sandbox'
import { MAX_MEMBER_PDF_PAGES, checkPdfPageLimit, scanPdfPages } from './pdf-page-count'
import { GB, MB, bombPdf } from './pdf-bombs.test.helper'
import { WATERMARK_MARKER } from './watermark/config'
import { expectWithin } from '@/test/time-budget'

// The sandbox (lib/pdf-sandbox.ts) is the bound on what a member's PDF can make
// pdf-lib do: a worker thread with a heap limit and a wall-clock timeout. These
// run the real worker — the files below really hang or exhaust pdf-lib — with a
// short timeout, so a regression fails here instead of hanging the suite.

// The sandbox records stopped jobs in app_errors; not here.
const { captureRequestError } = vi.hoisted(() => ({ captureRequestError: vi.fn(async () => {}) }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError }))

const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))

// ── Crafted files (each one bypassed an earlier round of the scan) ──────────

const HEAD =
  '%PDF-1.7\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 9 9]>> endobj\n'
const TAIL = 'trailer <</Root 1 0 R>>\n%%EOF\n'
const xrefStream = (before: string, dict: string) =>
  enc(`${HEAD}${before}6 0 obj <</Type/XRef${dict}/Root 1 0 R/Length 3>> stream\nabc\nendstream endobj\n${TAIL}`)

/** A negative /Length pointing back at an `endstream` in a comment: pdf-lib loops forever. */
function backwardsLength(): Uint8Array {
  const pre = `${HEAD}% `
  const anchor = pre.length
  const mid = 'endstream\n4 0 obj <</Length '
  let length = 0
  for (let i = 0; i < 3; i++) length = anchor - (pre + mid + String(length) + '>> stream\n').length
  return enc(`${pre}${mid}${length}>> stream\nxx\nendstream endobj\n${TAIL}`)
}

const CRAFTED: Record<string, () => Uint8Array> = {
  'negative /Length (the original hang)': backwardsLength,
  // A comment inside the `N G R` of an xref stream's /W, /Size or /Index: the
  // scan read the number N, pdf-lib follows the reference.
  'A1 /W reference, comment between N and G': () => xrefStream('5 0 obj [1 2000000000 1] endobj\n', '/Size 1/W 5 %c\n0 R'),
  'A2 /W reference, comment between G and R': () => xrefStream('5 0 obj [1 2000000000 1] endobj\n', '/Size 1/W 5 0 %c\nR'),
  'A3 /Size reference, comment inside': () => xrefStream('5 0 obj 300000000 endobj\n', '/Size 5 %c\n0 R/W [0 0 0]'),
  'A4 /Index reference, comment inside': () => xrefStream('5 0 obj [0 300000000] endobj\n', '/Size 1/Index 5 %c\n0 R/W [0 0 0]'),
  'xref /W stall': () => xrefStream('', '/W [1 2000000000 1]/Size 1'),
}

// ── Ordinary files ──────────────────────────────────────────────────────────

async function textPdf(pages: number, useObjectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 18, font })
  return doc.save({ useObjectStreams })
}

async function photoPdf(useObjectStreams: boolean): Promise<Uint8Array> {
  const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .jpeg()
    .toBuffer()
  const doc = await PDFDocument.create()
  const image = await doc.embedJpg(jpeg)
  doc.addPage([320, 240]).drawImage(image, { x: 0, y: 0, width: 320, height: 240 })
  return doc.save({ useObjectStreams })
}

/** A saved PDF with an incremental update appended that adds a page. */
async function incremental(): Promise<Uint8Array> {
  const saved = Buffer.from(await textPdf(3, false)).toString('latin1')
  const doc = await PDFDocument.load(enc(saved))
  const tree = doc.catalog.get(PDFName.of('Pages')) as PDFRef
  const root = doc.context.trailerInfo.Root as PDFRef
  const kids = doc.catalog.Pages().Kids().asArray().map(String).join(' ')
  const update =
    `90 0 obj\n<< /Type /Page /Parent ${tree} /MediaBox [0 0 612 792] >>\nendobj\n` +
    `${tree.objectNumber} 0 obj\n<< /Type /Pages /Count 4 /Kids [${kids} 90 0 R] >>\nendobj\n` +
    `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 91 /Root ${root} /Prev 0 >>\nstartxref\n0\n%%EOF\n`
  return enc(saved + update)
}

const pagesOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
const keywordsOf = async (bytes: Uint8Array) => (await PDFDocument.load(bytes, { updateMetadata: false })).getKeywords() ?? ''

// ── Tests ───────────────────────────────────────────────────────────────────

const SHORT = 2_500

describe('crafted PDFs', () => {
  for (const [name, make] of Object.entries(CRAFTED)) {
    it(`${name}: refused by the scan`, () => {
      expect(scanPdfPages(make())).toBeNull()
    })

    it(`${name}: refused by the sandbox within its timeout`, async () => {
      const started = performance.now()
      const stamped = await stampPdfSandboxed(make(), { timeoutMs: SHORT })
      const elapsed = performance.now() - started
      expect(stamped.ok).toBe(false)
      // Refused, whichever way pdf-lib went: looped (timeout), ran out of heap
      // (memory), or threw. (The worker's own check bounds only what a load
      // inflates, so these numbers reach pdf-lib.)
      if (!stamped.ok) expect(['timeout', 'memory', 'crash', 'invalid']).toContain(stamped.reason)
      expect(elapsed).toBeLessThan(SHORT + 2_000)
    }, 20_000)
  }

  it('A1–A4 and the negative /Length are refused by the upload check, which never loads them', async () => {
    for (const make of Object.values(CRAFTED)) expect(await checkPdfPageLimit(make(), MAX_MEMBER_PDF_PAGES)).toBe('unknown')
  })

  it('the hangs are real: the sandbox stops them at the timeout, and logs it', async () => {
    captureRequestError.mockClear()
    const hang = await stampPdfSandboxed(backwardsLength(), { timeoutMs: 1_500 })
    expect(hang).toMatchObject({ ok: false, reason: 'timeout' })
    const stall = await countPdfPagesSandboxed(CRAFTED['xref /W stall'](), 50, { timeoutMs: 1_500 })
    expect(stall.ok).toBe(false)
    if (!stall.ok) expect(['timeout', 'memory']).toContain(stall.reason)
    expect(captureRequestError).toHaveBeenCalledTimes(2)
  }, 20_000)

  it('the main thread keeps running while a worker spins', async () => {
    let ticks = 0
    const interval = setInterval(() => ticks++, 50)
    await stampPdfSandboxed(backwardsLength(), { timeoutMs: 1_500 })
    clearInterval(interval)
    // ~30 ticks in 1.5 s; a blocked event loop would manage one.
    expect(ticks).toBeGreaterThan(10)
  }, 20_000)
})

describe('a worker that dies', () => {
  it('is refused, not thrown, when it runs out of heap', async () => {
    const result = await exhaustMemorySandboxed({ timeoutMs: 15_000, heapMb: 32 })
    expect(result).toMatchObject({ ok: false, reason: 'memory' })
  }, 30_000)
})

// A heap limit isn't a memory limit: ArrayBuffers live outside it. The
// verified HIGH was a 4 MB PDF whose object stream pdf-lib inflated to GBs of
// buffers under a 256 MB heap limit, stopped only by the timeout.
describe('memory outside the heap', () => {
  it('the watchdog terminates a worker whose buffers pass its limit', async () => {
    const started = performance.now()
    const result = await exhaustBuffersSandboxed({ timeoutMs: 15_000, heapMb: 32, externalMb: 64 })
    expect(result).toMatchObject({ ok: false, reason: 'memory' })
    if (!result.ok) expect(result.detail).toMatch(/watchdog/)
    // Long before the timeout: ~64 MB at 1 MB every 2 ms, then one poll.
    expectWithin(started, 5_000)
  }, 30_000)

  it('the bomb is real: pdf-lib, unscanned, grows past the watchdog, which stops it', async () => {
    const started = performance.now()
    const result = await stampPdfSandboxed(bombPdf(512 * MB), {
      timeoutMs: 15_000,
      externalMb: 128,
      allowTestOps: true,
      skipScan: true,
    })
    expect(result).toMatchObject({ ok: false, reason: 'memory' })
    if (!result.ok) expect(result.detail).toMatch(/watchdog/)
    expectWithin(started, 10_000)
  }, 30_000)

  it('the worker’s own scan refuses the 4 GB bomb before pdf-lib opens it', async () => {
    const started = performance.now()
    for (const run of [stampPdfSandboxed, (b: Uint8Array) => countPdfPagesSandboxed(b, 50)]) {
      expect(await run(bombPdf(4 * GB))).toMatchObject({ ok: false, reason: 'refused' })
    }
    expectWithin(started, 5_000)
    // And the upload check never gets that far.
    expect(await checkPdfPageLimit(bombPdf(4 * GB), MAX_MEMBER_PDF_PAGES)).toBe('unknown')
  }, 30_000)

  it('has a 384 MB watchdog', () => {
    expect(PDF_WORKER_EXTERNAL_MB).toBe(384)
  })
})

describe('waiting for a worker', () => {
  it('refuses a job as busy when no worker comes free in time', async () => {
    // Both workers spin on the negative-/Length hang until their timeout.
    const hangs = [stampPdfSandboxed(backwardsLength(), { timeoutMs: 3_000 }), stampPdfSandboxed(backwardsLength(), { timeoutMs: 3_000 })]
    const started = performance.now()
    const queued = await stampPdfSandboxed(await textPdf(1, false), { queueWaitMs: 300 })
    expect(queued).toMatchObject({ ok: false, reason: 'busy' })
    expectWithin(started, 1_500)
    expect((await Promise.all(hangs)).map((r) => r.ok)).toEqual([false, false])
    // The slots are free again.
    expect((await stampPdfSandboxed(await textPdf(1, false))).ok).toBe(true)
  }, 30_000)

  it('runs a queued job once a worker comes free in time', async () => {
    const hangs = [stampPdfSandboxed(backwardsLength(), { timeoutMs: 800 }), stampPdfSandboxed(backwardsLength(), { timeoutMs: 800 })]
    const queued = await stampPdfSandboxed(await textPdf(1, false), { queueWaitMs: 5_000 })
    expect(queued.ok).toBe(true)
    await Promise.all(hangs)
  }, 30_000)

  it('waits at most 10 s by default', () => {
    expect(PDF_QUEUE_MAX_WAIT_MS).toBe(10_000)
  })
})

describe('ordinary PDFs through the sandbox', () => {
  it('stamps a 50-page PDF', async () => {
    for (const useObjectStreams of [false, true]) {
      const file = await textPdf(50, useObjectStreams)
      const stamped = await stampPdfSandboxed(file)
      expect(stamped.ok).toBe(true)
      if (!stamped.ok) return
      expect(await pagesOf(stamped.value)).toBe(50)
      expect(await keywordsOf(stamped.value)).toContain(WATERMARK_MARKER)
    }
  }, 30_000)

  it('stamps photo PDFs', async () => {
    for (const useObjectStreams of [false, true]) {
      const file = await photoPdf(useObjectStreams)
      expect(await checkPdfPageLimit(file, MAX_MEMBER_PDF_PAGES)).toBe('ok')
      const stamped = await stampPdfSandboxed(file)
      expect(stamped.ok).toBe(true)
      if (stamped.ok) expect(await pagesOf(stamped.value)).toBe(1)
    }
  }, 30_000)

  it('stamps an incrementally updated PDF', async () => {
    const file = await incremental()
    expect(await pagesOf(file)).toBe(4)
    expect(await checkPdfPageLimit(file, MAX_MEMBER_PDF_PAGES)).toBe('ok')
    const stamped = await stampPdfSandboxed(file)
    expect(stamped.ok).toBe(true)
    if (stamped.ok) expect(await pagesOf(stamped.value)).toBe(4)
  }, 30_000)

  it('counts pages in the sandbox when the scan bound is over the cap', async () => {
    // Every object in an object stream counts toward the scan's bound, so a
    // 50-page object-stream file is settled by loading it.
    const file = await textPdf(50, true)
    expect(scanPdfPages(file)!.bound).toBeGreaterThan(50)
    expect(await checkPdfPageLimit(file, 50)).toBe('ok')
    expect(await checkPdfPageLimit(await textPdf(51, true), 50)).toBe('over')
    expect(await countPdfPagesSandboxed(file, 50)).toEqual({ ok: true, value: 50 })
  }, 30_000)

  it('reports a file pdf-lib throws on as invalid, and does not log it', async () => {
    captureRequestError.mockClear()
    const result = await stampPdfSandboxed(enc('%PDF-1.7\nnot a pdf at all\n'))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    expect(captureRequestError).not.toHaveBeenCalled()
  }, 30_000)

  it('has an 8 s default timeout', () => {
    expect(PDF_WORKER_TIMEOUT_MS).toBe(8_000)
  })
})
