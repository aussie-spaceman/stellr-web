import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { watermarkImageBuffer } from './image'

function solid(width: number, height: number, format: 'jpeg' | 'png' | 'webp' | 'avif') {
  const img = sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } })
  return img[format]().toBuffer()
}

describe('watermarkImageBuffer', () => {
  it('changes the pixels and preserves dimensions + format (jpeg)', async () => {
    const input = await solid(1200, 800, 'jpeg')
    const out = await watermarkImageBuffer(input)
    expect(out.equals(input)).toBe(false)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(800)
  })

  it('preserves png format', async () => {
    const out = await watermarkImageBuffer(await solid(600, 600, 'png'))
    expect((await sharp(out).metadata()).format).toBe('png')
  })

  it('skips images below the legibility threshold', async () => {
    const tiny = await solid(64, 64, 'jpeg')
    const out = await watermarkImageBuffer(tiny)
    expect(out).toBe(tiny) // returned untouched
  })

  it('honours a forced output format (raster fallback path)', async () => {
    const png = await solid(1000, 700, 'png')
    const out = await watermarkImageBuffer(png, { outputFormat: 'avif' })
    expect((await sharp(out).metadata()).format).toBe('heif') // avif reports as heif
  })
})
