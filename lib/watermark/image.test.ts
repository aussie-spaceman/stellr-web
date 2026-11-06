import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { WATERMARK_TEXT, watermarkGeometry } from './config'
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

  it('marks only the bottom-right corner', async () => {
    const width = 1080
    const height = 634
    const input = await sharp({ create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } } }).png().toBuffer()
    const out = await watermarkImageBuffer(input)
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
    let minX = width
    let minY = height
    let changed = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * info.channels
        if (data[i] !== 40 || data[i + 1] !== 90 || data[i + 2] !== 160) {
          changed++
          minX = Math.min(minX, x)
          minY = Math.max(0, Math.min(minY, y))
        }
      }
    }
    expect(changed).toBeGreaterThan(200)
    expect(minX).toBeGreaterThan(width / 2)
    expect(minY).toBeGreaterThan(height - 80)
  })

  it('does not cut the mark off inside the corner', async () => {
    // Text touching the corner's left edge would mean the corner is too narrow.
    const { fontSize, margin } = watermarkGeometry(1080, 634)
    const input = await solid(1080, 634, 'png')
    const out = await watermarkImageBuffer(input)
    const cornerWidth = Math.ceil(fontSize * 0.75 * WATERMARK_TEXT.length) + margin
    const { data, info } = await sharp(out)
      .extract({ left: 1080 - cornerWidth, top: 634 - 40, width: 2, height: 40 })
      .raw()
      .toBuffer({ resolveWithObject: true })
    const colours = new Set<string>()
    for (let i = 0; i < data.length; i += info.channels) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    expect(colours.size).toBe(1)
  })

  it('stamps a small image narrower than the mark without failing', async () => {
    const out = await watermarkImageBuffer(await solid(100, 100, 'png'))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(100)
    expect(meta.height).toBe(100)
  })

  it('removes location and camera metadata', async () => {
    const input = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 40, g: 90, b: 160 } } })
      .withExif({ IFD3: { GPSLatitude: '40/1 0/1 0/1' }, IFD0: { Make: 'Test' } })
      .webp()
      .toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()
    const out = await watermarkImageBuffer(input, { webp: { quality: 75, effort: 2 } })
    expect((await sharp(out).metadata()).exif).toBeUndefined()
  })

  it('uses the WebP settings it is given, and otherwise the default', async () => {
    const input = await solid(1200, 800, 'webp')
    const smaller = await watermarkImageBuffer(input, { webp: { quality: 10, effort: 2 } })
    const standard = await watermarkImageBuffer(input)
    expect((await sharp(smaller).metadata()).format).toBe('webp')
    expect(smaller.length).toBeLessThan(standard.length)
  })

  it('honours a forced output format (raster fallback path)', async () => {
    const png = await solid(1000, 700, 'png')
    const out = await watermarkImageBuffer(png, { outputFormat: 'avif' })
    expect((await sharp(out).metadata()).format).toBe('heif') // avif reports as heif
  })
})
