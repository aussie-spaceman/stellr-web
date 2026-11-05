/**
 * seed-e2e-stack.ts: everything the disposable e2e database needs that plain SQL
 * cannot give it. Runs after scripts/e2e-stack-db.sh, on the runner.
 *
 *   npm run seed:e2e-stack
 *
 *   1. Agreement documents. The real PDFs live only in the dev project's storage,
 *      and legal documents do not belong in a public repo. Signing needs a PDF of
 *      the right length and the real field map, not the wording, so each document
 *      here is blank pages plus the map from lib/esign/native/templates. Whether
 *      the real documents print correctly stays with scripts/esign-template.ts.
 *   2. Survey definitions, from the JSON in lib/survey/definitions.
 *   3. Clerk links. members.clerk_user_id must match the Clerk dev instance, so it
 *      is looked up by address here and never committed (see supabase/seed.sql).
 *
 * Refuses anything but a Supabase stack on this machine, and anything but a Clerk
 * test key. The dev project already has all of this; writing it there would put
 * fake documents in front of manual testing.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClerkClient } from '@clerk/backend'
import { createClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { FIXTURES } from '../e2e/fixtures/users'
import { DISCLOSURE_VERSION } from '../lib/esign/disclosure'
import { parseFieldMap } from '../lib/esign/native/template'
import { TEMPLATE_BUCKET } from '../lib/esign/native/templates-store'
import { supabaseFetch, supabaseSecretKey } from '../lib/supabase-keys'
import { isLoopbackSupabase } from '../lib/testing/e2e-supabase-target'

/** Same titles and lengths as the active versions on dev. The specs find documents by title. */
const DOCUMENTS = [
  { key: 'minor', title: 'Participation Agreement — Student / Minor', pages: 9 },
  { key: 'adult', title: 'Participation Agreement — Educator / Chaperone', pages: 4 },
  { key: 'mentor', title: 'Mentor and Volunteer Agreement', pages: 5 },
] as const

/** Oldest first: the newest published version is the one new surveys use. */
const SURVEY_DEFINITIONS = ['lib/survey/definitions/post_event.v1.json', 'lib/survey/definitions/post_event.v1.1.json']

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secretKey = supabaseSecretKey()
const clerkSecret = process.env.CLERK_SECRET_KEY

if (!isLoopbackSupabase(url)) throw new Error('seed-e2e-stack writes only to a Supabase stack on this machine.')
if (!secretKey) throw new Error('SUPABASE_SECRET_KEY is not set.')
if (!clerkSecret?.startsWith('sk_test_')) throw new Error('seed-e2e-stack needs a Clerk test key (sk_test_).')

const db = createClient(url as string, secretKey, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })

async function blankDocument(title: string, pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([612, 792])
    page.drawText(`${title} (e2e fixture, page ${n})`, { x: 50, y: 750, size: 12, font })
  }
  return pdf.save()
}

async function seedDocuments() {
  for (const { key, title, pages } of DOCUMENTS) {
    const map = parseFieldMap(JSON.parse(readFileSync(`lib/esign/native/templates/${key}-v2-3.fields.json`, 'utf8')))
    const offPage = map.fields.filter((f) => f.page > pages)
    if (offPage.length) throw new Error(`${key}: field ${offPage[0].name} is on page ${offPage[0].page} of a ${pages}-page fixture.`)

    const bytes = await blankDocument(title, pages)
    const sha = createHash('sha256').update(bytes).digest('hex')
    const pdfPath = `${key}/v1-${sha.slice(0, 12)}.pdf`
    const { error: uploadError } = await db.storage.from(TEMPLATE_BUCKET).upload(pdfPath, bytes, { contentType: 'application/pdf' })
    if (uploadError) throw new Error(`Uploading ${key}: ${uploadError.message}`)

    const { error } = await db.from('esign_templates').insert({
      key,
      version: 1,
      title,
      pdf_path: pdfPath,
      pdf_sha256: sha,
      page_count: pages,
      field_map: map,
      disclosure_version: DISCLOSURE_VERSION,
      source: 'e2e-fixture',
      approved_by: 'seed-e2e-stack',
      approved_at: new Date().toISOString(),
      active: true,
    })
    if (error) throw new Error(`Recording ${key}: ${error.message}`)
    console.log(`Document: ${key}, ${pages} pages, ${map.fields.length} fields.`)
  }
}

function seedSurveys() {
  for (const file of SURVEY_DEFINITIONS) {
    execFileSync('npx', ['tsx', 'scripts/survey-definition.ts', file, '--publish'], { stdio: 'inherit', env: process.env })
  }
}

async function linkClerkUsers() {
  const clerk = createClerkClient({ secretKey: clerkSecret })
  for (const [role, fixture] of Object.entries(FIXTURES)) {
    const { data } = await clerk.users.getUserList({ emailAddress: [fixture.email] })
    const user = data[0]
    if (!user) {
      // A fixture nobody has a password for skips its own specs. One that can
      // sign in but has no member row would fail them with a misleading error.
      if (process.env[fixture.passwordVar]) throw new Error(`No Clerk user for the ${role} fixture.`)
      console.log(`Clerk: ${role} not provisioned, left unlinked.`)
      continue
    }
    const { error, count } = await db
      .from('members')
      .update({ clerk_user_id: user.id }, { count: 'exact' })
      .eq('id', fixture.memberId)
    if (error) throw new Error(`Linking ${role}: ${error.message}`)
    if (count !== 1) throw new Error(`Linking ${role}: expected one member row, updated ${count}.`)
    console.log(`Clerk: ${role} linked.`)

    // Keyed on the Clerk id, which is why supabase/seed.sql leaves it commented out.
    if (role === 'event_manager') {
      const { error: assignError } = await db
        .from('event_manager_assignments')
        .insert({ clerk_user_id: user.id, event_slug: 'seed-regional-challenge' })
      if (assignError) throw new Error(`Assigning ${role}: ${assignError.message}`)
      console.log(`Clerk: ${role} assigned to its one event.`)
    }
  }
}

async function main() {
  await seedDocuments()
  seedSurveys()
  await linkClerkUsers()
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
