import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { FieldMap } from '@/lib/esign/native/template'
import { DEV_SUPABASE_REF, isLoopbackSupabase } from '@/lib/testing/e2e-supabase-target'

// The dev-only stand-in for the tenant guardian-consent document (S5 wave 7,
// K5; owner decision W7-6, 11 Nov 2026). The real consent wording is a legal
// item for production and is not in this repo. Until it exists, dev signs a
// document that says on its title and on every page that it is not a consent
// form, so a copy that strays can never be mistaken for one.
//
// Used by `scripts/esign-template.ts dev-placeholder`, `publish --dev-placeholder`
// and `approve --dev-placeholder`, and by scripts/seed-e2e-stack.ts. Everything
// here is pure: no environment reads and no database.

export const DEV_PLACEHOLDER_TITLE = 'DEV PLACEHOLDER – NOT A CONSENT FORM'

/** The words every page carries. A title or page without them is not the placeholder. */
export const DEV_PLACEHOLDER_MARK = 'DEV PLACEHOLDER'

/** The documents that may be published as a dev placeholder, and the field map each uses. */
export const DEV_PLACEHOLDER_MAPS: Readonly<Record<string, string>> = {
  tenant_guardian_consent: 'lib/esign/native/templates/tenant-guardian-consent-v1.fields.json',
}

export function isDevPlaceholderTitle(title: string | null | undefined): boolean {
  return (title ?? '').toUpperCase().includes(DEV_PLACEHOLDER_MARK)
}

export interface PlaceholderTarget {
  /** NEXT_PUBLIC_SUPABASE_URL */
  supabaseUrl?: string | null
  /** NEXT_PUBLIC_APP_ENV */
  appEnv?: string | null
}

/**
 * Why a dev placeholder may not be published or approved on this target, or
 * null when it may. An allowlist: only the dev project or a stack on this
 * machine. Production is refused because it is not listed; it is also refused
 * by NEXT_PUBLIC_APP_ENV=prod whatever the URL says. There is no override.
 */
export function devPlaceholderTargetRefusal(target: PlaceholderTarget): string | null {
  if ((target.appEnv ?? '').trim().toLowerCase() === 'prod') {
    return 'NEXT_PUBLIC_APP_ENV is prod. A dev placeholder never goes to production.'
  }
  let host: string | null = null
  try {
    host = target.supabaseUrl ? new URL(target.supabaseUrl).hostname : null
  } catch {
    host = null
  }
  if (!host) return 'NEXT_PUBLIC_SUPABASE_URL is unset or not a URL.'
  if (host === `${DEV_SUPABASE_REF}.supabase.co` || isLoopbackSupabase(target.supabaseUrl)) return null
  return `A dev placeholder goes only to the dev project (${DEV_SUPABASE_REF}) or a stack on this machine, and the target is ${host}.`
}

const PAGE: [number, number] = [612, 792]

/**
 * A PDF for `map` with the placeholder mark across the top and bottom of every
 * page, and each field's label printed to the left of where its value goes. No
 * consent wording: there is none to give.
 */
export async function buildDevPlaceholderPdf(map: FieldMap): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(DEV_PLACEHOLDER_TITLE)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const pages = Math.max(...map.fields.map((f) => f.page))
  const red = rgb(0.75, 0, 0)
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage(PAGE)
    const top = (y: number) => PAGE[1] - y
    page.drawText(DEV_PLACEHOLDER_TITLE, { x: 54, y: top(60), size: 18, font: bold, color: red })
    page.drawText('This is not a consent form. It has no legal effect. For testing on dev only.', { x: 54, y: top(84), size: 11, font })
    page.drawText(`Page ${n} of ${pages}`, { x: 54, y: top(108), size: 10, font })
    for (const f of map.fields.filter((field) => field.page === n)) {
      page.drawText(`${f.label}:`, { x: 54, y: top(f.y + 10), size: 9, font })
    }
    page.drawText(`${DEV_PLACEHOLDER_TITLE} (page ${n} of ${pages})`, { x: 54, y: top(752), size: 10, font: bold, color: red })
  }
  return pdf.save()
}

/** The text version shown beside the PDF on the signing page. */
export function devPlaceholderTextHtml(map: FieldMap): string {
  const rows = map.fields
    .filter((f) => f.type !== 'signature' && f.type !== 'date_signed')
    .map((f) => `<li>${escapeHtml(f.label)}</li>`)
    .join('')
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<title>${escapeHtml(DEV_PLACEHOLDER_TITLE)}</title></head><body>`,
    `<h1>${escapeHtml(DEV_PLACEHOLDER_TITLE)}</h1>`,
    '<p>This is not a consent form. It has no legal effect. For testing on dev only.</p>',
    `<p>The details it carries:</p><ul>${rows}</ul>`,
    '</body></html>',
    '',
  ].join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
