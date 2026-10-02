import { PDFDocument } from 'pdf-lib'

// A drawn signature arrives as a PNG data URL from the signing page's pad. It
// is stored as that image only: no stroke timing, pressure or path data is
// sent or kept (owner's decision; the plan's "image only").
//
// Checked before anything is stored: a PNG by its first bytes, small, of
// sensible dimensions, and readable by the same PDF library that will later
// draw it onto the agreement.

export const MAX_SIGNATURE_BYTES = 150_000
const MAX_SIDE = 2000
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const PREFIX = 'data:image/png;base64,'

export type ParsedSignature = { ok: true; png: Uint8Array } | { ok: false; error: string }

export async function parseSignatureImage(dataUrl: unknown): Promise<ParsedSignature> {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX)) return { ok: false, error: 'The drawn signature must be a PNG image.' }
  const b64 = dataUrl.slice(PREFIX.length)
  if (b64.length > Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    return { ok: false, error: 'The drawn signature is too large. Clear it and draw it again.' }
  }
  const png = new Uint8Array(Buffer.from(b64, 'base64'))
  if (png.length < 64 || !PNG_MAGIC.every((b, i) => png[i] === b)) return { ok: false, error: 'The drawn signature must be a PNG image.' }
  try {
    const image = await (await PDFDocument.create()).embedPng(png)
    if (image.width < 20 || image.height < 10 || image.width > MAX_SIDE || image.height > MAX_SIDE) {
      return { ok: false, error: 'The drawn signature could not be read. Clear it and draw it again.' }
    }
  } catch {
    return { ok: false, error: 'The drawn signature could not be read. Clear it and draw it again.' }
  }
  return { ok: true, png }
}
