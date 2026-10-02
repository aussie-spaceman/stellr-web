import type { FieldMap, Role, TemplateField } from '@/lib/esign/native/template'
import { renderDocument, type SignerRender } from '@/lib/esign/native/render'

// A template rendered with a value in every field and every signer signed:
// the admin preview prints each field's label there, and the placement check
// (./template-check) prints values it can find again in the text.

export const SAMPLE_SIGNED_AT = '2026-10-02T17:00:00.000Z'
export const SAMPLE_SIGNED_AT_TEXT = 'Oct 02, 2026'

/** What the admin preview prints: each field's label, so its place can be checked by eye. */
export function labelSample(field: TemplateField): string {
  if (field.type === 'checkbox') return 'true'
  if (field.type === 'date_signed') return SAMPLE_SIGNED_AT_TEXT
  // A signer has one name, printed in each of their name fields.
  if (field.type === 'full_name') return `[${field.role} name]`
  return `[${field.label}]`.slice(0, 48)
}

export async function renderSample(
  template: Uint8Array,
  map: FieldMap,
  valueFor: (field: TemplateField, index: number) => string,
): Promise<Uint8Array> {
  const samples = new Map(map.fields.map((f, i) => [f.name, valueFor(f, i)]))
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
    return { role, name, email: `${role}@example.test`, values, signature, signedAt: SAMPLE_SIGNED_AT, title }
  })
  const { pdf } = await renderDocument({ template, map, prefill, signers, names })
  return pdf.save()
}
