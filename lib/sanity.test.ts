import { describe, it, expect } from 'vitest'
import { flyerDownloadUrl, type EventFlyer } from './sanity'

const CDN = 'https://cdn.sanity.io/files/proj/production/abc123.pdf'

function flyer(overrides: Partial<EventFlyer> = {}): EventFlyer {
  return { label: 'Event Flyer', url: CDN, ...overrides }
}

describe('flyerDownloadUrl', () => {
  // The CDN copies ?dl= straight into Content-Disposition, so an encoded name
  // is saved encoded — a file called "2027%20-%20SDC%20-%20NV…pdf". Verified
  // against the live CDN before this was normalised.
  it('produces a filename that needs no percent-encoding', () => {
    const url = flyerDownloadUrl(flyer({ filename: '2027 - SDC - NV - Flyer 3pp.pdf' }))
    expect(url).toBe(`${CDN}?dl=2027-SDC-NV-Flyer-3pp.pdf`)
    expect(url).toBe(encodeURI(url))
  })

  it('keeps a single .pdf extension', () => {
    expect(flyerDownloadUrl(flyer({ filename: 'flyer.PDF' }))).toBe(`${CDN}?dl=flyer.pdf`)
  })

  it('falls back to the label when there is no filename', () => {
    expect(flyerDownloadUrl(flyer({ label: 'Homeschool Flyer' }))).toBe(
      `${CDN}?dl=Homeschool-Flyer.pdf`,
    )
  })

  it('never emits a bare or dangling name', () => {
    expect(flyerDownloadUrl(flyer({ label: '', filename: '   ' }))).toBe(`${CDN}?dl=flyer.pdf`)
    expect(flyerDownloadUrl(flyer({ filename: '— 2027 —.pdf' }))).toBe(`${CDN}?dl=2027.pdf`)
  })

  it('passes an empty url through untouched', () => {
    expect(flyerDownloadUrl(flyer({ url: '' }))).toBe('')
  })
})
