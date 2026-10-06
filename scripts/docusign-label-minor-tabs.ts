/**
 * Give the minor consent template's fields the data labels the app fills and
 * reads (lib/docusign.ts createConsentEnvelope, lib/docusign-form-data.ts),
 * editing the template IN PLACE so its GUID — and DOCUSIGN_TEMPLATE_ID — stay
 * the same.
 *
 * Why a script: DocuSign's new template editor has no "Data label" setting, so
 * a template rebuilt there (24 Sept 2026) comes out with auto-generated labels
 * ("Text 831ad02b-…") and every prefilled field arrives blank. The API can
 * still set them.
 *
 * Fields are found by role, page and vertical position on the Participation
 * Agreements V2.3 (2 Oct 2026), as DocuSign lays them out — not by their
 * auto-generated labels, which change on every edit. Each target must match
 * exactly one field or nothing is changed. `--list` prints every field with
 * its position, which is where these positions came from (6 Oct 2026).
 *
 *   npx tsx scripts/docusign-label-minor-tabs.ts --list                       # every field, changes nothing
 *   npx tsx scripts/docusign-label-minor-tabs.ts                              # dry run, minor template
 *   npx tsx scripts/docusign-label-minor-tabs.ts --doc mentor                 # dry run, mentor template (or --doc adult)
 *   npx tsx scripts/docusign-label-minor-tabs.ts --env-file .env.docusign-prod.local --apply
 *   npx tsx scripts/docusign-label-minor-tabs.ts --template <guid>            # a different template
 *   npx tsx scripts/docusign-label-minor-tabs.ts --doc mentor --dump m.json   # the template JSON, for the checker
 *
 * Then download the template JSON and run scripts/check-docusign-template.mjs.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import { createSign } from 'crypto'

const arg = (name: string) => {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}
const APPLY = process.argv.includes('--apply')
dotenv.config({ path: path.resolve(process.cwd(), arg('--env-file') ?? '.env.local') })

const ENV = {
  oauthUrl:  process.env.DOCUSIGN_OAUTH_URL ?? 'https://account-d.docusign.com',
  basePath:  process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi',
  accountId: process.env.DOCUSIGN_ACCOUNT_ID ?? '',
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY ?? '',
  userId:    process.env.DOCUSIGN_USER_ID ?? '',
  privateKey: (process.env.DOCUSIGN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
}
type Doc = 'minor' | 'mentor' | 'adult'
const DOC = (arg('--doc') ?? 'minor') as Doc
const TEMPLATE_ID = arg('--template')
  ?? { minor: process.env.DOCUSIGN_TEMPLATE_ID, mentor: process.env.DOCUSIGN_MENTOR_TEMPLATE_ID, adult: process.env.DOCUSIGN_ADULT_TEMPLATE_ID }[DOC]
  ?? ''

// kinds: the tab collections a match may come from. A dateTabs match is
// replaced by a text tab — the date field's MM/DD/YYYY validation refuses the
// DD-MMM-YYYY value the form prints and the app sends.
// required: set the field's Required flag too (omitted: left as it is).
interface Target { label: string; role: string; page: number; y: number; kinds: string[]; required?: boolean }
const TARGET_SETS: Record<Doc, Target[]> = {
  // Participation Agreement — Student / Minor, V2.3.
  minor: [
    { label: 'MediaOptOut',             role: 'Guardian', page: 4, y: 128, kinds: ['checkboxTabs'] },
    { label: 'QuoteOptOut',             role: 'Guardian', page: 4, y: 371, kinds: ['checkboxTabs'] },
    { label: 'CredentialSharingOptOut', role: 'Guardian', page: 5, y: 135, kinds: ['checkboxTabs'] },
    { label: 'DigitalCommsOptOut',      role: 'Guardian', page: 5, y: 302, kinds: ['checkboxTabs'] },
    { label: 'MinorDateOfBirth',        role: 'Minor',    page: 8, y: 359, kinds: ['textTabs', 'dateTabs'] },
    { label: 'MinorEmail',              role: 'Minor',    page: 8, y: 376, kinds: ['textTabs'] },
    { label: 'SchoolName',              role: 'Minor',    page: 8, y: 394, kinds: ['textTabs'] },
    { label: 'MinorGrade',              role: 'Minor',    page: 8, y: 412, kinds: ['textTabs'] },
    { label: 'SchoolState',             role: 'Minor',    page: 8, y: 429, kinds: ['textTabs'] },  // "State of residence"
    { label: 'MinorRelationship',       role: 'Guardian', page: 8, y: 483, kinds: ['textTabs'] },
    { label: 'GuardianEmail',           role: 'Guardian', page: 8, y: 505, kinds: ['emailAddressTabs'] },
    { label: 'GuardianPhone',           role: 'Guardian', page: 8, y: 520, kinds: ['textTabs'] },
    // "(if different)": the parent may leave both blank.
    { label: 'EmergencyContactName',    role: 'Guardian', page: 8, y: 539, kinds: ['textTabs'], required: false },
    { label: 'EmergencyContactPhone',   role: 'Guardian', page: 8, y: 555, kinds: ['textTabs'], required: false },
  ],
  // Mentor and Volunteer Agreement, V2.3.
  mentor: [
    { label: 'MentorAddress',           role: 'Mentor', page: 1, y: 211, kinds: ['textTabs'] },
    { label: 'MediaOptOut',             role: 'Mentor', page: 4, y: 294, kinds: ['checkboxTabs'] },
    { label: 'EmergencyContactName',    role: 'Mentor', page: 4, y: 520, kinds: ['textTabs'] },
    { label: 'EmergencyContactPhone',   role: 'Mentor', page: 4, y: 539, kinds: ['textTabs'] },
  ],
  // Participation Agreement — Educator / Chaperone, V2.3.
  adult: [
    { label: 'MediaOptOut',             role: 'Adult', page: 3, y: 364, kinds: ['checkboxTabs'] },
    { label: 'TeacherPhone',            role: 'Adult', page: 4, y: 298, kinds: ['textTabs'] },
    { label: 'SchoolName',              role: 'Adult', page: 4, y: 315, kinds: ['textTabs'] },
  ],
}
const TARGETS = TARGET_SETS[DOC]

// Fields to delete. A Mentor under the age of majority always signs on Stellr
// signing (lib/esign/issue.ts), so on DocuSign the parent block must stay
// empty; fields there for the Mentor role would make every adult fill it in.
interface Removal { what: string; role: string; page: number; y: number; kind: string }
const REMOVAL_SETS: Record<Doc, Removal[]> = {
  minor: [],
  adult: [],
  mentor: [
    { what: 'parent block: full name',  role: 'Mentor', page: 4, y: 573, kind: 'textTabs' },
    { what: 'parent block: signature',  role: 'Mentor', page: 4, y: 593, kind: 'textTabs' },
    { what: 'parent block: date',       role: 'Mentor', page: 4, y: 593, kind: 'dateSignedTabs' },
  ],
}
const REMOVALS = REMOVAL_SETS[DOC]
const Y_TOLERANCE = 12

type Tab = Record<string, string | undefined> & { tabId: string; tabLabel?: string }
interface Signer { recipientId: string; roleName?: string; tabs?: Record<string, Tab[]> }

function b64u(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const input = `${b64u(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))}.${b64u(Buffer.from(JSON.stringify({
    iss: ENV.integrationKey, sub: ENV.userId, aud: ENV.oauthUrl.replace('https://', ''),
    iat: now, exp: now + 3600, scope: 'signature impersonation',
  })))}`
  const sign = createSign('RSA-SHA256'); sign.update(input)
  const res = await fetch(`${ENV.oauthUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${input}.${b64u(sign.sign(ENV.privateKey))}`,
  })
  if (!res.ok) throw new Error(`DocuSign auth failed: ${await res.text()}`)
  return (await res.json() as { access_token: string }).access_token
}

async function api(token: string, p: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${ENV.basePath}/v2.1/accounts/${ENV.accountId}/templates/${TEMPLATE_ID}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${p} → ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

async function main() {
  if (!ENV.accountId || !ENV.integrationKey || !ENV.userId || !ENV.privateKey || !TEMPLATE_ID) {
    console.log('❌ DocuSign credentials or DOCUSIGN_TEMPLATE_ID missing')
    process.exit(1)
  }
  // `vercel env pull` writes this placeholder for Sensitive variables.
  const placeholders = Object.entries({ ...ENV, templateId: TEMPLATE_ID })
    .filter(([, v]) => v.includes('[SENSITIVE]')).map(([k]) => k)
  if (placeholders.length) {
    console.log(`❌ ${placeholders.join(', ')} still "[SENSITIVE]" — Vercel does not export Sensitive values; fill them in by hand`)
    process.exit(1)
  }
  console.log(`Environment: ${ENV.basePath.includes('demo.docusign.net') ? 'SANDBOX / DEMO' : 'PRODUCTION'}`)
  console.log(`Template:    ${TEMPLATE_ID} (${DOC})`)
  console.log(`Mode:        ${APPLY ? 'APPLY' : 'dry run (pass --apply to change the template)'}\n`)

  const token = await getToken()
  const { signers = [] } = await api(token, '/recipients?include_tabs=true') as { signers?: Signer[] }

  // --dump <file>: the template as JSON, for scripts/check-docusign-template.mjs.
  const dump = arg('--dump')
  if (dump) {
    const fs = await import('fs')
    fs.writeFileSync(dump, JSON.stringify(await api(token, '?include=recipients,tabs'), null, 2))
    console.log(`Wrote ${dump}`)
    return
  }

  // --list: every field on the template, by role, page and position, so the
  // TARGETS for a new layout can be read off rather than guessed.
  if (process.argv.includes('--list')) {
    for (const s of signers) {
      console.log(`\nRole "${s.roleName}" (recipient ${s.recipientId})`)
      const rows = Object.entries(s.tabs ?? {}).flatMap(([kind, tabs]) =>
        (tabs ?? []).map((tab) => ({ kind, page: Number(tab.pageNumber), y: Number(tab.yPosition), x: Number(tab.xPosition), label: tab.tabLabel ?? '', required: tab.required })))
      rows.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
      for (const r of rows) console.log(`  p${r.page} y${String(r.y).padStart(4)} x${String(r.x).padStart(4)}  ${r.kind.padEnd(18)} ${r.label}${r.required === 'true' ? '  (required)' : ''}`)
    }
    return
  }

  // Resolve every target first; change nothing unless all resolve cleanly.
  const plan: { t: Target; signer: Signer; kind: string; tab: Tab }[] = []
  const errors: string[] = []
  for (const t of TARGETS) {
    const signer = signers.find((s) => s.roleName === t.role)
    if (!signer) { errors.push(`role "${t.role}" not on the template`); continue }
    const hits = t.kinds.flatMap((kind) => (signer.tabs?.[kind] ?? [])
      .filter((tab) => Number(tab.pageNumber) === t.page && Math.abs(Number(tab.yPosition) - t.y) <= Y_TOLERANCE)
      .map((tab) => ({ kind, tab })))
    if (hits.length !== 1) {
      errors.push(`${t.label}: expected 1 ${t.kinds.join('/')} field for ${t.role} on page ${t.page} near y=${t.y}, found ${hits.length}`)
      continue
    }
    plan.push({ t, signer, ...hits[0] })
  }
  const removals: { r: Removal; signer: Signer; tab: Tab }[] = []
  for (const r of REMOVALS) {
    const signer = signers.find((s) => s.roleName === r.role)
    const hits = (signer?.tabs?.[r.kind] ?? []).filter((tab) =>
      Number(tab.pageNumber) === r.page && Math.abs(Number(tab.yPosition) - r.y) <= Y_TOLERANCE)
    if (!signer || hits.length > 1) { errors.push(`remove ${r.what}: expected at most 1 ${r.kind} for ${r.role} on page ${r.page} near y=${r.y}, found ${hits.length}`); continue }
    if (hits.length === 1) removals.push({ r, signer, tab: hits[0] })
  }
  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`)
    console.log('\nNothing changed. The template layout differs from what TARGETS expect: run --list and update them.')
    process.exit(1)
  }

  let changes = 0
  for (const { t, signer, kind, tab } of plan) {
    const replace = kind === 'dateTabs'
    const needsLabel = tab.tabLabel !== t.label
    const needsClear = kind === 'textTabs' && !!tab.value
    const needsRequired = t.required !== undefined && String(t.required) !== String(tab.required)
    if (!replace && !needsLabel && !needsClear && !needsRequired) { console.log(`✓ ${t.label} already correct`); continue }
    changes++
    const what = [
      replace ? 'replace Date field with a Text field' : null,
      needsLabel ? `label "${tab.tabLabel}" → "${t.label}"` : null,
      needsClear || (replace && tab.value) ? `clear default text "${tab.value}"` : null,
      needsRequired ? `required ${tab.required} → ${t.required}` : null,
    ].filter(Boolean).join('; ')
    console.log(`${APPLY ? '→' : '•'} ${t.label} (${t.role}, p${t.page}, y ${tab.yPosition}): ${what}`)
    if (!APPLY) continue

    const rid = signer.recipientId
    if (replace) {
      await api(token, `/recipients/${rid}/tabs`, {
        method: 'POST',
        body: JSON.stringify({ textTabs: [{
          tabLabel: t.label, documentId: tab.documentId, pageNumber: tab.pageNumber,
          xPosition: tab.xPosition, yPosition: tab.yPosition, width: tab.width, height: tab.height,
          required: tab.required, font: tab.font, fontSize: tab.fontSize, fontColor: tab.fontColor,
          value: '',
        }] }),
      })
      await api(token, `/recipients/${rid}/tabs`, {
        method: 'DELETE',
        body: JSON.stringify({ dateTabs: [{ tabId: tab.tabId }] }),
      })
    } else {
      const patch: Record<string, string> = { tabId: tab.tabId, tabLabel: t.label }
      if (t.required !== undefined) patch.required = String(t.required)
      if (kind === 'textTabs') patch.value = ''
      if (kind === 'checkboxTabs') patch.name = t.label
      await api(token, `/recipients/${rid}/tabs`, { method: 'PUT', body: JSON.stringify({ [kind]: [patch] }) })
    }
  }

  for (const { r, signer, tab } of removals) {
    changes++
    console.log(`${APPLY ? '→' : '•'} delete ${r.what} (${r.role}, p${r.page}, y ${tab.yPosition}, ${r.kind} "${tab.tabLabel}")`)
    if (!APPLY) continue
    await api(token, `/recipients/${signer.recipientId}/tabs`, {
      method: 'DELETE',
      body: JSON.stringify({ [r.kind]: [{ tabId: tab.tabId }] }),
    })
  }

  console.log(changes === 0
    ? '\nNothing to change.'
    : APPLY ? `\n✅ ${changes} field(s) updated. Download the template JSON and run scripts/check-docusign-template.mjs ${DOC} <file>.`
            : `\n${changes} field(s) would change. Re-run with --apply.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
