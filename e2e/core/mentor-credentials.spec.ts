import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'
import { freshClerkSession } from '../fixtures/fresh-session'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Mentor credentials (8 Oct 2026): every volunteer mentor assigned to an event
 * gets the Certificate of Appreciation credential from the Participation
 * credentials panel's Mentors filter. docs/PLAN-mentor-credentials-2026-10-08.md.
 *
 * The seeded teacher Grace stands in as the mentor because she can sign in
 * (Mae Mentor has no Clerk account), so the owner's page and download are
 * exercised too. She is rostered as a volunteer on the event container with the
 * service role rather than through the Volunteers panel, which would send a
 * DocuSign agreement. Her roster row, her mentor credentials and the event's
 * mentor wording are removed before and after each test, in hooks, so a
 * failure part-way leaves nothing behind (e2e-shared-fixture-state).
 */

const SLUG = 'nevada-space-design-challenge'
const GRACE_ID = '00000000-0000-4000-a000-000000000002' // supabase/seed.sql

function devDb() {
  const url = assertE2eSupabase()
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

async function containerId(): Promise<string> {
  const { data, error } = await devDb()
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', SLUG)
    .maybeSingle()
  expect(error, error?.message).toBeNull()
  expect(data?.id, `no event container for ${SLUG}`).toBeTruthy()
  return data!.id as string
}

async function reset() {
  const db = devDb()
  const cohort = await containerId()
  const steps = await Promise.all([
    db.from('credentials').delete().eq('source', 'event').eq('award_type', 'mentor').eq('member_id', GRACE_ID),
    db.from('cohort_members').delete().eq('cohort_id', cohort).eq('member_id', GRACE_ID).eq('relationship', 'volunteer'),
    db.from('event_settings').update({ mentor_credential_title: null }).eq('event_slug', SLUG),
  ])
  for (const { error } of steps) expect(error, error?.message).toBeNull()
}

test.describe('volunteer mentor credential', () => {
  test.beforeEach(reset)
  test.afterEach(reset)

  test('assigned mentors are issued once, listed apart from students, and can download', async ({ browser }) => {
    const db = devDb()
    const { error } = await db
      .from('cohort_members')
      .insert({ cohort_id: await containerId(), member_id: GRACE_ID, relationship: 'volunteer', status: 'active' })
    expect(error, error?.message).toBeNull()

    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    // A page that loads Clerk, kept open, and a token minted on it before the API
    // calls. Loading the page alone kept a saved token with seconds left, which
    // expired before the call: 401s in CI, 12–13 Nov 2026 (fixtures/fresh-session.ts).
    const adminPage = await admin.newPage()
    await adminPage.goto('/account')
    await freshClerkSession(adminPage)
    const base = `/api/admin/events/${SLUG}/credentials`

    // The mentors' own wording, kept apart from the students'.
    const saved = await admin.request.patch(base, { data: { audience: 'mentors', credential_title: 'E2E Mentor Title', credential_skills: [] } })
    expect(saved.status(), await saved.text()).toBe(200)

    const view = await (await admin.request.get(`${base}?audience=mentors`)).json()
    expect(view.settings.credential_title).toBe('E2E Mentor Title')
    expect(view.mentorCount).toBeGreaterThanOrEqual(1)
    const studentsView = await (await admin.request.get(`${base}?audience=students`)).json()
    expect(studentsView.settings.credential_title).not.toBe('E2E Mentor Title')

    const issue = () => admin.request.post(base, { data: { audience: 'mentors' } })
    const first = await (await issue()).json()
    expect(first.failures, JSON.stringify(first.failures)).toEqual([])
    expect(first.created).toBeGreaterThanOrEqual(1)

    // Idempotent: a second run creates nothing new for Grace.
    const again = await (await issue()).json()
    expect(again.created).toBe(0)

    const mentors = await (await admin.request.get(`${base}?audience=mentors`)).json()
    const grace = mentors.credentials.find((c: { member_id: string }) => c.member_id === GRACE_ID)
    expect(grace, 'Grace holds a mentor credential').toBeTruthy()
    expect(grace.award_type).toBe('mentor')
    expect(grace.role_label).toBe('Mentor')
    expect(grace.title).toBe('E2E Mentor Title')
    expect(grace.participant_id).toBeNull()

    // The Students filter does not list mentor rows.
    const students = await (await admin.request.get(`${base}?audience=students`)).json()
    expect(students.credentials.some((c: { award_type: string }) => c.award_type === 'mentor')).toBe(false)

    // The holder's view: the page, the wallet, and the certificate.
    const teacher = await browser.newContext({ storageState: storageStatePath('teacher') })
    // The credential page is public and loads no Clerk, so the teacher's token is
    // minted on her own account page, kept open beside it (as pd-credentials does).
    const teacherAccount = await teacher.newPage()
    await teacherAccount.goto('/account')
    const page = await teacher.newPage()
    await page.goto(`/credentials/${grace.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Mentor Title')
    await page.goto('/community/credentials')
    // In <main>: the page streams, so a page-wide getByText can also match the
    // hidden copy React parks outside <main> before moving it in.
    await expect(page.getByRole('main').getByText('E2E Mentor Title')).toBeVisible()
    await freshClerkSession(teacherAccount)
    const pdf = await page.request.get(`/api/credentials/${grace.number}/pdf`)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()['content-type']).toBe('application/pdf')

    await admin.close()
    await teacher.close()
  })
})

// ── Printing the mentor certificate on the event's own artwork ───────────────
// Tracker mentor-credentials.6: the print path on real artwork had no e2e. A
// throwaway event (not in Sanity) gets a volunteer container with Grace on it
// and its own Certificate of Appreciation artwork: a PNG this spec makes, at an
// odd size no real template has, so the PDF can be shown to carry this artwork
// and not a theme default. Everything is removed after, in hooks.

const ART_W = 403
const ART_H = 311

/** A flat-colour RGB PNG, built here so the spec needs no binary fixture. */
function artworkPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf: Buffer) => {
    let crc = 0xffffffff
    for (const byte of buf) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const row = width * 3 + 1
  const raw = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set([236, 240, 250], y * row + 1 + x * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Every line of text drawn on each page, read the way a PDF viewer reads it. */
async function pdfText(bytes: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true })
  const doc = await task.promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').trim())
  }
  await task.destroy()
  return pages
}

/** The pixel size of every image drawn on the PDF's first page. */
async function imageSizes(bytes: Buffer): Promise<[number, number][]> {
  const doc = await PDFDocument.load(bytes)
  const xobjects = doc.getPage(0).node.Resources()?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  if (!xobjects) return []
  return xobjects.keys().map((key) => {
    const image = xobjects.lookup(key) as PDFRawStream
    return [image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber(), image.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber()]
  })
}

test.describe('mentor certificate on the event artwork', () => {
  const printSlug = `e2e-mentor-cert-${randomBytes(4).toString('hex')}`
  const artworkPath = `e2e/mentor-certificate/${printSlug}.png`

  async function removePrintEvent() {
    const db = devDb()
    // Deleting the container removes its cohort_members rows (ON DELETE CASCADE).
    const steps = await Promise.all([
      db.from('event_certificate_templates').delete().eq('event_slug', printSlug),
      db.from('mentoring_cohorts').delete().eq('container_type', 'event_participation').eq('campaign_ref', printSlug),
    ])
    for (const { error } of steps) expect(error, error?.message).toBeNull()
    const { error } = await db.storage.from('community-resources').remove([artworkPath])
    expect(error, error?.message).toBeNull()
  }

  test.beforeEach(async () => {
    await removePrintEvent()
    const db = devDb()
    const { data: cohort, error: cohortError } = await db
      .from('mentoring_cohorts')
      .insert({ name: `E2E Mentor Certificate ${printSlug.slice(-8)}`, container_type: 'event_participation', campaign_ref: printSlug, parent_container_id: null })
      .select('id')
      .single()
    expect(cohortError, cohortError?.message).toBeNull()
    const { error: rosterError } = await db
      .from('cohort_members')
      .insert({ cohort_id: cohort!.id, member_id: GRACE_ID, relationship: 'volunteer', status: 'active' })
    expect(rosterError, rosterError?.message).toBeNull()
    const upload = await db.storage
      .from('community-resources')
      .upload(artworkPath, artworkPng(ART_W, ART_H), { contentType: 'image/png', upsert: true })
    expect(upload.error, upload.error?.message).toBeNull()
    const { error: templateError } = await db
      .from('event_certificate_templates')
      .insert({ event_slug: printSlug, award_type: 'mentor', artwork_path: artworkPath })
    expect(templateError, templateError?.message).toBeNull()
  })
  test.afterEach(removePrintEvent)

  test('an admin prints it as a PDF on that artwork, with the mentor’s name drawn', async ({ browser }) => {
    const { data: grace, error } = await devDb().from('members').select('first_name, last_name').eq('id', GRACE_ID).single()
    expect(error, error?.message).toBeNull()
    const name = `${grace!.first_name} ${grace!.last_name}`.replace(/\s+/g, ' ').trim()

    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    const adminPage = await admin.newPage()
    await adminPage.goto('/account')
    await freshClerkSession(adminPage)

    const res = await admin.request.get(`/api/admin/events/${printSlug}/certificates?award=mentor`)
    expect(res.status(), res.status() === 200 ? '' : await res.text()).toBe(200)
    expect(res.headers()['content-type']).toBe('application/pdf')
    expect(res.headers()['content-disposition']).toContain(`${printSlug}-certificates-mentor-us_letter.pdf`)

    const pdf = await res.body()
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    // One page per assigned mentor: Grace is the only one on this event.
    const pages = await pdfText(pdf)
    expect(pages).toEqual([name])
    // Drawn on this event's own artwork, at its own pixel size.
    expect(await imageSizes(pdf)).toContainEqual([ART_W, ART_H])
    // US Letter landscape.
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPage(0).getSize()).toEqual({ width: 792, height: 612 })

    await admin.close()
  })
})
