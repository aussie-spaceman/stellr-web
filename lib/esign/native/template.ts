import { z } from 'zod'

// The field map of a native-engine agreement: where each field sits on the
// PDF, who fills it, and where its value comes from.
//
// Coordinates are PDF points (1/72 inch) from the TOP-LEFT of the page, the
// convention DocuSign exports use, so a converted template keeps its layout
// exactly. The renderer flips them to PDF's bottom-left origin.

/** Who signs. Each role is one recipient on the agreement. */
export const ROLES = ['guardian', 'student', 'adult', 'mentor', 'member', 'stellr'] as const
export type Role = (typeof ROLES)[number]

export const FIELD_TYPES = ['text', 'checkbox', 'signature', 'date_signed', 'full_name', 'email', 'title'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

/**
 * Where a field's value comes from:
 *   prefill — from our data when the agreement is issued (the signer may
 *             correct it unless `locked`)
 *   signer  — typed or ticked by the signer
 *   system  — set by the engine at signing (date signed, the signer's adopted
 *             name, the counter-signature)
 */
export const FIELD_SOURCES = ['prefill', 'signer', 'system'] as const
export type FieldSource = (typeof FIELD_SOURCES)[number]

export const templateFieldSchema = z.object({
  /** Stable machine name. Read back by code (e.g. CredentialSharingOptOut). */
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(60),
  /** What the signer sees beside the field. Required: no unlabelled fields. */
  label: z.string().min(2).max(200),
  role: z.enum(ROLES),
  type: z.enum(FIELD_TYPES),
  source: z.enum(FIELD_SOURCES),
  /** For prefill fields: the key in the agreement's prefill data. */
  prefillKey: z.string().max(60).optional(),
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().min(0).default(0),
  h: z.number().min(0).default(0),
  required: z.boolean().default(false),
  /** A prefill the signer may not change. */
  locked: z.boolean().default(false),
  fontSize: z.number().min(5).max(24).default(9),
  maxLength: z.number().int().min(1).max(4000).default(200),
}).superRefine((f, ctx) => {
  if (f.source === 'prefill' && !f.prefillKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${f.name}: a prefill field needs prefillKey` })
  }
  if (f.type === 'signature' && f.source !== 'signer' && !(f.role === 'stellr' && f.source === 'system')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${f.name}: a signature is the signer's own act` })
  }
})

export type TemplateField = z.infer<typeof templateFieldSchema>

export const fieldMapSchema = z.object({
  /** Roles in signing order. Roles sharing a number sign in parallel. */
  roles: z.array(z.object({
    role: z.enum(ROLES),
    order: z.number().int().min(1),
    /** Whether the agreement can complete without this role (e.g. a student with no email). */
    optional: z.boolean().default(false),
  })).min(1),
  fields: z.array(templateFieldSchema).min(1),
}).superRefine((map, ctx) => {
  const names = new Set<string>()
  for (const f of map.fields) {
    if (names.has(f.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate field ${f.name}` })
    names.add(f.name)
  }
  const roles = new Set(map.roles.map((r) => r.role))
  for (const f of map.fields) {
    if (!roles.has(f.role)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${f.name}: role ${f.role} is not on the agreement` })
  }
  for (const r of map.roles) {
    if (r.role === 'stellr') continue
    if (!map.fields.some((f) => f.role === r.role && f.type === 'signature')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `role ${r.role} has no signature field` })
    }
  }
})

export type FieldMap = z.infer<typeof fieldMapSchema>

export function parseFieldMap(input: unknown): FieldMap {
  return fieldMapSchema.parse(input)
}

/** The fields a signer in `role` fills or confirms on the signing page. */
export function signerFields(map: FieldMap, role: Role): TemplateField[] {
  return map.fields.filter((f) => f.role === role && (f.source === 'signer' || (f.source === 'prefill' && !f.locked)))
}

/**
 * The value each field starts with: prefill fields from the issue-time data,
 * signer checkboxes unticked, everything else empty.
 */
export function initialValues(map: FieldMap, role: Role, prefill: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of signerFields(map, role)) {
    if (f.type === 'signature') continue
    out[f.name] = f.source === 'prefill' ? (prefill[f.prefillKey as string] ?? '') : f.type === 'checkbox' ? 'false' : ''
  }
  return out
}

export type ValidationResult = { ok: true; values: Record<string, string> } | { ok: false; errors: Record<string, string> }

/**
 * Checks what a signer submitted against their fields: required fields filled,
 * lengths within bounds, checkboxes true/false, no fields that are not theirs,
 * locked prefills unchanged. Returns the cleaned values.
 */
export function validateSignerValues(
  map: FieldMap,
  role: Role,
  prefill: Record<string, string>,
  submitted: Record<string, unknown>,
): ValidationResult {
  const errors: Record<string, string> = {}
  const values: Record<string, string> = {}
  const allowed = new Map(signerFields(map, role).filter((f) => f.type !== 'signature').map((f) => [f.name, f]))

  for (const key of Object.keys(submitted)) {
    if (!allowed.has(key)) errors[key] = 'This field is not part of your section.'
  }

  for (const [name, field] of allowed) {
    const raw = submitted[name]
    if (field.type === 'checkbox') {
      const ticked = raw === true || raw === 'true'
      if (field.required && !ticked) errors[name] = 'Tick this box to continue.'
      values[name] = ticked ? 'true' : 'false'
      continue
    }
    const text = typeof raw === 'string' ? raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : ''
    if (field.locked && field.source === 'prefill') {
      values[name] = prefill[field.prefillKey as string] ?? ''
      continue
    }
    if (field.required && !text) errors[name] = `Enter ${field.label.toLowerCase()}.`
    else if (text.length > field.maxLength) errors[name] = `Keep this under ${field.maxLength} characters.`
    else if (field.type === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[name] = 'Enter a valid email address.'
    values[name] = text
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values }
}
