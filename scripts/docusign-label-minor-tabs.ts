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
 * Fields are found by role, page and vertical position — the printed line on
 * Participation Agreement - Minors V2-2, page 4 (and the page 3 credential
 * opt-out) — not by their auto-generated labels, which change on every edit.
 * Each target must match exactly one field or nothing is changed.
 *
 *   npx tsx scripts/docusign-label-minor-tabs.ts                    # dry run, .env.local account
 *   npx tsx scripts/docusign-label-minor-tabs.ts --apply
 *   npx tsx scripts/docusign-label-minor-tabs.ts --env-file .env.docusign-prod --apply
 *   npx tsx scripts/docusign-label-minor-tabs.ts --template <guid>  # a different template
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
const TEMPLATE_ID = arg('--template') ?? process.env.DOCUSIGN_TEMPLATE_ID ?? ''

// kinds: the tab collections a match may come from. A dateTabs match is
// replaced by a text tab — the date field's MM/DD/YYYY validation refuses the
// DD-MMM-YYYY value the form prints and the app sends.
interface Target { label: string; role: 'Guardian' | 'Minor'; page: number; y: number; kinds: string[] }
const TARGETS: Target[] = [
  { label: 'MinorDateOfBirth',        role: 'Minor',    page: 4, y: 271, kinds: ['textTabs', 'dateTabs'] },
  { label: 'SchoolName',              role: 'Minor',    page: 4, y: 306, kinds: ['textTabs'] },
  { label: 'SchoolState',             role: 'Minor',    page: 4, y: 338, kinds: ['textTabs'] },  // "State of Residence"
  { label: 'MinorRelationship',       role: 'Guardian', page: 4, y: 444, kinds: ['textTabs'] },
  { label: 'GuardianEmail',           role: 'Guardian', page: 4, y: 480, kinds: ['emailAddressTabs'] },
  { label: 'GuardianPhone',           role: 'Guardian', page: 4, y: 509, kinds: ['textTabs'] },
  { label: 'CredentialSharingOptOut', role: 'Guardian', page: 3, y: 214, kinds: ['checkboxTabs'] },
]
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
  console.log(`Environment: ${ENV.basePath.includes('demo.docusign.net') ? 'SANDBOX / DEMO' : 'PRODUCTION'}`)
  console.log(`Template:    ${TEMPLATE_ID}`)
  console.log(`Mode:        ${APPLY ? 'APPLY' : 'dry run (pass --apply to change the template)'}\n`)

  const token = await getToken()
  const { signers = [] } = await api(token, '/recipients?include_tabs=true') as { signers?: Signer[] }

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
  if (errors.length) {
    for (const e of errors) console.log(`❌ ${e}`)
    console.log('\nNothing changed. The template layout differs from V2-2 — update TARGETS.')
    process.exit(1)
  }

  let changes = 0
  for (const { t, signer, kind, tab } of plan) {
    const replace = kind === 'dateTabs'
    const needsLabel = tab.tabLabel !== t.label
    const needsClear = kind === 'textTabs' && !!tab.value
    if (!replace && !needsLabel && !needsClear) { console.log(`✓ ${t.label} already correct`); continue }
    changes++
    const what = [
      replace ? 'replace Date field with a Text field' : null,
      needsLabel ? `label "${tab.tabLabel}" → "${t.label}"` : null,
      needsClear || (replace && tab.value) ? `clear default text "${tab.value}"` : null,
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
      if (kind === 'textTabs') patch.value = ''
      if (kind === 'checkboxTabs') patch.name = t.label
      await api(token, `/recipients/${rid}/tabs`, { method: 'PUT', body: JSON.stringify({ [kind]: [patch] }) })
    }
  }

  console.log(changes === 0
    ? '\nNothing to change.'
    : APPLY ? `\n✅ ${changes} field(s) updated. Download the template JSON and run scripts/check-docusign-template.mjs minor <file>.`
            : `\n${changes} field(s) would change. Re-run with --apply.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
