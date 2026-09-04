/**
 * Export DocuSign templates from one account and import them into another.
 *
 * Written for the sandbox → production cutover (docs/GO-LIVE-CHECKLIST.md §4a
 * step 7), which is the most error-prone step in that runbook: templates are
 * ACCOUNT-SCOPED, so the GUIDs change, and if a single tab label or role name
 * differs in the rebuilt template the field silently comes through blank on a
 * real family's consent form. Copying the definition verbatim removes the
 * retyping.
 *
 *   # 1. From the sandbox (whatever .env.local points at):
 *   npx tsx scripts/docusign-templates.ts export
 *
 *   # 2. Point DOCUSIGN_* at the production account, then:
 *   npx tsx scripts/docusign-templates.ts import --apply
 *
 * Export is read-only. Import is a dry run unless --apply is passed, and it
 * prints the new template GUIDs to put into the DOCUSIGN_*_TEMPLATE_ID vars.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createSign } from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const OUT_DIR = path.resolve(process.cwd(), 'scripts/docusign-templates')

const ENV = {
  oauthUrl:  process.env.DOCUSIGN_OAUTH_URL ?? 'https://account-d.docusign.com',
  basePath:  process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi',
  accountId: process.env.DOCUSIGN_ACCOUNT_ID ?? '',
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY ?? '',
  userId:    process.env.DOCUSIGN_USER_ID ?? '',
  privateKey: (process.env.DOCUSIGN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
}

// The four templates the app issues. The volunteer one does not exist yet in any
// account — DOCUSIGN_VOLUNTEER_TEMPLATE_ID is unset, so volunteer agreements
// throw today. It is listed so the gap is visible during the cutover.
const TEMPLATE_ENVS = [
  { env: 'DOCUSIGN_TEMPLATE_ID',           label: 'minor' },
  { env: 'DOCUSIGN_ADULT_TEMPLATE_ID',     label: 'adult' },
  { env: 'DOCUSIGN_MENTOR_TEMPLATE_ID',    label: 'mentor' },
  { env: 'DOCUSIGN_VOLUNTEER_TEMPLATE_ID', label: 'volunteer' },
] as const

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: ENV.integrationKey, sub: ENV.userId, aud: ENV.oauthUrl.replace('https://', ''),
    iat: now, exp: now + 3600, scope: 'signature impersonation',
  })))
  const input = `${header}.${payload}`
  const sign = createSign('RSA-SHA256'); sign.update(input)
  const jwt = `${input}.${base64url(sign.sign(ENV.privateKey))}`
  const res = await fetch(`${ENV.oauthUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  if (!res.ok) throw new Error(`DocuSign auth failed: ${await res.text()}`)
  return (await res.json() as { access_token: string }).access_token
}

async function api(token: string, p: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ENV.basePath}/v2.1/accounts/${ENV.accountId}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

function environmentLabel(): string {
  return ENV.basePath.includes('demo.docusign.net') ? 'SANDBOX / DEMO' : 'PRODUCTION'
}

async function doExport(token: string): Promise<void> {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const { env, label } of TEMPLATE_ENVS) {
    const id = process.env[env]
    if (!id) { console.log(`⚠️  ${label}: ${env} not set — nothing to export`); continue }

    const res = await api(token, `/templates/${id}?include=recipients,documents,tabs`)
    if (!res.ok) { console.log(`❌ ${label}: ${id} → ${res.status} ${await res.text()}`); continue }
    const tpl = await res.json() as {
      name?: string
      documents?: { documentId?: string; name?: string }[]
      [k: string]: unknown
    }

    // The definition references documents by id; fetch the bytes and inline them
    // so the import is self-contained.
    for (const doc of tpl.documents ?? []) {
      const dRes = await api(token, `/templates/${id}/documents/${doc.documentId}`, {
        headers: { Accept: 'application/pdf' },
      })
      if (!dRes.ok) { console.log(`   ⚠️  document ${doc.documentId} → ${dRes.status}`); continue }
      const bytes = Buffer.from(await dRes.arrayBuffer())
      ;(doc as Record<string, unknown>).documentBase64 = bytes.toString('base64')
      ;(doc as Record<string, unknown>).fileExtension = 'pdf'
    }

    const file = path.join(OUT_DIR, `${label}.json`)
    fs.writeFileSync(file, JSON.stringify(tpl, null, 2))
    const roles = ((tpl.recipients as { signers?: { roleName?: string }[] } | undefined)?.signers ?? [])
      .map(r => r.roleName).filter(Boolean).join(', ')
    console.log(`✅ ${label}: "${tpl.name}" → ${path.relative(process.cwd(), file)}${roles ? `  [roles: ${roles}]` : ''}`)
  }
}

async function doImport(token: string, apply: boolean): Promise<void> {
  if (!fs.existsSync(OUT_DIR)) {
    console.log(`❌ Nothing to import — run "export" against the source account first.`)
    process.exit(1)
  }

  const newIds: string[] = []
  for (const { env, label } of TEMPLATE_ENVS) {
    const file = path.join(OUT_DIR, `${label}.json`)
    if (!fs.existsSync(file)) { console.log(`⚠️  ${label}: no export file — skipping`); continue }

    const tpl = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    // Strip identifiers that belong to the source account.
    delete tpl.templateId
    delete tpl.uri
    delete tpl.owner
    delete tpl.folderId
    delete tpl.folderIds
    delete tpl.folderName

    if (!apply) {
      console.log(`DRY RUN  would create "${tpl.name}" in ${environmentLabel()} → set ${env}`)
      continue
    }

    const res = await api(token, '/templates', { method: 'POST', body: JSON.stringify(tpl) })
    const body = await res.text()
    if (!res.ok) { console.log(`❌ ${label}: ${res.status} ${body}`); continue }
    const created = JSON.parse(body) as { templateId?: string }
    console.log(`✅ ${label}: created ${created.templateId}`)
    newIds.push(`${env}=${created.templateId}`)
  }

  if (newIds.length > 0) {
    console.log('\nSet these in Vercel (Production scope), then redeploy:\n')
    console.log(newIds.join('\n'))
    console.log('\nThen re-run: npm run verify:prod')
  }
}

async function main() {
  const mode = process.argv[2]
  const apply = process.argv.includes('--apply')

  if (mode !== 'export' && mode !== 'import') {
    console.log('Usage: npx tsx scripts/docusign-templates.ts <export|import> [--apply]')
    process.exit(1)
  }
  if (!ENV.accountId || !ENV.integrationKey || !ENV.userId || !ENV.privateKey) {
    console.log('❌ DocuSign credentials missing from .env.local')
    process.exit(1)
  }

  console.log(`Account:     ${ENV.accountId}`)
  console.log(`Environment: ${environmentLabel()}\n`)

  const token = await getToken()
  if (mode === 'export') await doExport(token)
  else await doImport(token, apply)
}

main().catch((e) => { console.error(e); process.exit(1) })
