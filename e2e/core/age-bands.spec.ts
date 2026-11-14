import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'
import {
  BANDS,
  MINOR_SELF_SIGNUP,
  adultProfile,
  asStranger,
  childStep,
  dobForAge,
  guardianEmail,
  memberFor,
  onboarded,
  pendingFor,
  postOnboarding,
  profile,
  removeStranger,
  signUp,
  strangerEmail,
  type Band,
  type Stranger,
} from '../fixtures/age-bands'

/**
 * Sign-up and registration by age band (plan S1 gate, before
 * MINOR_SELF_SIGNUP_ENABLED goes on).
 *
 * For each age the gate names (12, 13, 15, 17, 18, and no date of birth), a
 * stranger with no account finds the way in from a public page and from a
 * member-only page, signs up, and submits the onboarding the wizard submits.
 * What then happens is the server's rule for its mode:
 *
 *   flag off (2 Oct 2026 behaviour): an adult is active at once; anyone under
 *     18 is refused (minor_self_signup_closed) and has no account; no date of
 *     birth is refused.
 *   flag on (decision 24): an adult is active at once; 13 to 17 finish their
 *     profile into a pending state that waits for a guardian; under 13 keeps a
 *     first name, date of birth and parent's email only, and is not active; no
 *     date of birth is refused (dob_missing), never treated as an adult.
 *
 * MINOR_SELF_SIGNUP_ENABLED is the server's environment. Playwright starts the
 * server with this process's environment, so the spec reads it here, and every
 * test also checks the server agrees (the age screen exists only with the flag
 * on) before relying on it.
 *
 * The consent itself (the guardian signing) and the 30-day purge are in
 * age-bands-consent.spec.ts.
 */

test.use({ storageState: { cookies: [], origins: [] } })

let strangers: Stranger[] = []
test.afterEach(async () => {
  const made = strangers
  strangers = []
  for (const s of made) removeStranger(s)
})

type Entry = 'public page' | 'member-only page'
const ENTRIES: Entry[] = ['public page', 'member-only page']

/** From a signed-out page to the sign-up form, the way a stranger finds it. */
async function findSignUp(page: Page, entry: Entry): Promise<void> {
  if (entry === 'public page') {
    // The site's own "Join" link, in the header of a public page.
    await page.goto('/')
    await page.locator('a[href$="/sign-up"]:visible').first().click()
  } else {
    // A member-only page sends a signed-out visitor to sign in, whose card
    // links on to sign-up: anyone can create an account (decision 24).
    await page.goto('/account')
    await expect(page).toHaveURL(/\/sign-in\?redirect_url=.*%2Faccount/, { timeout: 30_000 })
    await page.getByRole('link', { name: 'Sign up' }).click()
  }
  await expect(page).toHaveURL(/\/sign-up/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible({ timeout: 30_000 })
}

/** Where the stranger lands after signing up: onboarding, from either entry. */
async function landOnOnboarding(page: Page, entry: Entry): Promise<void> {
  // The sign-up form sends a new account to /account/onboarding; the
  // member-only page they came from sends them there too until they finish.
  await page.goto(entry === 'public page' ? '/account/onboarding' : '/account')
  await expect(page).toHaveURL(/\/account\/onboarding/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Complete your profile')
}

const label = (band: Band) => (band === 'unknown' ? 'no date of birth' : `age ${band}`)

for (const band of BANDS) {
  for (const entry of ENTRIES) {
    test(`${label(band)}: a stranger signs up from a ${entry} and registers`, async ({ page, baseURL }) => {
      test.setTimeout(120_000)
      const dob = band === 'unknown' ? null : dobForAge(band)
      const guardian = guardianEmail(String(band))
      const stranger: Stranger = { email: strangerEmail(String(band)), clerkUserId: null }
      strangers.push(stranger)

      await asStranger(page)
      await findSignUp(page, entry)
      await signUp(page, stranger, baseURL)
      await landOnOnboarding(page, entry)
      const clerkUserId = stranger.clerkUserId!

      // The server's mode is the spec's mode: the age screen answers only with
      // the flag on, and says which form follows without naming an age.
      const screen = await postOnboarding(page, { stage: 'age', date_of_birth: dob ?? undefined })
      if (!MINOR_SELF_SIGNUP) {
        expect(screen.status(), 'the server has an age screen, so MINOR_SELF_SIGNUP_ENABLED is on there but not here').toBe(404)
      } else if (dob === null) {
        expect(screen.status()).toBe(400)
        expect((await screen.json()).code).toBe('dob_missing')
      } else {
        expect(screen.status(), 'the server has no age screen, so MINOR_SELF_SIGNUP_ENABLED is off there but on here').toBe(200)
        expect((await screen.json()).band).toBe(band === 18 ? 'adult' : band === 12 ? 'child' : 'teen')
      }

      // ── 18: active at once, in either mode ──────────────────────────────
      if (band === 18) {
        const res = await postOnboarding(page, adultProfile(dob!))
        expect(res.status(), await res.text()).toBe(200)
        const body = await res.json()
        expect(body).toMatchObject({ success: true })
        expect(body.pendingConsent).toBeUndefined()
        const member = await memberFor(clerkUserId)
        expect(onboarded(member), 'an adult is a full member at once').toBe(true)
        expect(await pendingFor(member!.id), 'and owes nobody a consent form').toBeNull()
        await page.goto('/account')
        await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 })
        return
      }

      // ── No date of birth: refused in either mode (fail closed) ──────────
      if (dob === null) {
        const res = await postOnboarding(page, profile(null, guardian))
        expect(res.status(), await res.text()).toBe(400)
        if (MINOR_SELF_SIGNUP) expect((await res.json()).code).toBe('dob_missing')
        expect(onboarded(await memberFor(clerkUserId)), 'no account without a date of birth').toBe(false)
        await page.goto('/account')
        await expect(page).toHaveURL(/\/account\/onboarding/, { timeout: 30_000 })
        return
      }

      // ── Under 18, flag off: refused, no account ─────────────────────────
      if (!MINOR_SELF_SIGNUP) {
        const res = await postOnboarding(page, profile(dob, guardian))
        expect(res.status(), await res.text()).toBe(403)
        expect((await res.json()).code).toBe('minor_self_signup_closed')
        const member = await memberFor(clerkUserId)
        expect(onboarded(member), 'a minor cannot self-register while the flag is off').toBe(false)
        if (member) expect(await pendingFor(member.id), 'and nothing is pending for them').toBeNull()
        await page.goto('/account')
        await expect(page).toHaveURL(/\/account\/onboarding/, { timeout: 30_000 })
        return
      }

      // ── 13 to 17, flag on: a full profile, held pending ─────────────────
      if (band !== 12) {
        const res = await postOnboarding(page, profile(dob, guardian))
        expect(res.status(), await res.text()).toBe(200)
        expect(await res.json()).toMatchObject({ success: true, pendingConsent: 'guardian' })
        const member = await memberFor(clerkUserId)
        expect(onboarded(member), 'a teenager finishes their profile').toBe(true)
        expect(await pendingFor(member!.id)).toMatchObject({ band: 'teen', guardian_email: guardian, consented_at: null })
        // Onboarding shows who the form went to, not the form again.
        await page.goto('/account/onboarding')
        await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there')
        return
      }

      // ── 12, flag on: first name, date of birth, parent's email; inactive ─
      // The full form is not for them: the under-13 step asks for less.
      const full = await postOnboarding(page, profile(dob, guardian))
      expect(full.status(), await full.text()).toBe(400)
      const res = await postOnboarding(page, childStep(dob, guardian))
      expect(res.status(), await res.text()).toBe(200)
      expect(await res.json()).toMatchObject({ success: true, pendingConsent: 'parent' })
      const member = await memberFor(clerkUserId)
      expect(member).toMatchObject({ first_name: 'Sky', date_of_birth: dob, gender: null, phone: null })
      expect(onboarded(member), 'a child has no active account before the parent consents').toBe(false)
      expect(await pendingFor(member!.id)).toMatchObject({ band: 'child', guardian_email: guardian, consented_at: null })
      // Nothing more may be added to the profile until then.
      const patch = await page.request.patch('/api/members/me', { data: { gender: 'female' } })
      expect(patch.status()).toBe(403)
      expect((await patch.json()).code).toBe('guardian_consent_pending')
      await page.goto('/account')
      await expect(page).toHaveURL(/\/account\/onboarding/, { timeout: 30_000 })
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there')
    })
  }
}
