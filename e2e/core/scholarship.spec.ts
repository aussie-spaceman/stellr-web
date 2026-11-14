import { expect, test } from '../fixtures/test'
import { freshClerkSession } from '../fixtures/fresh-session'
import { storageStatePath } from '../fixtures/users'
import {
  SCHOLARSHIP_EVENT,
  applicationFor,
  memberFor,
  newApplicant,
  recordOfferDirectly,
  removeApplicant,
  serverReadsCms,
  type Applicant,
} from '../fixtures/scholarship'

/**
 * Scholarships end to end (tracker scholarship-offers.9;
 * docs/PLAN-scholarship-offers-2026-10-02.md): a student applies on the public
 * form, an admin offers 50%, and the offer link opens and carries the offer
 * into the registration form.
 *
 * The applicant is new each run, at example.test, and everything filed under
 * that address is removed before and after (fixtures/scholarship.ts). The offer
 * is made with "Email … now" off, so the route sends nothing.
 *
 * The CMS: the offer route and the registration form read the event from Sanity,
 * and the CI e2e job has no Sanity project. There the route's refusal is pinned
 * instead, the offer is written directly (the same columns the route writes)
 * so the offer link is still tested, and the registration-form step is skipped
 * with a note. Wherever the server reads the CMS, every step runs for real.
 */

const BRIEF = 'E2E: the fee is the only thing stopping me. Please ignore this application.'

test.describe('scholarship application to offer', () => {
  let applicant: Applicant
  test.beforeEach(async () => {
    applicant = newApplicant()
    await removeApplicant(applicant.email)
  })
  test.afterEach(async () => {
    if (applicant) await removeApplicant(applicant.email)
  })

  test('a student applies, an admin offers 50%, and the offer link opens the registration with it', async ({ browser }) => {
    // ── 1. The public form, signed out ──────────────────────────────────────
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const form = await visitor.newPage()
    await form.goto('/scholarship')
    // Typed into before hydration, the click would submit the bare HTML form.
    await form.waitForLoadState('networkidle')
    await form.locator('#firstName').fill(applicant.firstName)
    await form.locator('#lastName').fill(applicant.lastName)
    await form.locator('#email').fill(applicant.email)
    // On every list: the live events end with it, and so does the fallback.
    await form.locator('#activity').selectOption('Not sure yet')
    await form.locator('#brief').fill(BRIEF)
    await form.getByRole('button', { name: 'Submit application' }).click()
    await expect(form.getByRole('heading', { name: 'Thanks for submitting!' })).toBeVisible()

    const filed = await applicationFor(applicant.email)
    expect(filed, 'the application row was saved').not.toBeNull()
    expect(filed).toMatchObject({
      status: 'submitted',
      first_name: applicant.firstName,
      last_name: applicant.lastName,
      activity: 'Not sure yet',
      brief: BRIEF,
      // "Not sure yet" names no event, and a signed-out applicant is linked later.
      event_slug: null,
      member_id: null,
      percent_off: null,
      offer_token: null,
    })
    const id = filed!.id

    // ── 2. The admin review queue lists it ──────────────────────────────────
    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    const adminPage = await admin.newPage()
    await adminPage.goto('/admin/scholarships')
    // In <main>: the admin pages stream (see registration-docusign.spec.ts).
    await expect(adminPage.getByRole('main').getByText(`${applicant.firstName} ${applicant.lastName}`).first()).toBeVisible()
    await freshClerkSession(adminPage)

    // Only admins decide: a teacher is refused, and nothing changes.
    const teacher = await browser.newContext({ storageState: storageStatePath('teacher') })
    const teacherPage = await teacher.newPage()
    await teacherPage.goto('/account')
    await freshClerkSession(teacherPage) // a stale cookie's 401 is not the 403 this proves
    const refused = await teacher.request.post(`/api/admin/scholarships/${id}/offer`, {
      data: { percent: 50, eventSlug: SCHOLARSHIP_EVENT, sendEmails: false },
    })
    expect(refused.status()).toBe(403)
    expect((await applicationFor(applicant.email))?.status).toBe('submitted')

    // ── 3. The offer ────────────────────────────────────────────────────────
    const cms = await serverReadsCms(visitor.request)
    const offer = await admin.request.post(`/api/admin/scholarships/${id}/offer`, {
      data: { percent: 50, eventSlug: SCHOLARSHIP_EVENT, sendEmails: false },
    })
    let token: string
    let eventTitle: string
    if (cms) {
      expect(offer.status(), await offer.text()).toBe(200)
      // Nothing emailed (sendEmails: false), and no registration yet: the
      // student completes their own details from the offer link.
      expect(await offer.json()).toMatchObject({ ok: true, registrationId: null, emailedTo: [], refund: null })

      const offered = await applicationFor(applicant.email)
      const member = await memberFor(applicant.email)
      expect(member, 'the offer made the student a member record').not.toBeNull()
      expect(offered).toMatchObject({ status: 'offered', percent_off: 50, event_slug: SCHOLARSHIP_EVENT, member_id: member!.id, registration_id: null })
      expect(offered!.offer_token).toMatch(/^[0-9a-f]{64}$/)
      expect(offered!.event_title).toBeTruthy()
      token = offered!.offer_token!
      eventTitle = offered!.event_title!

      // An offer is made once.
      const twice = await admin.request.post(`/api/admin/scholarships/${id}/offer`, {
        data: { percent: 100, eventSlug: SCHOLARSHIP_EVENT, sendEmails: false },
      })
      expect(twice.status()).toBe(409)
      expect((await applicationFor(applicant.email))?.percent_off).toBe(50)
    } else {
      test.info().annotations.push({
        type: 'no CMS',
        description: 'The server reads no events, so the offer route refuses every event; the offer was written directly and the registration-form step skipped.',
      })
      expect(offer.status()).toBe(400)
      expect(await offer.json()).toEqual({ error: 'Choose an event for this scholarship' })
      expect((await applicationFor(applicant.email))?.status, 'a refused offer changes nothing').toBe('submitted')
      eventTitle = 'Nevada Space Design Challenge'
      token = await recordOfferDirectly(id, 50, SCHOLARSHIP_EVENT, eventTitle)
    }

    // ── 4. The offer link, signed out: the next step is the details ─────────
    const offerPage = await visitor.newPage()
    const opened = await offerPage.goto(`/scholarship/offer/${token}`)
    expect(opened?.status()).toBe(200)
    await expect(offerPage.getByText('50% scholarship', { exact: true })).toBeVisible()
    await expect(offerPage.getByRole('heading', { level: 1 })).toHaveText(eventTitle)
    await expect(offerPage.getByText(`Congratulations, ${applicant.firstName} — your place is reserved.`)).toBeVisible()
    const next = offerPage.getByRole('link', { name: 'Complete my registration' })
    await expect(next).toHaveAttribute('href', new RegExp(`/register/${SCHOLARSHIP_EVENT}/individual\\?scholarship=${token}$`))
    // A paid level shows the payment step to come.
    await expect(offerPage.getByText('Your scholarship is already applied — no code needed.')).toBeVisible()

    // A link nobody was sent opens nothing.
    await offerPage.goto(`/scholarship/offer/${'0'.repeat(64)}`)
    await expect(offerPage.getByRole('heading', { level: 1 })).toHaveText("This offer link isn't active")

    // ── 5. The registration form accepts the offer ──────────────────────────
    if (cms) {
      const register = await visitor.newPage()
      await register.goto(`/register/${SCHOLARSHIP_EVENT}/individual?scholarship=${token}`)
      await expect(register.getByText('Your 50% scholarship is applied to this registration.')).toBeVisible()
      // Prefilled from the application, so the student retypes nothing.
      await expect(register.locator('input[name="first_name"]')).toHaveValue(applicant.firstName)
      await expect(register.locator('input[name="last_name"]')).toHaveValue(applicant.lastName)

      // A token nobody was sent is ignored: the ordinary public form.
      await register.goto(`/register/${SCHOLARSHIP_EVENT}/individual?scholarship=${'0'.repeat(64)}`)
      await expect(register.getByText(/scholarship is applied to this registration/)).toHaveCount(0)
    }

    await visitor.close()
    await admin.close()
    await teacher.close()
  })
})
