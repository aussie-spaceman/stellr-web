// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pngDataUrl as dataUrl, testPng } from '@/test/png'
import { parseSignatureImage } from './signature-image'

describe('parseSignatureImage', () => {
  it('accepts a small PNG and returns its bytes', async () => {
    const png = testPng()
    const out = await parseSignatureImage(dataUrl(png))
    expect(out).toEqual({ ok: true, png })
  })

  it('refuses anything that is not a readable PNG of sensible size', async () => {
    expect((await parseSignatureImage('not a data url')).ok).toBe(false)
    expect((await parseSignatureImage(dataUrl(testPng(), 'image/svg+xml'))).ok).toBe(false)
    // PNG content type, but the bytes are not a PNG.
    expect((await parseSignatureImage(dataUrl(new TextEncoder().encode('<svg onload=alert(1)>'.repeat(10))))).ok).toBe(false)
    // A PNG header followed by junk.
    const broken = testPng().slice()
    broken.fill(7, 20)
    expect((await parseSignatureImage(dataUrl(broken))).ok).toBe(false)
    // Too big to be a signature.
    expect((await parseSignatureImage(`data:image/png;base64,${'A'.repeat(300_000)}`)).ok).toBe(false)
    expect((await parseSignatureImage(dataUrl(testPng(3000, 40)))).ok).toBe(false)
    expect((await parseSignatureImage(42)).ok).toBe(false)
  })
})
