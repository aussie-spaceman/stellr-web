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

// The stored bytes are checked by claimUpload against the compliance purposes'
// formats in lib/uploads.ts (PNG, JPEG, WebP, HEIC, PDF), so a mislabelled or
// blank Content-Type can't smuggle an arbitrary blob into the private bucket.

export const teacherLicenseSchema = z.object({
  license_number: z.string().trim().min(1, 'License number is required').max(120),
  licensing_state: z.string().trim().min(1, 'Licensing state is required').max(120),
  expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expiry date must be YYYY-MM-DD'),
})

export type TeacherLicenseInput = z.infer<typeof teacherLicenseSchema>
