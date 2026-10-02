import type { FieldMap, Role, TemplateField } from '@/lib/esign/native/template'
import { renderDocument, type SignerRender } from '@/lib/esign/native/render'
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
  check: 'wording' | 'coverage' | 'placement'
  message: string
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

const SIGNED_AT = '2026-10-02T17:00:00.000Z'
const SIGNED_AT_TEXT = 'Oct 02, 2026'

/** A value for each field that can be found again in the rendered text. */
function sampleFor(field: TemplateField, i: number): string {
  if (field.type === 'checkbox') return 'true'
  if (field.type === 'date_signed') return SIGNED_AT_TEXT
  // A signer has one name, printed in each of their name fields.
  if (field.type === 'full_name') return `QzName${field.role}`
  return `Qz${i}`
}

export async function checkPlacement(template: Uint8Array, map: FieldMap): Promise<TemplateIssue[]> {
  const samples = new Map(map.fields.map((f, i) => [f.name, sampleFor(f, i)]))
  const roles = [...new Set(map.roles.map((r) => r.role))] as Role[]
  const prefill: Record<string, string> = {}
  const names: Partial<Record<Role, string>> = {}
  const signers: SignerRender[] = roles.map((role) => {
    const values: Record<string, string> = {}
    let title: string | undefined
    let signature: SignerRender['signature']
    let name = `${role} name`
    for (const f of map.fields.filter((x) => x.role === role)) {
      const v = samples.get(f.name) as string
      if (f.type === 'signature') signature = { kind: 'typed', text: v }
      else if (f.type === 'full_name') name = v
      else if (f.type === 'title') title = v
      else if (f.source === 'prefill' && f.prefillKey) { prefill[f.prefillKey] = v; values[f.name] = v }
      else values[f.name] = v
    }
    names[role] = name
    return { role, name, email: `${role}@example.test`, values, signature, signedAt: SIGNED_AT, title }
  })

  const { pdf } = await renderDocument({ template, map, prefill, signers, names })
  const [blank, rendered] = await Promise.all([extractPages(template), extractPages(await pdf.save())])

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
