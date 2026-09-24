#!/usr/bin/env node
/**
 * Check a DocuSign template JSON (DocuSign → Templates → ⋯ → Download, or
 * `scripts/docusign-templates.ts export`) against what the app prefills and
 * reads back. A tab label or role name that differs by one character does not
 * error — the field just arrives blank on a family's form — so check after any
 * template edit.
 *
 *   node scripts/check-docusign-template.mjs minor ~/Downloads/ParticipantAgreementMinors.json
 *
 * The contract below mirrors lib/docusign.ts (createConsentEnvelope,
 * createAdultEnvelope, createMentorEnvelope) and lib/docusign-form-data.ts.
 * Change them together.
 */
import fs from 'fs'

// type: the DocuSign tab collection the field must live in. 'text' also
// accepts DocuSign's other free-text kinds; a 'date' tab is rejected because
// its validation refuses the DD-MMM-YYYY value the app sends.
const CONTRACT = {
  minor: {
    roles: ['Guardian', 'Minor'],
    tabs: [
      { label: 'GuardianPhone',           role: 'Guardian', type: 'text' },
      { label: 'MinorRelationship',       role: 'Guardian', type: 'text' },
      { label: 'CredentialSharingOptOut', role: 'Guardian', type: 'checkbox', unticked: true, optional: true },
      { label: 'MinorDateOfBirth',        role: 'Minor',    type: 'text' },
      { label: 'SchoolName',              role: 'Minor',    type: 'text' },
      { label: 'SchoolState',             role: 'Minor',    type: 'text' },
    ],
  },
  adult: {
    roles: ['Adult'],
    tabs: [
      { label: 'TeacherPhone', role: 'Adult', type: 'text' },
      { label: 'SchoolName',   role: 'Adult', type: 'text' },
    ],
  },
  mentor: {
    roles: ['Mentor', 'StellrRepresentative'],
    tabs: [
      { label: 'MentorPhone', role: 'Mentor', type: 'text' },
    ],
  },
}
const TEXT_KINDS = new Set(['textTabs', 'numberTabs', 'ssnTabs', 'zipTabs'])

const [kind, file] = process.argv.slice(2)
const contract = CONTRACT[kind]
if (!contract || !file) {
  console.error('usage: node scripts/check-docusign-template.mjs <minor|adult|mentor> <template.json>')
  process.exit(2)
}
const tpl = JSON.parse(fs.readFileSync(file, 'utf8'))
const signers = tpl.recipients?.signers ?? []
const problems = []
const warnings = []

for (const role of contract.roles) {
  if (!signers.some((s) => s.roleName === role)) problems.push(`role "${role}" missing (roles: ${signers.map((s) => s.roleName).join(', ')})`)
}

// Every non-group tab, flattened.
const all = signers.flatMap((s) => Object.entries(s.tabs ?? {})
  .filter(([k]) => k !== 'tabGroups')
  .flatMap(([k, arr]) => arr.map((t) => ({ role: s.roleName, kind: k, t }))))

for (const want of contract.tabs) {
  const hits = all.filter((x) => x.t.tabLabel === want.label)
  if (hits.length === 0) {
    const near = all.find((x) => x.t.tabLabel?.toLowerCase() === want.label.toLowerCase())
    ;(want.optional ? warnings : problems).push(`"${want.label}" not found${near ? ` (found "${near.t.tabLabel}" — labels are case-sensitive)` : ''}`)
    continue
  }
  for (const { role, kind: k, t } of hits) {
    const where = `"${want.label}" (${k}, role ${role}, page ${t.pageNumber})`
    if (role !== want.role) problems.push(`${where}: must belong to role "${want.role}"`)
    if (want.type === 'text' && !TEXT_KINDS.has(k)) problems.push(`${where}: must be a Text field`)
    if (want.type === 'checkbox' && k !== 'checkboxTabs') problems.push(`${where}: must be a Checkbox`)
    if (want.unticked && String(t.selected) === 'true') problems.push(`${where}: must be unticked by default`)
    if (want.type === 'text' && t.value) problems.push(`${where}: has default text "${t.value}" — clear it, or it shows when no value is sent`)
  }
}

// Unlabelled fields are fine for signature/name/date-signed/email; anything
// else with an auto-generated label can't be filled by the app.
for (const { role, kind: k, t } of all) {
  if (/^(signHere|fullName|dateSigned|emailAddress|initialHere|title)Tabs$/.test(k)) continue
  if (/ [0-9a-f]{8}-[0-9a-f]{4}-/.test(t.tabLabel ?? '')) {
    warnings.push(`unlabelled ${k.replace(/Tabs$/, '')} on role ${role}, page ${t.pageNumber} (x ${t.xPosition}, y ${t.yPosition})${t.value ? `, default "${t.value}"` : ''} — the app cannot fill or read it`)
  }
}

console.log(`${tpl.name ?? kind} (${tpl.templateId ?? 'no id'})`)
for (const p of problems) console.log(`  ✗ ${p}`)
for (const w of warnings) console.log(`  ! ${w}`)
if (problems.length === 0) console.log('  ✓ every field the app fills or reads is present and correctly typed')
process.exit(problems.length ? 1 : 0)
