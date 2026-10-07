import { createClient } from '@supabase/supabase-js'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * Educator PD credentials (7 Oct 2026): an admin records a teacher's hours at
 * an event; the teacher sees the hours and standards on the credential page
 * and downloads the PD certificate. docs/PLAN-educator-pd-2026-10-07.md.
 *
 * Issued to the seeded teacher Grace on an event with registrations on the dev
 * DB. The route reads title/date/venue from Sanity and falls back to the
 * registrations' title when Sanity has none — CI has no Sanity credentials
 * (the first CI run failed "Event not found", 7 Oct). Her PD rows are deleted before and
 * after each test with the service role — in a hook, so a failure part-way
 * cannot leave a live PD credential blocking the next run (see the 24 Sept
 * note in credentials.spec.ts).
 */

const SLUG = 'nevada-space-design-challenge'
const GRACE_ID = '00000000-0000-4000-a000-000000000002' // supabase/seed.sql
const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

async function removeGracePd() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  // Never against anything but the dev project.
  expect(url, 'PD e2e cleanup runs only against the dev database').toContain(DEV_PROJECT_REF)
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
  const { error } = await db.from('credentials').delete().eq('source', 'pd').eq('member_id', GRACE_ID)
  expect(error, `removing Grace's PD credentials: ${error?.message}`).toBeNull()
}

test.describe('educator PD credential', () => {
  test.beforeEach(removeGracePd)
  test.afterEach(removeGracePd)

  test('an admin issues hours once; the teacher sees them and downloads the certificate', async ({ browser }) => {
    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    const issue = (hours: number) =>
      admin.request.post(`/api/admin/events/${SLUG}/pd-credentials`, { data: { memberId: GRACE_ID, hours } })

    const first = await issue(7.5)
    expect(first.status(), await first.text()).toBe(200)
    const { created, credential } = await first.json()
    expect(created).toBe(true)
    expect(credential.title).toMatch(/^Professional Development — .+ \(7\.5 hours\)$/)
    expect(credential.standards.length).toBeGreaterThan(0)

    // Idempotent: a second issue returns the live one, hours unchanged.
    const again = await (await issue(4)).json()
    expect(again.created).toBe(false)
    expect(again.credential.number).toBe(credential.number)
    expect(Number(again.credential.pd_hours)).toBe(7.5)

    // The participation panel's list does not pick PD rows up.
    const participation = await (await admin.request.get(`/api/admin/events/${SLUG}/credentials`)).json()
    expect(participation.credentials.some((c: { source: string }) => c.source === 'pd')).toBe(false)

    const teacher = await browser.newContext({ storageState: storageStatePath('teacher') })
    const page = await teacher.newPage()
    await page.goto(`/credentials/${credential.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('(7.5 hours)')
    await expect(page.getByText('7.5 PD hours')).toBeVisible()
    await expect(page.getByText('Aligned to')).toBeVisible()

    // Owner download; PD is never held behind the survey.
    const pdf = await page.request.get(`/api/credentials/${credential.number}/pdf`)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()['content-type']).toBe('application/pdf')

    // Only admins record hours: the teacher (not an event manager) is refused.
    const refused = await teacher.request.post(`/api/admin/events/${SLUG}/pd-credentials`, { data: { memberId: GRACE_ID, hours: 2 } })
    expect(refused.status()).toBe(403)

    await admin.close()
    await teacher.close()
  })
})
