import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { markWatermarked } from '@/lib/watermark/pdf'
import { tokens } from '@/lib/tokens'
import { BADGE_FORMATS, artworkBox, badgeName, nameSetting, placementFromLine, type BadgeFormat, type BadgePlacement } from '@/lib/badge-layout'

// Badge + certificate PDF generation (PRD 6.7).
// Badges: one label per person on Avery 5392 or 8395 stock (lib/badge-layout.ts).
// Certificates: one page per recipient, US Letter or A4 landscape. The artwork
// carries every word but the name; only the name is drawn (see below).

const PT_PER_IN = 72
const LETTER: [number, number] = [8.5 * PT_PER_IN, 11 * PT_PER_IN]
const LETTER_LANDSCAPE: [number, number] = [11 * PT_PER_IN, 8.5 * PT_PER_IN]
const A4_LANDSCAPE: [number, number] = [841.89, 595.28]

export interface BadgePerson {
  firstName: string
  lastName: string
  /** company label for students, role label for adults/mentors */
  subtitle: string
}

export interface Artwork {
  bytes: Uint8Array
  mime: string
}

async function embedArtwork(doc: PDFDocument, artwork: Artwork): Promise<PDFImage | null> {
  try {
    if (artwork.mime === 'image/png') return await doc.embedPng(artwork.bytes)
    if (artwork.mime === 'image/jpeg' || artwork.mime === 'image/jpg') return await doc.embedJpg(artwork.bytes)
  } catch (err) {
    console.error('[event-pdf] artwork embed failed:', err)
  }
  return null
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  centerX: number,
  y: number,
  maxWidth: number
) {
  // Shrink to fit so long names never overflow the badge/certificate
  let fitted = size
  while (fitted > 6 && font.widthOfTextAtSize(text, fitted) > maxWidth) fitted -= 0.5
  page.drawText(text, {
    x: centerX - font.widthOfTextAtSize(text, fitted) / 2,
    y,
    size: fitted,
    font,
    color: rgb(0.1, 0.1, 0.15),
  })
}

/** One template, ready to draw: prepared artwork, where the name goes, and its ink. */
export interface BadgeDesign {
  /** Same key → same embedded image; one per template. */
  key: string
  artwork: Artwork
  placement: BadgePlacement
  lightInk: boolean
}

export interface Badge {
  person: BadgePerson
  /** null: a plain badge — name, then role or company and the event. */
  design: BadgeDesign | null
}

/**
 * One label per badge on the chosen Avery sheet — or, with `single`, one page
 * the size of the label's artwork (the template preview). With a design, the
 * artwork is the whole design and the only thing drawn is the full name, on
 * one line, shrunk to the placement's width.
 *
 * No visible © stamp: on label stock it would print on a label. The watermark
 * marker is still set, as for certificates.
 */
export async function generateBadgesPdf(
  badges: Badge[],
  eventTitle: string,
  format: BadgeFormat,
  opts: { single?: boolean } = {},
): Promise<Uint8Array> {
  const spec = BADGE_FORMATS[format]
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const nameFont = await doc.embedFont(await loadNameFont(), { subset: false })
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const images = new Map<string, PDFImage | null>()
  for (const b of badges) {
    if (b.design && !images.has(b.design.key)) images.set(b.design.key, await embedArtwork(doc, b.design.artwork))
  }
  const ink = hexToRgb(tokens.color.ink)
  const bleed = spec.bleed * PT_PER_IN
  const [, pageH] = LETTER
  const perPage = opts.single ? 1 : spec.cols * spec.rows
  const single = artworkBox(format)

  let page: PDFPage | null = null
  badges.forEach((badge, i) => {
    const j = i % perPage
    if (j === 0) page = doc.addPage(opts.single ? [single.width, single.height] : LETTER)
    const col = j % spec.cols
    const row = Math.floor(j / spec.cols)
    const label = opts.single
      ? { x: bleed, y: bleed, width: spec.width * PT_PER_IN, height: spec.height * PT_PER_IN }
      : {
          x: (spec.left + col * spec.pitchX) * PT_PER_IN,
          y: pageH - (spec.top + row * spec.pitchY + spec.height) * PT_PER_IN,
          width: spec.width * PT_PER_IN,
          height: spec.height * PT_PER_IN,
        }
    const box = { x: label.x - bleed, y: label.y - bleed, width: label.width + bleed * 2, height: label.height + bleed * 2 }
    const p = page as unknown as PDFPage

    const design = badge.design
    const image = design ? images.get(design.key) ?? null : null
    if (image) p.drawImage(image, box)
    if (spec.cutGuides || opts.single) {
      p.drawRectangle({ ...label, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 })
    }

    const name = badgeName(badge.person.firstName, badge.person.lastName)
    const set = nameSetting(box, image && design ? design.placement : placementFromLine(null, format))
    const size = fittedSize((s) => nameFont.widthOfTextAtSize(name, s), set.size, set.maxWidth)
    p.drawText(name, {
      x: set.centerX - nameFont.widthOfTextAtSize(name, size) / 2,
      y: set.baselineY,
      size,
      font: nameFont,
      color: image && design?.lightInk ? rgb(1, 1, 1) : ink,
    })

    if (!image) {
      const maxWidth = label.width - 24
      const centerX = label.x + label.width / 2
      drawCentered(p, badge.person.subtitle, regular, 12, centerX, set.baselineY - 28, maxWidth)
      drawCentered(p, eventTitle, regular, 8, centerX, label.y + 14, maxWidth)
    }
  })

  markWatermarked(doc)
  return doc.save()
}

// ── Certificates ─────────────────────────────────────────────────────────────
// The certificate artwork (one per award, event_certificate_templates) already
// says everything — title, award, citation, signatures. The only thing drawn is
// the recipient's name, centred in the space the artwork leaves for it.
//
// The artwork is cover-fitted (aspect kept, centre-cropped) rather than
// stretched, and the name's position is stored as fractions of the ARTWORK, so
// the name lands on the same rule whether the page is US Letter or A4.

export type PaperFormat = 'us_letter' | 'a4'

export function pageSizeFor(format: PaperFormat): [number, number] {
  return format === 'a4' ? A4_LANDSCAPE : LETTER_LANDSCAPE
}

export interface NamePlacement {
  /** Baseline, as a fraction of artwork height from the top. */
  nameY: number
  /** Widest the name may run, as a fraction of artwork width. */
  nameMaxWidth: number
  /** Starting size in points on US Letter; scaled with the artwork on A4. */
  nameSize: number
}

/** Where the Canva set leaves room: baseline just above the rule at 57%. */
export const DEFAULT_NAME_PLACEMENT: NamePlacement = { nameY: 0.545, nameMaxWidth: 0.5, nameSize: 40 }

export interface Fit {
  /** Bottom-left of the drawn image in page points (negative when cropped). */
  x: number
  y: number
  width: number
  height: number
}

/** Scale the image to cover the page, keep its aspect ratio, centre-crop. */
export function coverFit(imgW: number, imgH: number, pageW: number, pageH: number): Fit {
  const scale = Math.max(pageW / imgW, pageH / imgH)
  const width = imgW * scale
  const height = imgH * scale
  return { x: (pageW - width) / 2, y: (pageH - height) / 2, width, height }
}

export interface NameBox {
  centerX: number
  baselineY: number
  maxWidth: number
  size: number
}

/** Map artwork-relative placement to page points for a given fit. */
export function nameBox(fit: Fit, placement: NamePlacement, letterFitHeight: number): NameBox {
  return {
    centerX: fit.x + fit.width / 2,
    // PDF y runs up from the bottom; nameY runs down from the top of the art.
    baselineY: fit.y + fit.height * (1 - placement.nameY),
    maxWidth: fit.width * placement.nameMaxWidth,
    // The size was chosen against US Letter; keep it proportional to the art.
    size: placement.nameSize * (fit.height / letterFitHeight),
  }
}

/** Largest size ≤ `size` at which `text` fits `maxWidth` (floor 6pt). */
export function fittedSize(widthAt: (size: number) => number, size: number, maxWidth: number): number {
  let fitted = size
  while (fitted > 6 && widthAt(fitted) > maxWidth) fitted -= 0.5
  return fitted
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

// Aileron is the competition body face (CLAUDE.md: print materials only). Read
// from public/fonts at request time; next.config.mjs traces it into the routes
// that render certificates.
let aileron: Promise<Uint8Array> | null = null
function loadNameFont(): Promise<Uint8Array> {
  aileron ??= readFile(path.join(process.cwd(), 'public', 'fonts', 'Aileron-SemiBold.otf')).then((b) => new Uint8Array(b))
  return aileron
}

export interface CertificateRecipient {
  name: string
}

export class CertificateArtworkError extends Error {}

/**
 * One page per recipient: the artwork, then the name. Nothing else — the
 * visible © stamp is left off (the artwork is the whole design) but the
 * watermark marker is still set so nothing downstream re-stamps it.
 */
export async function generateCertificatesPdf(
  recipients: CertificateRecipient[],
  format: PaperFormat,
  artwork: Artwork,
  placement: NamePlacement = DEFAULT_NAME_PLACEMENT,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(await loadNameFont(), { subset: false })
  const image = await embedArtwork(doc, artwork)
  if (!image) throw new CertificateArtworkError('The certificate artwork could not be read. Upload it again as a PNG or JPEG.')

  const [pageW, pageH] = pageSizeFor(format)
  const fit = coverFit(image.width, image.height, pageW, pageH)
  const letterFit = coverFit(image.width, image.height, LETTER_LANDSCAPE[0], LETTER_LANDSCAPE[1])
  const box = nameBox(fit, placement, letterFit.height)
  const ink = hexToRgb(tokens.color.ink)

  for (const r of recipients) {
    const page = doc.addPage([pageW, pageH])
    page.drawImage(image, fit)
    const name = r.name.trim()
    if (!name) continue
    const size = fittedSize((s) => font.widthOfTextAtSize(name, s), box.size, box.maxWidth)
    page.drawText(name, {
      x: box.centerX - font.widthOfTextAtSize(name, size) / 2,
      y: box.baselineY,
      size,
      font,
      color: ink,
    })
  }

  markWatermarked(doc)
  return doc.save()
}
