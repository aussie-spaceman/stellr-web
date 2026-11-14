// Golden PDF hashes: Stellr's printed output, pinned byte for byte (PDF-HASH-TEST;
// S5 scope, the C19 events-admin conversion and the P8/P9 tenancy flips each list
// "a golden badge and certificate PDF hash for a Stellr fixture event").
//
// It renders a Stellr fixture event's Avery badge sheets and award certificates
// with fixed inputs through the generators the admin routes call
// (lib/event-pdf.ts generateBadgesPdf and generateCertificatesPdf), takes out the
// two things that change on every render, and compares SHA-256 hashes with
// test/fixtures/pdf-golden-hashes.json. A refactor that is meant to change
// nothing about what Stellr prints must leave every hash as it is.
//
// What is normalised, and why: pdf-lib stamps CreationDate and ModDate with the
// clock, inside a compressed object stream, so the raw bytes differ on every run.
// normalisedPdf() reopens the file without touching its metadata, sets both
// dates to a fixed instant, drops any trailer /ID, and writes it back out with
// no object streams. Everything else (page sizes, the artwork, the name's font,
// size and position, the QR codes, the watermark marker) is hashed as rendered.
// pdf-lib's own randomness (font and resource names) comes from a fixed seed,
// and images are decoded and re-compressed by pdf-lib's pure-JS deflate, so the
// hashes do not depend on the machine.
//
// Updating the hashes, deliberately: only when a change is MEANT to alter the
// printed output (new artwork handling, a font change, a layout fix). Run
//
//   UPDATE_PDF_GOLDEN=1 npx vitest run test/pdf-golden-hash.test.ts
//
// which rewrites the JSON with the new values, then review the diff and say in
// the PR which printed change each new hash stands for. Never update them to make
// an unrelated change pass: a moved hash on a refactor is the bug this exists to
// catch. To see what changed, write the PDF out (fs.writeFileSync in a scratch
// copy of the case) and compare it with one rendered from the base branch.
//
// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  DEFAULT_NAME_PLACEMENT,
  generateBadgesPdf,
  generateCertificatesPdf,
  type Artwork,
  type Badge,
  type BadgeDesign,
} from '@/lib/event-pdf'
import { placementFromLine, type BadgeFormat } from '@/lib/badge-layout'

const GOLDEN_FILE = path.join(process.cwd(), 'test', 'fixtures', 'pdf-golden-hashes.json')
const UPDATE = process.env.UPDATE_PDF_GOLDEN === '1'

/** The fixed instant both metadata dates are set to before hashing. */
const EPOCH = new Date('2000-01-01T00:00:00Z')

/** The PDF as rendered, with its clock-dependent metadata fixed (see the header). */
async function normalisedPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.setCreationDate(EPOCH)
  doc.setModificationDate(EPOCH)
  delete (doc.context.trailerInfo as { ID?: unknown }).ID
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false })
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

// ── Fixed inputs: the seed's fixture event (supabase/seed.sql) ──────────────

const EVENT_TITLE = 'Seed Regional Challenge (fixture)'
const CHECK_IN = 'https://app.example.test/check-in/seed-regional-challenge/code'

const PEOPLE = [
  { firstName: 'Ada', lastName: 'Student', subtitle: 'Company 1 · Aurora', qr: `${CHECK_IN}/fixture-ada` },
  { firstName: 'Sam', lastName: 'Tester', subtitle: 'Company 2 · Borealis', qr: `${CHECK_IN}/fixture-sam` },
  { firstName: 'Grace', lastName: 'Teacher', subtitle: 'Teacher', qr: `${CHECK_IN}/fixture-grace` },
  // Long enough to be shrunk to fit.
  { firstName: 'Maximiliana-Josephine', lastName: 'Featherstonehaugh-Wolfeschlegel', subtitle: 'Mentor', qr: null },
]

/** A spare: background only, no name (lib/badge-layout.ts spareCount). */
const SPARE = { firstName: '', lastName: '', subtitle: '', qr: null }

/**
 * A deterministic RGB PNG: horizontal bands and a darker frame, so the artwork
 * has structure for cover-fit cropping to act on. Built here, not read from a
 * binary fixture, so the input is visible in the diff.
 */
function fixtureArtwork(width: number, height: number): Artwork {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf: Buffer) => {
    let crc = 0xffffffff
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frame = x < 6 || y < 6 || x >= width - 6 || y >= height - 6
      const band = Math.floor((y / height) * 5)
      const rgb = frame ? [20, 26, 61] : [230 - band * 18, 236 - band * 12, 250 - band * 6]
      raw.set(rgb, y * row + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return { bytes: new Uint8Array(bytes), mime: 'image/png' }
}

const CERTIFICATE_ART = fixtureArtwork(400, 300) // the Canva set's 4:3
const BADGE_ART = fixtureArtwork(240, 330)

function badgeDesign(format: BadgeFormat, lightInk: boolean): BadgeDesign {
  return { key: `fixture-${format}`, artwork: BADGE_ART, placement: placementFromLine(null, format), lightInk }
}

// ── The cases ───────────────────────────────────────────────────────────────

const CASES: Record<string, () => Promise<Uint8Array>> = {
  // Plain badges (no artwork): name, role or company, the event, the QR code.
  'badges.avery_5392.plain': () =>
    generateBadgesPdf([...PEOPLE, SPARE].map((person): Badge => ({ person, design: null })), EVENT_TITLE, 'avery_5392'),
  // A full sheet and a second page on the smaller stock, on artwork, dark ink.
  'badges.avery_8395.artwork': () =>
    generateBadgesPdf(
      Array.from({ length: 10 }, (_, i): Badge => ({ person: i < PEOPLE.length ? PEOPLE[i] : SPARE, design: badgeDesign('avery_8395', false) })),
      EVENT_TITLE,
      'avery_8395',
    ),
  // The template preview: one label-sized page, light ink on the artwork.
  'badges.avery_5392.single-preview': () =>
    generateBadgesPdf([{ person: PEOPLE[0], design: badgeDesign('avery_5392', true) }], EVENT_TITLE, 'avery_5392', { single: true }),
  // An award certificate on US Letter at the default name position.
  'certificate.us_letter.default-placement': () =>
    generateCertificatesPdf(PEOPLE.map((p) => ({ name: `${p.firstName} ${p.lastName}` })), 'us_letter', CERTIFICATE_ART),
  // The same artwork on A4, with a placement moved by the admin's sliders.
  'certificate.a4.custom-placement': () =>
    generateCertificatesPdf(
      [{ name: 'Ada Student' }, { name: '   ' }],
      'a4',
      CERTIFICATE_ART,
      { ...DEFAULT_NAME_PLACEMENT, nameY: 0.62, nameMaxWidth: 0.4, nameSize: 52 },
    ),
}

function readGolden(): Record<string, string> {
  const file = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) as { hashes: Record<string, string> }
  return file.hashes
}

describe('golden PDF hashes for a Stellr fixture event', () => {
  it('the normalisation takes out the clock and nothing else', async () => {
    const at = async (iso: string) => {
      // pdf-lib reads the clock through `new Date()` when it creates a document.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(iso))
      try {
        return await CASES['certificate.us_letter.default-placement']()
      } finally {
        vi.useRealTimers()
      }
    }
    const morning = await at('2026-11-14T08:00:00Z')
    const evening = await at('2027-03-02T21:30:00Z')
    expect(sha256(morning), 'renders at different times differ before normalising').not.toBe(sha256(evening))
    expect(sha256(await normalisedPdf(morning))).toBe(sha256(await normalisedPdf(evening)))

    const normal = await PDFDocument.load(await normalisedPdf(morning), { updateMetadata: false })
    expect(normal.getCreationDate()?.toISOString()).toBe(EPOCH.toISOString())
    expect(normal.getModificationDate()?.toISOString()).toBe(EPOCH.toISOString())
    // The watermark marker survives: nothing downstream re-stamps a certificate.
    expect(normal.getKeywords()).toContain('stellr-watermarked')
  })

  it('every case matches its pinned SHA-256', async () => {
    const actual: Record<string, string> = {}
    for (const [name, render] of Object.entries(CASES)) actual[name] = sha256(await normalisedPdf(await render()))

    if (UPDATE) {
      const file = JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) as Record<string, unknown>
      writeFileSync(GOLDEN_FILE, `${JSON.stringify({ ...file, hashes: actual }, null, 2)}\n`)
      return
    }
    expect(actual).toEqual(readGolden())
  })

  it('pins every case, and only these', () => {
    expect(Object.keys(readGolden()).sort()).toEqual(Object.keys(CASES).sort())
  })
})
