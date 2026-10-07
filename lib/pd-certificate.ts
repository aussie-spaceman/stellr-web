import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { markWatermarked } from '@/lib/watermark/pdf'
import { tokens } from '@/lib/tokens'
import { coverFit, embedArtwork, fittedSize, type Artwork, type Fit } from '@/lib/event-pdf'
import { describeStandard, formatPdHours } from '@/lib/pd-standards'

// ── Educator PD certificate ──────────────────────────────────────────────────
// One global background (the Cowork design, stored at PD_ARTWORK_PATH) with the
// person-specific fields drawn over it. Unlike the award certificates, the
// artwork cannot say everything: hours, event, date, place, standards and the
// verification number differ per certificate, so all of them are drawn here.
//
// Positions are fractions of the ARTWORK (cover-fitted, as lib/event-pdf.ts
// does), so a field lands on the same rule however the art is cropped. Tune
// PD_LAYOUT to the Cowork artwork; nothing else needs to change.
//
// With no artwork uploaded the same fields are drawn on a plain page, so a
// certificate can be issued before the design lands.
// Design: docs/PLAN-educator-pd-2026-10-07.md §4.

/** Where the current artwork lives in the community-resources bucket. */
export const PD_ARTWORK_PATH = 'pd-certificate/current'

const LETTER_LANDSCAPE: [number, number] = [792, 612]

export interface PdCertificateFields {
  recipientName: string
  hours: number
  eventTitle: string
  /** YYYY-MM-DD. */
  activityDate: string | null
  activityLocation: string | null
  standards: string[]
  number: string
  /** stellreducation.org/credentials/<number>, scheme stripped. */
  verifyUrl: string
  issuer: string
}

export type PdSlot = 'name' | 'statement' | 'event' | 'when' | 'ngss' | 'ccss' | 'verify'

export interface SlotPlacement {
  /** Baseline, fraction of artwork height from the top. */
  y: number
  /** Widest the line may run, fraction of artwork width. */
  maxWidth: number
  /** Starting size in points on US Letter; shrinks to fit. */
  size: number
  weight: 'semibold' | 'regular'
  color: 'ink' | 'muted' | 'accent'
}

export const PD_LAYOUT: Record<PdSlot, SlotPlacement> = {
  name:      { y: 0.40, maxWidth: 0.60, size: 36, weight: 'semibold', color: 'ink' },
  statement: { y: 0.48, maxWidth: 0.70, size: 14, weight: 'regular',  color: 'muted' },
  event:     { y: 0.555, maxWidth: 0.70, size: 20, weight: 'semibold', color: 'accent' },
  when:      { y: 0.61, maxWidth: 0.70, size: 12, weight: 'regular',  color: 'muted' },
  // Standards may wrap to two lines (see drawSlot), so they get room below.
  ngss:      { y: 0.70, maxWidth: 0.80, size: 9,  weight: 'regular',  color: 'muted' },
  ccss:      { y: 0.785, maxWidth: 0.80, size: 9, weight: 'regular',  color: 'muted' },
  verify:    { y: 0.93, maxWidth: 0.80, size: 8,  weight: 'regular',  color: 'muted' },
}

/** A YYYY-MM-DD date as "October 4, 2026" — read as a calendar day, not an instant. */
export function formatActivityDate(isoDate: string | null): string | null {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

function standardsLine(codes: string[], framework: 'NGSS' | 'CCSS', heading: string): string {
  const parts = codes
    .map(describeStandard)
    .filter((s) => s.framework === framework)
    .map((s) => (s.label ? `${s.code} ${s.label}` : s.code))
  return parts.length ? `${heading}: ${parts.join(' · ')}` : ''
}

/** The text for each slot. Pure, so the wording is testable without a PDF. */
export function pdCertificateLines(f: PdCertificateFields): Record<PdSlot, string> {
  const unit = f.hours === 1 ? 'hour' : 'hours'
  const when = [formatActivityDate(f.activityDate), f.activityLocation?.trim() || null].filter(Boolean).join(' · ')
  return {
    name: f.recipientName.trim() || 'Educator',
    statement: `completed ${formatPdHours(f.hours)} ${unit} of professional development supporting`,
    event: f.eventTitle.trim(),
    when,
    ngss: standardsLine(f.standards, 'NGSS', 'NGSS'),
    ccss: standardsLine(f.standards, 'CCSS', 'Common Core'),
    verify: `Certificate No. ${f.number} · Verify at ${f.verifyUrl} · ${f.issuer}`,
  }
}

// Aileron is the competition print face (CLAUDE.md: print materials only).
// next.config.mjs traces both weights into the routes that render this.
const fontCache = new Map<string, Promise<Uint8Array>>()
function loadFont(file: string): Promise<Uint8Array> {
  let p = fontCache.get(file)
  if (!p) {
    p = readFile(path.join(process.cwd(), 'public', 'fonts', file)).then((b) => new Uint8Array(b))
    fontCache.set(file, p)
  }
  return p
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255)
}

/** Smallest size a line may shrink to before it wraps instead (print legibility). */
const MIN_PRINT_SIZE = 8

/**
 * A list joined by " · " that will not fit on one line at a printable size,
 * split into two lines at the separator nearest the middle. Anything else is
 * left as one line (and shrinks, as names do).
 */
export function wrapList(text: string, fits: (line: string) => boolean): string[] {
  const parts = text.split(' · ')
  if (parts.length < 2 || fits(text)) return [text]
  let best: string[] = [text]
  let bestDiff = Infinity
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join(' · ')
    const b = parts.slice(i).join(' · ')
    const diff = Math.abs(a.length - b.length)
    if (diff < bestDiff) { best = [a, b]; bestDiff = diff }
  }
  return best
}

function drawSlot(page: PDFPage, text: string, slot: SlotPlacement, fit: Fit, scale: number, fonts: Record<SlotPlacement['weight'], PDFFont>, accentHex: string) {
  if (!text) return
  const font = fonts[slot.weight]
  const maxWidth = fit.width * slot.maxWidth
  const start = slot.size * scale
  const sizeFor = (line: string) => fittedSize((s) => font.widthOfTextAtSize(line, s), start, maxWidth)
  const lines = wrapList(text, (line) => sizeFor(line) >= Math.min(start, MIN_PRINT_SIZE * scale))
  const size = Math.min(...lines.map(sizeFor))
  const color = hexToRgb(slot.color === 'ink' ? tokens.color.ink : slot.color === 'accent' ? accentHex : tokens.color.text.secondary)
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: fit.x + fit.width / 2 - font.widthOfTextAtSize(line, size) / 2,
      y: fit.y + fit.height * (1 - slot.y) - i * size * 1.35,
      size,
      font,
      color,
    })
  })
}

export class PdCertificateArtworkError extends Error {}

/**
 * One US Letter landscape page. `accentHex` follows the event theme on the
 * plain fallback (space violet / enviro green); on artwork it colours only the
 * event title.
 */
export async function renderPdCertificatePdf(
  fields: PdCertificateFields,
  artwork: Artwork | null,
  { accentHex = tokens.color.primary, layout = PD_LAYOUT }: { accentHex?: string; layout?: Record<PdSlot, SlotPlacement> } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const fonts = {
    semibold: await doc.embedFont(await loadFont('Aileron-SemiBold.otf'), { subset: false }),
    regular: await doc.embedFont(await loadFont('Aileron-Regular.otf'), { subset: false }),
  }
  const [pageW, pageH] = LETTER_LANDSCAPE
  const page = doc.addPage([pageW, pageH])
  let fit: Fit = { x: 0, y: 0, width: pageW, height: pageH }

  if (artwork) {
    const image = await embedArtwork(doc, artwork)
    if (!image) throw new PdCertificateArtworkError('The PD certificate artwork could not be read. Upload it again as a PNG or JPEG.')
    fit = coverFit(image.width, image.height, pageW, pageH)
    page.drawImage(image, fit)
  } else {
    // Plain fallback: accent rules, the heading the artwork would otherwise carry.
    const accent = hexToRgb(accentHex)
    page.drawRectangle({ x: 0, y: pageH - 14, width: pageW, height: 14, color: accent })
    page.drawRectangle({ x: 0, y: 0, width: pageW, height: 14, color: accent })
    const heading = (text: string, size: number, y: number, font: PDFFont, hex: string) =>
      page.drawText(text, { x: pageW / 2 - font.widthOfTextAtSize(text, size) / 2, y, size, font, color: hexToRgb(hex) })
    heading('STELLR EDUCATION', 13, pageH - 70, fonts.semibold, accentHex)
    heading('Certificate of Professional Development', 28, pageH - 140, fonts.semibold, tokens.color.ink)
    heading('This certifies that', 13, pageH - 190, fonts.regular, tokens.color.text.secondary)
  }

  // Sizes were chosen against US Letter; keep them proportional to the art.
  const scale = fit.height / pageH
  const lines = pdCertificateLines(fields)
  for (const slot of Object.keys(layout) as PdSlot[]) {
    drawSlot(page, lines[slot], layout[slot], fit, scale, fonts, accentHex)
  }

  markWatermarked(doc)
  return doc.save()
}
