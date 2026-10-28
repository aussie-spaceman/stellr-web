import { z } from 'zod'

// Shared by the member and admin teacher-license routes, so a license entered
// by the teacher and one an admin enters on their behalf (e.g. from a copy the
// teacher emailed) pass exactly the same checks.

/** Private bucket for license photos/scans; served only via short-lived signed URLs. */
export const TEACHER_LICENSE_BUCKET = 'teacher-licenses'

/** Signed-URL lifetime for viewing an uploaded license (10 minutes). */
export const LICENSE_DOCUMENT_URL_TTL_SECONDS = 60 * 10

export const LICENSE_DOCUMENT_TYPES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'application/pdf',
] as const

export function isLicenseDocumentType(type: string): boolean {
  return (LICENSE_DOCUMENT_TYPES as readonly string[]).includes(type)
}

/** Confirm the file's leading bytes match a permitted type, so a mislabelled or
 *  blank Content-Type can't smuggle an arbitrary blob into the private bucket. */
export function licenseDocumentMagicMatches(b: Uint8Array): boolean {
  // PNG
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true
  // JPEG
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true
  // PDF ("%PDF")
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return true
  // WebP ("RIFF"…"WEBP")
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true
  // ISO-BMFF (HEIC/HEIF): bytes 4–7 = "ftyp"
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return true
  return false
}

export const teacherLicenseSchema = z.object({
  license_number: z.string().trim().min(1, 'License number is required').max(120),
  licensing_state: z.string().trim().min(1, 'Licensing state is required').max(120),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
})

export type TeacherLicenseInput = z.infer<typeof teacherLicenseSchema>
