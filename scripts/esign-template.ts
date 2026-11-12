/**
 * Prepare, publish and approve documents for Stellr signing (the in-app
 * e-signature engine). Plan: docs/PLAN-esign-2026-10-02.md.
 *
 *   # 1. Convert a DocuSign export (from `npm run docusign:templates export`).
 *   #    Writes the cleaned PDF and the field map, and prints what became of
 *   #    every DocuSign field. Fails if any field is unnamed.
 *   npx tsx scripts/esign-template.ts convert minor scripts/docusign-templates/minor.json
 *
 *   #    Add --pdf <original.pdf> to use the agreement's own source file for the
 *   #    pages (recommended: DocuSign exports can carry an envelope-ID stamp).
 *
 *   # 1b. Or a document that never lived in DocuSign (the membership agreement):
 *   #     a PDF plus a hand-written field map.
 *   npx tsx scripts/esign-template.ts convert membership_adult --pdf membership.pdf --map membership_adult.fields.json
 *
 *   # 2. Upload it as a new, unapproved version. Read-only unless --apply.
 *   npx tsx scripts/esign-template.ts publish minor --title "Parental Consent Form" [--apply]
 *
 *   # 3. Check it: every value prints in its field; with --pdf, every page has
 *   #    the source document's exact wording; with --export, every DocuSign
 *   #    field is in the map, in the same place. Exits 1 on any problem.
 *   npx tsx scripts/esign-template.ts check minor 1 --pdf original.pdf --export scripts/docusign-templates/minor.json
 *   #    (no version: checks the files in esign-out/ before publishing)
 *
 *   # 4. Approve that version after checking the preview: it becomes the one
 *   #    new agreements use, and can no longer be changed. Runs the check
 *   #    first (pass --pdf and --export as above) and refuses on any problem.
 *   npx tsx scripts/esign-template.ts approve minor 1 --by "David Shaw" [--apply]
 *
 *   # 5. DEV ONLY: the placeholder for the tenant guardian-consent document
 *   #    (S5 wave 7, K5; owner decision W7-6). The real consent wording is a
 *   #    legal item for production and is not in this repo. The placeholder is
 *   #    titled "DEV PLACEHOLDER – NOT A CONSENT FORM" and says so on every page.
 *   #    Every hosted step refuses unless .env.local points at the dev project
 *   #    (or a stack on this machine) and NEXT_PUBLIC_APP_ENV is not prod. There
 *   #    is no override. Nothing is approved unless 5d runs with --apply. Each
 *   #    hosted step (--apply) needs the owner's yes at the time.
 *   #
 *   #    5a. Build it locally: esign-out/tenant_guardian_consent.pdf, .fields.json
 *   #        (from lib/esign/native/templates/tenant-guardian-consent-v1.fields.json)
 *   #        and .html. Writes no database.
 *   npx tsx scripts/esign-template.ts dev-placeholder tenant_guardian_consent
 *   #    5b. Upload it as a new, unapproved, inactive version, under the placeholder title.
 *   npx tsx scripts/esign-template.ts check tenant_guardian_consent
 *   npx tsx scripts/esign-template.ts publish tenant_guardian_consent --dev-placeholder [--apply]
 *   #    5c. K0: sign that version end to end on dev. It needs the publish, not the
 *   #        approval: the envelope names the version, and signing reads it by id.
 *   npx tsx scripts/esign-dev-issue.ts tenant_guardian_consent --version <version>
 *   #    5d. K7b: approve it on dev (it becomes the one consent envelopes use there).
 *   npx tsx scripts/esign-template.ts approve tenant_guardian_consent <version> --dev-placeholder --by "<who checked it>" [--apply]
 *
 *   #    A placeholder can be published or approved only with --dev-placeholder,
 *   #    and --dev-placeholder only on the whole placeholder. A PDF with the mark
 *   #    on any page, in any spelling, counts as a placeholder for every key.
 *   #    Admin → Agreement documents refuses one outside dev as well
 *   #    (lib/esign/native/template-admin.ts).
 *
 * Output lands in esign-out/ (gitignored). Field maps and overrides are
 * reviewed in the repo; PDFs live in the private agreement-templates bucket.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const OUT = path.resolve(process.cwd(), 'esign-out')
const OVERRIDES = path.resolve(process.cwd(), 'lib/esign/native/templates')
// No environment reads in these modules, so importing them before dotenv runs is safe.
import { DISCLOSURE_VERSION } from '../lib/esign/disclosure'
import {
  DEV_PLACEHOLDER_MAPS,
  DEV_PLACEHOLDER_MARK,
  DEV_PLACEHOLDER_TITLE,
  devPlaceholderTargetRefusal,
  isDevPlaceholderTitle,
  isWholeDevPlaceholder,
  pdfPlaceholderStatus,
  type PlaceholderPageStatus,
} from '../lib/esign/native/dev-placeholder'

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}
const has = (flag: string) => process.argv.includes(flag)

/** Throws unless a dev placeholder may go to the database .env.local points at. */
function assertDevPlaceholderTarget() {
  const refusal = devPlaceholderTargetRefusal({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    appEnv: process.env.NEXT_PUBLIC_APP_ENV,
  })
  if (refusal) throw new Error(`Refusing: ${refusal}`)
}

function assertDevPlaceholderKey(key: string) {
  if (!DEV_PLACEHOLDER_MAPS[key]) throw new Error(`${key} has no dev placeholder. Only: ${Object.keys(DEV_PLACEHOLDER_MAPS).join(', ')}`)
}

/** The pages that do not carry the exact placeholder title. */
function untitledPages(status: PlaceholderPageStatus): number[] {
  return Array.from({ length: status.pageCount }, (_, i) => i + 1).filter((n) => !status.titled.includes(n))
}

/**
 * Throws unless a document is consistent with the --dev-placeholder flag: with
 * it, the whole placeholder (title and every page); without it, no trace of one
 * (no placeholder title and no page with the mark in any spelling). For every key.
 */
function assertPlaceholderConsistent(label: string, title: string, status: PlaceholderPageStatus, placeholder: boolean) {
  if (placeholder) {
    if (!isDevPlaceholderTitle(title)) throw new Error(`${label} is not a dev placeholder ("${title}"); leave out --dev-placeholder`)
    if (!isWholeDevPlaceholder(status)) throw new Error(`${label} is not the whole dev placeholder: page(s) ${untitledPages(status).join(', ')} do not carry "${DEV_PLACEHOLDER_TITLE}". Run dev-placeholder first.`)
    return
  }
  if (isDevPlaceholderTitle(title)) throw new Error(`${label} has a dev placeholder title: use --dev-placeholder (dev only)`)
  if (status.marked.length) throw new Error(`${label}: page(s) ${status.marked.join(', ')} carry "${DEV_PLACEHOLDER_MARK}". A dev placeholder, or part of one, goes only with --dev-placeholder (dev only).`)
}

/** Step 5a: builds the dev placeholder in esign-out/. Local files only. */
async function devPlaceholder(key: string) {
  assertDevPlaceholderKey(key)
  const { parseFieldMap } = await import('../lib/esign/native/template')
  const { sanitisePdf, sha256Hex } = await import('../lib/esign/native/render')
  const { buildDevPlaceholderPdf, devPlaceholderTextHtml } = await import('../lib/esign/native/dev-placeholder')
  const map = parseFieldMap(JSON.parse(fs.readFileSync(path.resolve(DEV_PLACEHOLDER_MAPS[key]), 'utf8')))
  const clean = await sanitisePdf(await buildDevPlaceholderPdf(map))
  const status = await pdfPlaceholderStatus(clean.bytes)
  if (!isWholeDevPlaceholder(status)) throw new Error(`Page(s) ${untitledPages(status).join(', ')} do not carry "${DEV_PLACEHOLDER_TITLE}"`)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `${key}.pdf`), clean.bytes)
  fs.writeFileSync(path.join(OUT, `${key}.fields.json`), JSON.stringify(map, null, 2) + '\n')
  fs.writeFileSync(path.join(OUT, `${key}.html`), devPlaceholderTextHtml(map))
  console.log(`✓ ${key} dev placeholder: ${map.fields.length} fields, ${clean.pageCount} pages, each marked "${DEV_PLACEHOLDER_TITLE}", PDF sha256 ${sha256Hex(clean.bytes)}`)
  console.log(`  ${path.relative(process.cwd(), OUT)}/${key}.pdf, .fields.json and .html. Next: check, then publish --dev-placeholder (dev only).`)
}

async function convert(key: string, exportPath: string | undefined) {
  const { convertDocusignTemplate, exportPdf } = await import('../lib/esign/native/convert-docusign')
  const { parseFieldMap } = await import('../lib/esign/native/template')
  const { sanitisePdf, sha256Hex } = await import('../lib/esign/native/render')
  fs.mkdirSync(OUT, { recursive: true })

  let pdf: Buffer
  let map
  if (arg('--pdf') && arg('--map')) {
    pdf = fs.readFileSync(path.resolve(arg('--pdf') as string))
    map = parseFieldMap(JSON.parse(fs.readFileSync(path.resolve(arg('--map') as string), 'utf8')))
  } else {
    if (!exportPath) throw new Error('Give the DocuSign export JSON, or --pdf and --map')
    const exp = JSON.parse(fs.readFileSync(path.resolve(exportPath), 'utf8'))
    const overridesFile = path.join(OVERRIDES, `${key}.overrides.json`)
    const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {}
    const result = convertDocusignTemplate(exp, overrides)
    console.log(`\n${key}: what became of each DocuSign field`)
    for (const r of result.report) console.log(`  p${r.page} ${r.role.padEnd(20)} ${r.kind.padEnd(18)} ${r.tabLabel.slice(0, 44).padEnd(44)} → ${r.outcome}`)
    if (!result.map) {
      console.error(`\n✗ ${result.issues.length} field(s) need attention (edit ${path.relative(process.cwd(), overridesFile)}):`)
      for (const i of result.issues) console.error(`  p${i.page} ${i.role} ${i.kind} "${i.tabLabel}" [key p…@x,y shown above]: ${i.reason}`)
      process.exit(1)
    }
    // A PDF exported from DocuSign can carry a "Docusign Envelope ID" stamp
    // from an envelope it was once part of (the sandbox exports do). The
    // agreement's own source PDF, given with --pdf, avoids that; the export
    // then supplies only the field positions.
    if (arg('--pdf')) {
      pdf = fs.readFileSync(path.resolve(arg('--pdf') as string))
    } else {
      pdf = exportPdf(exp)
      console.warn('\n! Using the PDF embedded in the DocuSign export. Check its header for a "Docusign Envelope ID" stamp; if present, re-run with --pdf <original source PDF>.')
    }
    map = result.map
  }

  const clean = await sanitisePdf(pdf)
  const maxPage = Math.max(...map.fields.map((f) => f.page))
  if (maxPage > clean.pageCount) throw new Error(`Field on page ${maxPage}, but the PDF has ${clean.pageCount} pages`)

  fs.writeFileSync(path.join(OUT, `${key}.pdf`), clean.bytes)
  fs.writeFileSync(path.join(OUT, `${key}.fields.json`), JSON.stringify(map, null, 2) + '\n')
  console.log(`\n✓ ${key}: ${map.fields.length} fields, ${clean.pageCount} pages, PDF sha256 ${sha256Hex(clean.bytes)}`)
  console.log(`  ${path.relative(process.cwd(), OUT)}/${key}.pdf and ${key}.fields.json — review, then publish.`)
}

async function client() {
  const { createClient } = await import('@supabase/supabase-js')
  const { SECRET_KEY_VARS, supabaseFetch, supabaseSecretKey } = await import('../lib/supabase-keys')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabaseSecretKey()
  if (!url || !key) throw new Error(`NEXT_PUBLIC_SUPABASE_URL and ${SECRET_KEY_VARS} are required`)
  console.log(`Target: ${new URL(url).host}`)
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

async function publish(key: string) {
  const { parseFieldMap } = await import('../lib/esign/native/template')
  const { sanitisePdf, sha256Hex } = await import('../lib/esign/native/render')
  const placeholder = has('--dev-placeholder')
  if (placeholder) {
    assertDevPlaceholderKey(key)
    assertDevPlaceholderTarget()
    if (arg('--title') && arg('--title') !== DEV_PLACEHOLDER_TITLE) throw new Error(`A dev placeholder is titled "${DEV_PLACEHOLDER_TITLE}"; leave out --title`)
  }
  const title = placeholder ? DEV_PLACEHOLDER_TITLE : arg('--title')
  if (!title) throw new Error('--title is required (the document name signers see)')
  // Cleaned again on the way up (it is idempotent), so a file converted by an
  // older version of the converter, or edited by hand, cannot be published dirty.
  const pdf = Buffer.from((await sanitisePdf(fs.readFileSync(path.join(OUT, `${key}.pdf`)))).bytes)
  // Either the whole document is the placeholder and it goes only to dev, or
  // nothing in it is and it is a real document. Checked for every key.
  assertPlaceholderConsistent(`esign-out/${key}.pdf`, title, await pdfPlaceholderStatus(pdf), placeholder)
  const map = parseFieldMap(JSON.parse(fs.readFileSync(path.join(OUT, `${key}.fields.json`), 'utf8')))
  const htmlPath = path.join(OUT, `${key}.html`)
  const textHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : null
  const sha = sha256Hex(pdf)

  const db = await client()
  const { data: latest } = await db.from('esign_templates').select('version').eq('key', key).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = ((latest?.version as number | undefined) ?? 0) + 1
  const pdfPath = `${key}/v${version}-${sha.slice(0, 12)}.pdf`
  console.log(`${key} v${version}: ${map.fields.length} fields, sha256 ${sha}${textHtml ? ', with text version' : ', NO text version (add esign-out/' + key + '.html)'}`)
  if (!has('--apply')) { console.log('Dry run. Re-run with --apply to upload.'); return }

  const { error: upErr } = await db.storage.from('agreement-templates').upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)
  const { error } = await db.from('esign_templates').insert({
    key, version, title, pdf_path: pdfPath, pdf_sha256: sha,
    page_count: (await (await import('pdf-lib')).PDFDocument.load(pdf)).getPageCount(),
    field_map: map, text_html: textHtml, disclosure_version: DISCLOSURE_VERSION,
    created_by: process.env.USER ?? 'script',
  })
  if (error) throw new Error(`Recording the version failed: ${error.message}`)
  console.log(`✓ Published ${key} v${version} (not yet in use). Preview it in Admin → Consent forms → Agreement documents, check it, then approve.`)
}

/** Runs the template checks; returns the number of problems found. */
async function check(key: string, version: number | null): Promise<number> {
  const { parseFieldMap } = await import('../lib/esign/native/template')
  const { checkClean, checkPlacement, compareCoverage, compareWording } = await import('../lib/esign/native/template-check')
  let pdf: Uint8Array
  let map
  if (version) {
    const db = await client()
    const { loadTemplateById, loadTemplatePdf } = await import('../lib/esign/native/templates-store')
    const { data: row, error } = await db.from('esign_templates').select('id').eq('key', key).eq('version', version).maybeSingle()
    if (error || !row) throw new Error(`${key} v${version} does not exist`)
    const template = await loadTemplateById(db, row.id as string)
    pdf = await loadTemplatePdf(db, template) // verifies the stored hash
    map = template.map
  } else {
    pdf = fs.readFileSync(path.join(OUT, `${key}.pdf`))
    map = parseFieldMap(JSON.parse(fs.readFileSync(path.join(OUT, `${key}.fields.json`), 'utf8')))
  }

  const issues = [...await checkClean(pdf), ...await checkPlacement(pdf, map)]
  const ran = ['clean', 'placement']
  if (arg('--pdf')) {
    issues.push(...await compareWording(fs.readFileSync(path.resolve(arg('--pdf') as string)), pdf))
    ran.push('wording')
  }
  if (arg('--export')) {
    const { convertDocusignTemplate } = await import('../lib/esign/native/convert-docusign')
    const exp = JSON.parse(fs.readFileSync(path.resolve(arg('--export') as string), 'utf8'))
    const overridesFile = path.join(OVERRIDES, `${key}.overrides.json`)
    const overrides = fs.existsSync(overridesFile) ? JSON.parse(fs.readFileSync(overridesFile, 'utf8')) : {}
    const converted = convertDocusignTemplate(exp, overrides)
    if (!converted.map) issues.push({ check: 'coverage', message: `The DocuSign export no longer converts cleanly (${converted.issues.length} unnamed field(s))` })
    else issues.push(...compareCoverage(converted.map, map))
    ran.push('coverage')
  }
  const label = `${key}${version ? ` v${version}` : ' (esign-out)'}`
  for (const i of issues) console.error(`  ✗ ${i.check.padEnd(9)} ${i.message}`)
  console.log(`${issues.length ? '✗' : '✓'} ${label}: ${map.fields.length} fields; checked ${ran.join(', ')}; ${issues.length} problem(s)`)
  if (!arg('--pdf')) console.log('  Wording not checked: add --pdf <the agreement’s source PDF>.')
  if (!arg('--export') && !version) console.log('  Coverage not checked: add --export <DocuSign export JSON> for a converted template.')
  return issues.length
}

async function approve(key: string, version: number) {
  const by = arg('--by')
  if (!by) throw new Error('--by "<name>" is required: who checked this version')
  const placeholder = has('--dev-placeholder')
  if (placeholder) {
    assertDevPlaceholderKey(key)
    assertDevPlaceholderTarget()
  }
  if (await check(key, version)) throw new Error(`Not approved: fix the problems above, publish a new version, and check again`)
  const db = await client()
  const { data: row } = await db.from('esign_templates').select('id, approved_at, title').eq('key', key).eq('version', version).maybeSingle()
  if (!row) throw new Error(`${key} v${version} does not exist`)
  // The stored file as well as the title: a version saved under another title
  // from the placeholder's PDF is still the placeholder. check() above read the
  // same file, so this comes from the per-process cache, checked against its hash.
  const { loadTemplateById, loadTemplatePdf } = await import('../lib/esign/native/templates-store')
  const status = await pdfPlaceholderStatus(await loadTemplatePdf(db, await loadTemplateById(db, row.id as string)))
  assertPlaceholderConsistent(`${key} v${version}`, row.title as string, status, placeholder)
  if (placeholder) assertDevPlaceholderTarget()
  console.log(`Approve ${key} v${version} as the version new agreements use (approved by ${by}).`)
  if (!has('--apply')) { console.log('Dry run. Re-run with --apply.'); return }
  const now = new Date().toISOString()
  if (!row.approved_at) {
    const { error } = await db.from('esign_templates').update({ approved_by: by, approved_at: now }).eq('id', row.id)
    if (error) throw new Error(error.message)
  }
  await db.from('esign_templates').update({ active: false }).eq('key', key).eq('active', true)
  const { error } = await db.from('esign_templates').update({ active: true }).eq('id', row.id)
  if (error) throw new Error(error.message)
  console.log(`✓ ${key} v${version} is now active.`)
}

async function main() {
  const [cmd, key, third] = process.argv.slice(2)
  if (!cmd || !key) {
    console.log('Usage: esign-template.ts convert|dev-placeholder|publish|check|approve <key> …  (see the header of this file)')
    process.exit(1)
  }
  if (cmd === 'convert') return convert(key, third?.startsWith('--') ? undefined : third)
  if (cmd === 'dev-placeholder') return devPlaceholder(key)
  if (cmd === 'publish') return publish(key)
  if (cmd === 'approve') return approve(key, Number(third))
  if (cmd === 'check') {
    const version = third && !third.startsWith('--') ? Number(third) : null
    if (await check(key, version)) process.exit(1)
    return
  }
  throw new Error(`Unknown command ${cmd}`)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
