import type { FieldMap, FieldSource, FieldType, Role, TemplateField } from '@/lib/esign/native/template'
import { fieldMapSchema } from '@/lib/esign/native/template'

// Converts a DocuSign template export (scripts/docusign-templates.ts export)
// into a native field map, keeping every field at exactly the position the
// family saw in DocuSign.
//
// Nothing is guessed. DocuSign auto-names fields it was never told about
// ("Checkbox 4f0e538d-…"); on the parental consent form two of those are the
// photo/media and digital-communications opt-outs, whose answers the app has
// never read back. Every such field must be named and labelled in an overrides
// file, or deliberately dropped, before a template converts: the result lists
// anything left over and the conversion fails.

export interface DocusignTab {
  tabLabel?: string
  pageNumber?: string
  xPosition?: string
  yPosition?: string
  width?: string
  height?: string
  required?: string
  locked?: string
  fontSize?: string
  maxLength?: string
}

export interface DocusignExport {
  name?: string
  documents?: { documentBase64?: string; name?: string; pages?: string }[]
  recipients?: { signers?: { roleName?: string; routingOrder?: string; tabs?: Record<string, DocusignTab[]> }[] }
}

export interface FieldOverride {
  /** Machine name for the field. */
  name?: string
  /** What the signer sees beside it. */
  label?: string
  source?: FieldSource
  prefillKey?: string
  required?: boolean
  locked?: boolean
  /** Leave the field out (e.g. a paid DocuSign extension the plan does not include). */
  drop?: true
}

export interface ConversionOverrides {
  /** DocuSign role name → native role. Defaults below cover the current templates. */
  roles?: Record<string, Role>
  /** Signing order by native role; defaults to guardian before student. */
  order?: Partial<Record<Role, number>>
  /** Roles the agreement can complete without (e.g. a student with no email). */
  optionalRoles?: Role[]
  /** Keyed by the DocuSign tabLabel exactly as exported. */
  fields?: Record<string, FieldOverride>
}

const DEFAULT_ROLES: Record<string, Role> = {
  Guardian: 'guardian',
  Minor: 'student',
  Adult: 'adult',
  Mentor: 'mentor',
  StellrRepresentative: 'stellr',
}

// The order agreed on 2 Oct 2026: a minor's guardian always signs first, so
// nothing is collected from the child before a parent has consented.
const DEFAULT_ORDER: Record<Role, number> = {
  guardian: 1, student: 2, adult: 1, mentor: 1, member: 2, stellr: 3,
}

/**
 * Fields the app pre-fills, by DocuSign tab label. The label is what the
 * signer sees; every one stays editable unless an override locks it, as on the
 * DocuSign forms.
 */
const KNOWN_PREFILL: Record<string, string> = {
  MinorName: 'Student name',
  MinorDateOfBirth: 'Student date of birth',
  MinorRelationship: 'Relationship to the student',
  GuardianName: 'Parent or guardian name',
  GuardianEmail: 'Parent or guardian email',
  GuardianPhone: 'Parent or guardian phone',
  SchoolName: 'School',
  SchoolState: 'School state',
  EventTitle: 'Event',
  TeacherName: 'Name',
  TeacherEmail: 'Email',
  TeacherPhone: 'Phone',
  MentorName: 'Name',
  MentorEmail: 'Email',
  MentorPhone: 'Phone',
  MemberName: 'Name',
  MemberEmail: 'Email',
  MemberPhone: 'Phone',
}

/** Field names the app reads back after signing. Their meaning is fixed. */
export const READ_BACK_FIELDS = ['CredentialSharingOptOut', 'MediaOptOut', 'DigitalCommsOptOut'] as const

/** Labels for signer fields DocuSign templates already name. */
const KNOWN_SIGNER_FIELDS: Record<string, string> = {
  CredentialSharingOptOut: 'I do NOT want my child\'s Stellr credential pages to be public',
  MediaOptOut: 'I do NOT consent to photo and media use',
  DigitalCommsOptOut: 'I do NOT consent to direct digital communications with my child',
}

const KIND: Record<string, { type: FieldType; source: FieldSource } | 'ignore'> = {
  signHereTabs: { type: 'signature', source: 'signer' },
  fullNameTabs: { type: 'full_name', source: 'system' },
  dateSignedTabs: { type: 'date_signed', source: 'system' },
  emailAddressTabs: { type: 'email', source: 'system' },
  titleTabs: { type: 'title', source: 'system' },
  textTabs: { type: 'text', source: 'signer' },
  checkboxTabs: { type: 'checkbox', source: 'signer' },
  tabGroups: 'ignore',
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/

/** An override key that names a field by where it sits: `p2@50,454`. */
export function positionKey(tab: DocusignTab): string {
  return `p${Number(tab.pageNumber ?? 0)}@${Math.round(Number(tab.xPosition ?? 0))},${Math.round(Number(tab.yPosition ?? 0))}`
}

function fontSize(raw?: string): number {
  const m = /size(\d+)/.exec(raw ?? '')
  return m ? Number(m[1]) : 9
}

export interface ConversionIssue {
  role: string
  kind: string
  tabLabel: string
  page: number
  reason: string
}

export interface ConversionResult {
  map: FieldMap | null
  /** Every DocuSign tab and what became of it. */
  report: { role: string; kind: string; tabLabel: string; page: number; outcome: string }[]
  issues: ConversionIssue[]
}

export function convertDocusignTemplate(exp: DocusignExport, overrides: ConversionOverrides = {}): ConversionResult {
  const roleMap = { ...DEFAULT_ROLES, ...overrides.roles }
  const order = { ...DEFAULT_ORDER, ...overrides.order }
  const report: ConversionResult['report'] = []
  const issues: ConversionIssue[] = []
  const fields: TemplateField[] = []
  const roles = new Map<Role, number>()
  const perRoleCount: Record<string, number> = {}

  for (const signer of exp.recipients?.signers ?? []) {
    const dsRole = signer.roleName ?? ''
    const role = roleMap[dsRole]
    if (!role) {
      issues.push({ role: dsRole, kind: '-', tabLabel: '-', page: 0, reason: `No native role for DocuSign role "${dsRole}"` })
      continue
    }
    roles.set(role, order[role])

    for (const [kind, tabs] of Object.entries(signer.tabs ?? {})) {
      const mapping = KIND[kind]
      for (const tab of tabs) {
        const tabLabel = tab.tabLabel ?? ''
        const page = Number(tab.pageNumber ?? 0)
        const entry = { role: dsRole, kind, tabLabel, page }
        if (mapping === 'ignore') { report.push({ ...entry, outcome: 'ignored (grouping only)' }); continue }

        // By label, or by position: DocuSign regenerates the auto-names when a
        // template is copied between accounts, but not where the field sits.
        const override = overrides.fields?.[tabLabel] ?? overrides.fields?.[positionKey(tab)]
        if (override?.drop) { report.push({ ...entry, outcome: 'dropped by override' }); continue }
        if (!mapping) {
          issues.push({ ...entry, reason: `Unsupported field kind ${kind}: add an override that names it or drops it` })
          continue
        }

        let { type, source } = mapping
        let name = override?.name
        let label = override?.label
        let prefillKey = override?.prefillKey

        if (kind === 'textTabs' && KNOWN_PREFILL[tabLabel] && !override?.source) {
          source = 'prefill'
          prefillKey ??= tabLabel
          name ??= tabLabel
          label ??= KNOWN_PREFILL[tabLabel]
        }
        if (type === 'signature' || type === 'full_name' || type === 'date_signed' || type === 'title' || type === 'email') {
          const n = (perRoleCount[`${role}:${type}`] = (perRoleCount[`${role}:${type}`] ?? 0) + 1)
          name ??= n === 1 ? `${role}_${type}` : `${role}_${type}_${n}`
          label ??= ({ signature: 'Signature', full_name: 'Full name', date_signed: 'Date signed', title: 'Title', email: 'Email' } as const)[type]
        }
        if (KNOWN_SIGNER_FIELDS[tabLabel]) {
          name ??= tabLabel
          label ??= KNOWN_SIGNER_FIELDS[tabLabel]
        }
        if (override?.source) source = override.source
        if (source === 'prefill' && !prefillKey) prefillKey = name
        // Stellr's counter-signature is applied by the engine, not signed by a person.
        if (role === 'stellr' && type === 'signature') source = 'system'

        if (!name && IDENT.test(tabLabel) && !/^(Checkbox|Text|Name|Signature|Date)\b/.test(tabLabel)) name = tabLabel
        if (!name || !label) {
          issues.push({ ...entry, reason: 'DocuSign never named this field. Add an override with a name and the label signers will see.' })
          continue
        }
        if (!IDENT.test(name)) {
          issues.push({ ...entry, reason: `Override name "${name}" must be letters, digits and underscores` })
          continue
        }

        fields.push({
          name,
          label,
          role,
          type,
          source,
          prefillKey: source === 'prefill' ? prefillKey : undefined,
          page,
          x: Number(tab.xPosition ?? 0),
          y: Number(tab.yPosition ?? 0),
          w: Number(tab.width ?? 0),
          h: Number(tab.height ?? 0),
          required: override?.required ?? (type === 'signature' || tab.required === 'true'),
          locked: override?.locked ?? tab.locked === 'true',
          fontSize: fontSize((tab as { fontSize?: string }).fontSize),
          maxLength: Math.min(Number(tab.maxLength ?? 200) || 200, 4000),
        })
        report.push({ ...entry, outcome: `${name} (${type}, ${source})` })
      }
    }
  }

  const optional = new Set(overrides.optionalRoles ?? (roles.has('student') ? ['student'] : []))
  const candidate = {
    roles: [...roles].map(([role, o]) => ({ role, order: o, optional: optional.has(role) })),
    fields,
  }

  if (issues.length) return { map: null, report, issues }
  const parsed = fieldMapSchema.safeParse(candidate)
  if (!parsed.success) {
    for (const e of parsed.error.issues) issues.push({ role: '-', kind: '-', tabLabel: '-', page: 0, reason: e.message })
    return { map: null, report, issues }
  }
  return { map: parsed.data, report, issues }
}

/** The template PDF embedded in a DocuSign export. */
export function exportPdf(exp: DocusignExport): Buffer {
  const doc = exp.documents?.[0]
  if (!doc?.documentBase64) throw new Error('The export has no document. Re-export with documents included.')
  return Buffer.from(doc.documentBase64, 'base64')
}
