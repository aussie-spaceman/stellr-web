import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'
import {
  FLAG_OFF_REASON,
  MINOR_SELF_SIGNUP,
  adultProfile,
  asStranger,
  backdatePendingRequest,
  childStep,
  clerkUserExists,
  db,
  dobForAge,
  esignConfigured,
  guardianEmail,
  guardianSigns,
  issueConsentForm,
  memberFor,
  onboarded,
  pendingFor,
  postOnboarding,
  profile,
  removeStranger,
  runPurge,
  signUp,
  strangerEmail,
  studentSigns,
  type Stranger,
} from '../fixtures/age-bands'

/**
 * Pending consent and the 30-day purge (plan S1 gate):
 *
 *   - a 15-year-old is held pending until their consent form is signed, and
 *     then gets in;
 *   - a 12-year-old has no active account until the parent consents;
 *   - an unconsented pending account is purged at 30 days, and an adult's is not.
 *
 * All three need a pending account, which only a server with
 * MINOR_SELF_SIGNUP_ENABLED=true makes (lib/pending-consent), so with the flag
 * off they skip, saying so. The flag is the server's environment, which
 * Playwright starts with this process's; each test also checks the server
 * agrees before relying on it (the age screen answers only with the flag on).
 *
 * The consent form: the app sends it through whichever signing engine the
 * database routes to, and the dev database routes to DocuSign, whose pages a
 * test cannot sign (CI holds no DocuSign credentials either). So the fixture
 * issues the same Student / Minor form on Stellr signing (event slug
 * 'membership', the parent or guardian first, then the student) and the test
 * signs it from the links the emails carry. Completing it runs the app's
 * completion hook, which is what releases the account.
 *
 * The purge: the daily cron route runs it in production only
 * (app/api/cron/membership-expiry declines elsewhere). The test calls the route
 * with the CRON_SECRET header, as a cron is called, and checks it declines and
 * deletes nothing; then the fixture runs the function the route runs, with the
 * app's own deletion, against only the accounts the test made. The pending
 * request is backdated with the fixtures' usual secret-key write on that one
 * row (as ./check-in.ts and ./esign.ts write theirs).
 */

test.use({ storageState: { cookies: [], origins: [] } })
test.skip(!MINOR_SELF_SIGNUP, FLAG_OFF_REASON)

let strangers: Stranger[] = []
test.afterEach(async () => {
  const made = strangers
  strangers = []
  for (const s of made) removeStranger(s)
})

/** A new stranger, signed up and on onboarding, the server's mode checked. Call asStranger(page) first. */
async function newStranger(page: Page, label: string, baseURL: string | undefined, dob: string): Promise<Stranger> {
  const stranger: Stranger = { email: strangerEmail(label), clerkUserId: null }
  strangers.push(stranger)
  await signUp(page, stranger, baseURL)
  await page.goto('/account/onboarding')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Complete your profile', { timeout: 30_000 })
  const screen = await postOnboarding(page, { stage: 'age', date_of_birth: dob })
  expect(screen.status(), 'the server has no age screen, so MINOR_SELF_SIGNUP_ENABLED is off there but on here').toBe(200)
  return stranger
}

async function memberId(stranger: Stranger): Promise<string> {
  const member = await memberFor(stranger.clerkUserId!)
  if (!member) throw new Error('the stranger has no member row')
  return member.id
}

test.describe('pending consent', () => {
  test.skip(!esignConfigured(), 'ESIGN_TOKEN_SECRET is not set, so Stellr signing is off')

  test('a 15-year-old is held pending until their consent form is signed, then gets in', async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    const dob = dobForAge(15)
    const guardian = guardianEmail('15')
    await asStranger(page)
    const stranger = await newStranger(page, 'consent-15', baseURL, dob)

    const res = await postOnboarding(page, profile(dob, guardian))
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toMatchObject({ pendingConsent: 'guardian' })
    const id = await memberId(stranger)
    expect(await pendingFor(id)).toMatchObject({ band: 'teen', consented_at: null })
    await page.goto('/account/onboarding')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there')

    const form = issueConsentForm({ memberId: id, dateOfBirth: dob, firstName: 'Sky', studentEmail: stranger.email, guardianEmail: guardian })
    expect(form.signers.map((s) => s.role)).toEqual(['Guardian', 'Minor'])

    // The guardian signs first. The form is not complete until the student
    // has signed too, so the account is still held.
    await guardianSigns(page, form)
    expect((await pendingFor(id))?.consented_at, 'held until the form is complete').toBeNull()
    await page.goto('/account/onboarding')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there')

    // The student signs: the form completes, and the account is released.
    await studentSigns(page, form)
    await expect.poll(async () => (await pendingFor(id))?.consented_at ?? null, { timeout: 30_000 }).not.toBeNull()
    await page.goto('/account/onboarding')
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 })
    expect(onboarded(await memberFor(stranger.clerkUserId!))).toBe(true)
  })

  test('a 12-year-old has no active account until the parent consents', async ({ page, baseURL }) => {
    test.setTimeout(240_000)
    const dob = dobForAge(12)
    const parent = guardianEmail('12')
    await asStranger(page)
    const stranger = await newStranger(page, 'consent-12', baseURL, dob)

    const res = await postOnboarding(page, childStep(dob, parent))
    expect(res.status(), await res.text()).toBe(200)
    expect(await res.json()).toMatchObject({ pendingConsent: 'parent' })
    const id = await memberId(stranger)
    expect(onboarded(await memberFor(stranger.clerkUserId!))).toBe(false)
    expect(await pendingFor(id)).toMatchObject({ band: 'child', consented_at: null })

    // Before consent: the under-13 step is all they can send (the full profile
    // is refused), and no profile field may be added.
    expect((await postOnboarding(page, profile(dob, parent))).status()).toBe(400)
    const patch = await page.request.patch('/api/members/me', { data: { gender: 'female' } })
    expect(patch.status()).toBe(403)
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account\/onboarding/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Almost there')

    // The parent signs (with the attestation and the birth-year check), then
    // the child: the form completes and the request is cleared.
    const form = issueConsentForm({ memberId: id, dateOfBirth: dob, firstName: 'Sky', studentEmail: stranger.email, guardianEmail: parent })
    await guardianSigns(page, form)
    expect((await pendingFor(id))?.consented_at, 'held until the form is complete').toBeNull()
    await studentSigns(page, form)
    await expect.poll(async () => (await pendingFor(id))?.consented_at ?? null, { timeout: 30_000 }).not.toBeNull()

    // Now the child can finish the profile, and the account is active.
    await page.goto('/account/onboarding')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Complete your profile', { timeout: 30_000 })
    const done = await postOnboarding(page, profile(dob, parent))
    expect(done.status(), await done.text()).toBe(200)
    expect((await done.json()).pendingConsent).toBeUndefined()
    expect(onboarded(await memberFor(stranger.clerkUserId!))).toBe(true)
    await page.goto('/account/onboarding')
    await expect(page).toHaveURL(/\/home/, { timeout: 30_000 })
  })
})

test('an unconsented pending account is purged at 30 days, and an adult\'s is not', async ({ page, baseURL }) => {
  test.setTimeout(240_000)

  // A 15-year-old and a 12-year-old, each held pending, and an adult.
  await asStranger(page)
  const teen = await newStranger(page, 'purge-15', baseURL, dobForAge(15))
  expect((await postOnboarding(page, profile(dobForAge(15), guardianEmail('purge-15')))).status()).toBe(200)
  const child = await newStranger(page, 'purge-12', baseURL, dobForAge(12))
  expect((await postOnboarding(page, childStep(dobForAge(12), guardianEmail('purge-12')))).status()).toBe(200)
  const adult = await newStranger(page, 'purge-18', baseURL, dobForAge(18))
  expect((await postOnboarding(page, adultProfile(dobForAge(18)))).status()).toBe(200)

  const ids = { teen: await memberId(teen), child: await memberId(child), adult: await memberId(adult) }
  for (const id of [ids.teen, ids.child]) {
    const row = await pendingFor(id)
    expect(row?.consented_at).toBeNull()
    // Opened now, purged 30 days on.
    const days = (Date.parse(row!.purge_after) - Date.parse(row!.requested_at)) / 86_400_000
    expect(days).toBeCloseTo(30, 5)
  }
  expect(await pendingFor(ids.adult)).toBeNull()

  // Not yet 30 days: nothing is purged.
  const early = runPurge(Object.values(ids))
  expect(early).toMatchObject({ purged: [], errors: [] })
  expect(await memberFor(teen.clerkUserId!)).not.toBeNull()
  expect(await memberFor(child.clerkUserId!)).not.toBeNull()

  // 31 days on, still unanswered: both minors' accounts go, logins included.
  await backdatePendingRequest(ids.teen)
  await backdatePendingRequest(ids.child)

  // The daily cron is the purge's way in. Called the way a cron is called
  // (the CRON_SECRET bearer header) against this local server, it declines
  // before touching anything: the purge runs in production only. So the due
  // accounts are still there afterwards, and the step below runs the function
  // the route runs. Only against a server pinned to dev (CI pins
  // NEXT_PUBLIC_APP_ENV=dev), never one that could take the production path.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && process.env.NEXT_PUBLIC_APP_ENV === 'dev') {
    const cron = await page.request.get('/api/cron/membership-expiry', {
      headers: { authorization: `Bearer ${cronSecret}` },
    })
    expect(cron.status(), await cron.text()).toBe(200)
    expect(await cron.json()).toMatchObject({ skipped: true, reason: 'APP_ENV=dev' })
    expect(await memberFor(teen.clerkUserId!), 'the cron route purged nothing off production').not.toBeNull()
    expect(await memberFor(child.clerkUserId!), 'the cron route purged nothing off production').not.toBeNull()
  } else {
    test.info().annotations.push({
      type: 'note',
      description: 'CRON_SECRET is unset or the server is not pinned to dev, so the cron route was not called',
    })
  }

  const due = runPurge(Object.values(ids))
  expect(due.errors).toEqual([])
  expect([...due.purged].sort()).toEqual([ids.teen, ids.child].sort())

  for (const [who, stranger, id] of [['teen', teen, ids.teen], ['child', child, ids.child]] as const) {
    const { data: row } = await db().from('members').select('id').eq('id', id).maybeSingle()
    expect(row, `the ${who}'s member row is gone`).toBeNull()
    expect(await pendingFor(id), `the ${who}'s consent request is gone`).toBeNull()
    expect(clerkUserExists(stranger.clerkUserId!), `the ${who}'s login is gone`).toBe(false)
  }

  // The adult is untouched.
  const kept = await memberFor(adult.clerkUserId!)
  expect(onboarded(kept), 'the adult is still a full member').toBe(true)
  expect(kept?.id).toBe(ids.adult)
  expect(clerkUserExists(adult.clerkUserId!), 'and keeps their login').toBe(true)
})
