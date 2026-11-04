import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'

// checkPdfPageLimit loads a file only in the sandbox (lib/pdf-sandbox.ts). What
// it makes of each way the sandbox can answer; the sandbox itself is tested in
// pdf-sandbox.test.ts with the real worker.

const { countPdfPagesSandboxed } = vi.hoisted(() => ({ countPdfPagesSandboxed: vi.fn() }))
vi.mock('@/lib/pdf-sandbox', () => ({ countPdfPagesSandboxed }))

import { checkPdfPageLimit, scanPdfPages } from './pdf-page-count'

/** 50 pages in object streams: the scan's bound is over 50, so it is loaded. */
async function needsLoad(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < 50; i++) doc.addPage([612, 792])
  return doc.save({ useObjectStreams: true })
}

beforeEach(() => countPdfPagesSandboxed.mockReset())

describe('checkPdfPageLimit and the sandbox', () => {
  it('settles a bound over the cap by the sandbox’s count', async () => {
    const file = await needsLoad()
    expect(scanPdfPages(file)!.bound).toBeGreaterThan(50)
    countPdfPagesSandboxed.mockResolvedValue({ ok: true, value: 50 })
    expect(await checkPdfPageLimit(file, 50)).toBe('ok')
    countPdfPagesSandboxed.mockResolvedValue({ ok: true, value: 51 })
    expect(await checkPdfPageLimit(file, 50)).toBe('over')
    countPdfPagesSandboxed.mockResolvedValue({ ok: true, value: null })
    expect(await checkPdfPageLimit(file, 50)).toBe('unknown')
    expect(countPdfPagesSandboxed).toHaveBeenCalledWith(file, 50)
  })

  it('is "failed" when the sandbox had to stop pdf-lib, "unknown" when pdf-lib threw', async () => {
    const file = await needsLoad()
    for (const reason of ['timeout', 'memory', 'crash', 'refused']) {
      countPdfPagesSandboxed.mockResolvedValue({ ok: false, reason, detail: 'stopped' })
      expect(await checkPdfPageLimit(file, 50), reason).toBe('failed')
    }
    countPdfPagesSandboxed.mockResolvedValue({ ok: false, reason: 'invalid', detail: 'parse error' })
    expect(await checkPdfPageLimit(file, 50)).toBe('unknown')
  })

  it('is "busy" when no worker came free in time: the file wasn’t judged', async () => {
    const file = await needsLoad()
    countPdfPagesSandboxed.mockResolvedValue({ ok: false, reason: 'busy', detail: 'no free PDF worker in 10000 ms' })
    expect(await checkPdfPageLimit(file, 50)).toBe('busy')
  })

  it('never reaches the sandbox for a file the scan settles', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    expect(await checkPdfPageLimit(await doc.save({ useObjectStreams: false }), 50)).toBe('ok')
    expect(countPdfPagesSandboxed).not.toHaveBeenCalled()
  })
})
