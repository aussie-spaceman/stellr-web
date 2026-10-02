import type { FieldMap, TemplateField } from '@/lib/esign/native/template'
import { renderSample, SAMPLE_SIGNED_AT_TEXT } from '@/lib/esign/native/template-sample'
import { extractPages, pageWords } from '@/lib/esign/native/pdf-text'

// Checks a Stellr signing template before anyone signs it:
//
//   wording    every page of the template carries the same words as the
//              source document (the clean rebuild must not drop a clause)
//   coverage   every field DocuSign had is in the stored field map, in the
//              same place (nothing a parent filled in silently disappears)
//   placement  a value typed into each field is printed on that field's page,
//              at that field's position
//
// Run by `scripts/esign-template.ts check` before approving a version, and by
// the tests on a synthetic document.

export interface TemplateIssue {
  check: 'wording' | 'coverage' | 'placement' | 'clean'
  message: string
}

/**
 * No signature, form or script left in the template. A DocuSign export can
 * carry DocuSign's own envelope signature; kept, every agreement built on it
 * would show a second, broken signature in a PDF reader.
 */
export async function checkClean(template: Uint8Array): Promise<TemplateIssue[]> {
  const { PDFDocument, PDFDict, PDFName } = await import('pdf-lib')
  const doc = await PDFDocument.load(template, { updateMetadata: false })
  const found = new Set<string>()
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue
    if (obj.has(PDFName.of('ByteRange')) || obj.get(PDFName.of('FT')) === PDFName.of('Sig')) found.add('a digital signature')
    if (obj.get(PDFName.of('Subtype')) === PDFName.of('Widget')) found.add('a form field')
    if (obj.get(PDFName.of('S')) === PDFName.of('JavaScript')) found.add('a script')
  }
  if (doc.catalog.has(PDFName.of('AcroForm'))) found.add('a form')
  return [...found].map((what) => ({ check: 'clean' as const, message: `The template still contains ${what}. Convert it again: the clean rebuild removes it.` }))
}

export async function compareWording(source: Uint8Array, template: Uint8Array): Promise<TemplateIssue[]> {
  const [a, b] = await Promise.all([extractPages(source), extractPages(template)])
  const issues: TemplateIssue[] = []
  if (a.length !== b.length) issues.push({ check: 'wording', message: `The source has ${a.length} pages and the template ${b.length}` })
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const before = pageWords(a[i])
    const after = pageWords(b[i])
    if (before !== after) {
      let at = 0
      while (at < before.length && before[at] === after[at]) at++
      issues.push({
        check: 'wording',
        message: `Page ${i + 1} differs from the source near: “${before.slice(Math.max(0, at - 30), at + 50)}”`,
      })
    }
  }
  return issues
}

/**
 * `expected` is the map a fresh conversion of the DocuSign export produces;
 * `stored` is the one on the template version. A field may be renamed only by
 * re-converting, so names must match, and positions to within a point.
 */
export function compareCoverage(expected: FieldMap, stored: FieldMap): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const byName = new Map(stored.fields.map((f) => [f.name, f]))
  for (const f of expected.fields) {
    const s = byName.get(f.name)
    if (!s) {
      issues.push({ check: 'coverage', message: `DocuSign field ${f.name} (page ${f.page}, ${f.label}) is missing from the template` })
      continue
    }
    if (s.page !== f.page || Math.abs(s.x - f.x) > 1 || Math.abs(s.y - f.y) > 1) {
      issues.push({ check: 'coverage', message: `Field ${f.name} has moved: page ${f.page} @${f.x},${f.y} in DocuSign, page ${s.page} @${s.x},${s.y} in the template` })
    }
    if (s.role !== f.role) issues.push({ check: 'coverage', message: `Field ${f.name} belongs to ${f.role} in DocuSign but ${s.role} in the template` })
  }
  return issues
}

/** A value for each field that can be found again in the rendered text. */
function sampleFor(field: TemplateField, i: number): string {
  if (field.type === 'checkbox') return 'true'
  if (field.type === 'date_signed') return SAMPLE_SIGNED_AT_TEXT
  // A signer has one name, printed in each of their name fields.
  if (field.type === 'full_name') return `QzName${field.role}`
  return `Qz${i}`
}

export async function checkPlacement(template: Uint8Array, map: FieldMap): Promise<TemplateIssue[]> {
  const samples = new Map(map.fields.map((f, i) => [f.name, sampleFor(f, i)]))
  const filled = await renderSample(template, map, sampleFor)
  const [blank, rendered] = await Promise.all([extractPages(template), extractPages(filled)])

  const issues: TemplateIssue[] = []
  for (const f of map.fields) {
    const page = rendered[f.page - 1]
    if (!page) { issues.push({ check: 'placement', message: `Field ${f.name} is on page ${f.page}, past the end` }); continue }
    const want = f.type === 'checkbox' ? 'X' : (samples.get(f.name) as string)
    // Values print just below and right of the field's top-left corner.
    const near = (i: { str: string; x: number; y: number }) =>
      i.str.includes(want) && Math.abs(i.x - (f.x + 2)) <= 8 && i.y >= f.y - 2 && i.y <= f.y + 30
    const before = blank[f.page - 1]?.items.filter(near).length ?? 0
    if (page.items.filter(near).length <= before) {
      issues.push({ check: 'placement', message: `Field ${f.name} (${f.label}) did not print at page ${f.page} @${f.x},${f.y}` })
    }
  }
  return issues
}
