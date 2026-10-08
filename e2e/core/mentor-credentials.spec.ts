import { createClient } from '@supabase/supabase-js'
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
const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

function devDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  // Never against anything but the dev project.
  expect(url, 'mentor e2e fixtures run only against the dev database').toContain(DEV_PROJECT_REF)
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
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
  expect(data?.id, `no event container for ${SLUG} on dev`).toBeTruthy()
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
    const page = await teacher.newPage()
    await page.goto(`/credentials/${grace.number}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('E2E Mentor Title')
    await page.goto('/community/credentials')
    await expect(page.getByText('E2E Mentor Title')).toBeVisible()
    const pdf = await page.request.get(`/api/credentials/${grace.number}/pdf`)
    expect(pdf.status()).toBe(200)
    expect(pdf.headers()['content-type']).toBe('application/pdf')

    await admin.close()
    await teacher.close()
  })
})
