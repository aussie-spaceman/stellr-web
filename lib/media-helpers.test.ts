import { describe, expect, it } from 'vitest'
import { mediaUrl, sizedPath, sizedSrcSet, sizedWidths } from './media-helpers'

// The slides and posters render from WebP copies that scripts/upload-media.ts
// cuts at sizedWidths(); the manifest builds the srcset from the same function,
// so these names must match what the script uploads.
describe('sizedWidths', () => {
  it('cuts every step from a source wider than the largest', () => {
    expect(sizedWidths(2400)).toEqual([640, 1080, 1600])
  })

  it('caps at the source width instead of upscaling', () => {
    expect(sizedWidths(1600)).toEqual([640, 1080, 1600])
    expect(sizedWidths(1280)).toEqual([640, 1080, 1280])
    expect(sizedWidths(720)).toEqual([640, 720])
  })

  it('keeps a single copy for a source at or below the smallest step', () => {
    expect(sizedWidths(640)).toEqual([640])
    expect(sizedWidths(500)).toEqual([500])
  })
})

describe('sizedPath', () => {
  it('swaps the extension for -<width>.webp, next to the original', () => {
    expect(sizedPath('/media/2026-10/student-work-2026-1.png', 640)).toBe('/media/2026-10/student-work-2026-1-640.webp')
    expect(sizedPath('videos/2026-10/testimonial-mia-cox.poster.jpg', 1080)).toBe(
      'videos/2026-10/testimonial-mia-cox.poster-1080.webp',
    )
  })
})

describe('sizedSrcSet', () => {
  it('lists each copy on the media host with its width descriptor', () => {
    const poster = '/videos/2026-10/testimonial-mia-cox.poster.jpg'
    expect(sizedSrcSet(poster, 1280)).toBe(
      [640, 1080, 1280].map((w) => `${mediaUrl(`/videos/2026-10/testimonial-mia-cox.poster-${w}.webp`)} ${w}w`).join(', '),
    )
  })
})
