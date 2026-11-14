import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { expect, type APIResponse, type Page } from '@playwright/test'
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { appToday } from '../../lib/age'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'
import { freshClerkSession } from './fresh-session'
import { recordCreatedSession } from './session-ledger'

/**
 * Strangers for the age-band specs (plan S1 gate): people with no account who
 * sign up themselves, one per test, each removed afterwards.
 *
 * A stranger is a new Clerk login made through Clerk's own sign-up API in the
 * browser, as Clerk's <SignUp> form makes it. Its address carries Clerk's
 * `+clerk_test` subaddress (strangerEmail): on a development instance Clerk
 * sends no mail for it and accepts the fixed code 424242. Nothing here calls Clerk's createUser: every account the app makes
 * goes through the COPPA guard (lib/clerk-provisioning.guard.test.ts), and a
 * sign-up is how a stranger really arrives.
 *
 * Everything the specs create (the login, its member rows, consent forms and
 * pending request) is removed in an afterEach through ./age-bands-cli.ts,
 * because the dev database is shared (memory: e2e shared fixture state).
 */

/**
 * The server's MINOR_SELF_SIGNUP_ENABLED. Playwright starts the server with this
 * process's environment (.env.local included, playwright.config.ts), so this
 * is the server's mode; `expectServerMode` checks the server agrees before any
 * case relies on it.
 */
export const MINOR_SELF_SIGNUP = process.env.MINOR_SELF_SIGNUP_ENABLED === 'true'

export const FLAG_OFF_REASON =
  'MINOR_SELF_SIGNUP_ENABLED is off on this server: minors cannot self-register, so there is no pending account'

/** The ages the S1 gate names, plus "no date of birth". */
export type Band = 12 | 13 | 15 | 17 | 18 | 'unknown'
export const BANDS: Band[] = [12, 13, 15, 17, 18, 'unknown']

/**
 * A date of birth `age` years and about four months before today in Mountain
 * time (the app's "today", lib/age): never within days of a birthday, so the
 * band cannot change between the spec and the server.
 */
export function dobForAge(age: number): string {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - age)
  d.setUTCDate(d.getUTCDate() - 120)
  return d.toISOString().slice(0, 10)
}

/**
 * A generated login address for one stranger. Never a real person's. On the
 * reserved example.com, not example.test: Clerk refuses a .test address as
 * invalid ("Email address must be a valid email address"). Everything else
 * this suite generates (guardians' addresses) is on example.test.
 */
export function strangerEmail(label: string): string {
  const stamp = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
  return `e2e-ageband-${label}-${stamp}+clerk_test@example.com`
}

/** A guardian's generated address, for a stranger's consent form. */
export function guardianEmail(label: string): string {
  return `e2e-ageband-guardian-${label}-${randomBytes(4).toString('hex')}@example.test`
}

export function db(): SupabaseClient {
  // The suite never runs against production; this file refuses to even try.
  const url = assertE2eSupabase()
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

function cli<T>(...args: string[]): T {
  // The app's modules import through `@/` aliases, which tsx resolves and
  // Playwright's loader does not. Output is the last stdout line.
  const out = execFileSync('npx', ['tsx', 'e2e/fixtures/age-bands-cli.ts', ...args], { encoding: 'utf8', env: process.env })
  return JSON.parse(out.trim().split('\n').at(-1) as string) as T
}

export interface Stranger {
  email: string
  clerkUserId: string | null
}

/**
 * Run first in a stranger's test, before any navigation: the testing token the
 * Clerk client picks up on load, which lets the sign-up past bot protection.
 */
export async function asStranger(page: Page): Promise<void> {
  await setupClerkTestingToken({ page })
}

/**
 * Signs a stranger up through Clerk's sign-up API, as the <SignUp> form on
 * /sign-up does, and leaves them signed in. Call it once the test has shown the
 * way to /sign-up. `stranger.clerkUserId` is set as soon as Clerk has made the
 * login, so the afterEach can remove it even when a later step fails.
 *
 * Not on /sign-up itself: that page's own <SignUp> form holds the client's
 * sign-up attempt and the API calls below then find none ("No sign up attempt
 * was found"). So, as e2e/fixtures/sign-in.ts does for a sign-in, it starts
 * from a public page, which loads Clerk for a browser that looks signed in:
 * the hint is set first (Clerk corrects it on load), on a clean cookie jar so
 * the guest cookies the sign-in page left cannot contradict it.
 */
export async function signUp(page: Page, stranger: Stranger, baseURL: string | undefined): Promise<void> {
  await page.context().clearCookies()
  await page.context().addCookies([{ name: '__client_uat', value: '1', url: baseURL ?? 'http://localhost:3000' }])
  await page.goto('/')
  await clerk.loaded({ page })

  // A per-test password, made here and thrown away with the account.
  const password = `e2e-${randomBytes(12).toString('hex')}`
  const result = await page.evaluate(
    async ({ email, password }) => {
      type SignUpResource = {
        status: string | null
        createdUserId: string | null
        createdSessionId: string | null
        missingFields: string[]
        unverifiedFields: string[]
        prepareEmailAddressVerification: (o: { strategy: 'email_code' }) => Promise<SignUpResource>
        attemptEmailAddressVerification: (o: { code: string }) => Promise<SignUpResource>
      }
      type ClerkLike = {
        client: { signUp: { create: (o: Record<string, string>) => Promise<SignUpResource> } }
        setActive: (o: { session: string | null }) => Promise<void>
      }
      const c = (window as unknown as { Clerk: ClerkLike }).Clerk
      let step = 'create'
      try {
        let done = await c.client.signUp.create({ emailAddress: email, password })
        // An instance that asks for the address to be verified: Clerk's fixed
        // code for a +clerk_test address on a development instance.
        if (done.status !== 'complete' && done.unverifiedFields.includes('email_address')) {
          step = 'verify'
          await done.prepareEmailAddressVerification({ strategy: 'email_code' })
          done = await done.attemptEmailAddressVerification({ code: '424242' })
        }
        if (done.status !== 'complete') {
          return { ok: false as const, detail: `sign-up ${done.status}; missing ${done.missingFields.join(', ')}`, userId: done.createdUserId }
        }
        await c.setActive({ session: done.createdSessionId })
        return { ok: true as const, userId: done.createdUserId, sessionId: done.createdSessionId }
      } catch (err) {
        const e = err as { errors?: Array<{ longMessage?: string; code?: string }>; message?: string }
        return { ok: false as const, detail: `${step}: ${e.errors?.map((x) => x.longMessage ?? x.code).join('; ') ?? e.message ?? String(err)}`, userId: null }
      }
    },
    { email: stranger.email, password },
  )
  if (result.userId) stranger.clerkUserId = result.userId
  if (!result.ok) throw new Error(`Clerk sign-up failed for a generated stranger: ${result.detail}`)
  if (result.sessionId) recordCreatedSession(result.sessionId)
  await expect
    .poll(() => page.evaluate(() => Boolean((window as { Clerk?: { user?: unknown } }).Clerk?.user)), {
      message: 'the new login never became the signed-in user',
    })
    .toBe(true)
}

/** Removes everything the stranger left: member rows, consent forms, pending request, Clerk login. */
export function removeStranger(stranger: Stranger): void {
  const out = cli<{ members: number; left: number }>('remove', stranger.email, ...(stranger.clerkUserId ? [stranger.clerkUserId] : []))
  if (out.left !== 0) throw new Error(`clean-up left ${out.left} member row(s) for a generated stranger`)
}

export function clerkUserExists(clerkUserId: string): boolean {
  return cli<boolean>('clerk-user', clerkUserId)
}

// ── The onboarding submissions the wizard makes (components/member/OnboardingForm) ──

/** POST /api/members/onboarding as the signed-in stranger, on a fresh session token. */
export async function postOnboarding(page: Page, body: Record<string, unknown>): Promise<APIResponse> {
  await freshClerkSession(page)
  return page.request.post('/api/members/onboarding', { data: body })
}

/** A minor's or an adult's full profile, as the wizard sends it (no school: optional off the student brackets). */
export function profile(dateOfBirth: string | null, guardian: string): Record<string, unknown> {
  return {
    event_role: 'participant',
    date_of_birth: dateOfBirth ?? undefined,
    gender: 'female',
    phone: '555 0100',
    grade: 'grade_10',
    ec_first_name: 'Robin',
    ec_last_name: 'Guardian',
    ec_email: guardian,
    ec_phone: '555 0142',
    ec_relationship: 'Parent',
  }
}

/** An adult's profile: a parent joining, no student fields. */
export function adultProfile(dateOfBirth: string): Record<string, unknown> {
  return { event_role: 'parent', age_bracket: 'adult', date_of_birth: dateOfBirth, gender: 'female', phone: '555 0100' }
}

/** The under-13 parent step: a first name and a parent's email, nothing else (COPPA). */
export function childStep(dateOfBirth: string, parentEmail: string): Record<string, unknown> {
  return { date_of_birth: dateOfBirth, first_name: 'Sky', parent_email: parentEmail }
}

// ── What the database says ──────────────────────────────────────────────────

export interface MemberState {
  id: string
  is_active: boolean | null
  date_of_birth: string | null
  gender: string | null
  first_name: string | null
  phone: string | null
}

/** The stranger's member row, by their login. Null when there is none. */
export async function memberFor(clerkUserId: string): Promise<MemberState | null> {
  const { data, error } = await db()
    .from('members')
    .select('id, is_active, date_of_birth, gender, first_name, phone')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as MemberState | null
}

/** Onboarded as the member pages read it: an active row with a date of birth and a gender. */
export function onboarded(m: MemberState | null): boolean {
  return Boolean(m && m.is_active !== false && m.date_of_birth && m.gender)
}

export interface PendingRow {
  band: 'teen' | 'child'
  guardian_email: string | null
  requested_at: string
  purge_after: string
  consented_at: string | null
}

export async function pendingFor(memberId: string): Promise<PendingRow | null> {
  const { data, error } = await db()
    .from('member_pending_consent')
    .select('band, guardian_email, requested_at, purge_after, consented_at')
    .eq('member_id', memberId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as PendingRow | null
}

/**
 * Moves the stranger's consent request 31 days into the past, as if it had
 * been waiting that long. The fixtures' usual write (the secret-key client on
 * the dev database, as ./check-in.ts and ./esign.ts), on this one row only.
 */
export async function backdatePendingRequest(memberId: string): Promise<void> {
  const day = 24 * 60 * 60 * 1000
  const now = Date.now()
  const { data, error } = await db()
    .from('member_pending_consent')
    .update({ requested_at: new Date(now - 31 * day).toISOString(), purge_after: new Date(now - day).toISOString() })
    .eq('member_id', memberId)
    .is('consented_at', null)
    .select('member_id')
  if (error) throw new Error(error.message)
  expect(data, 'no open consent request to backdate').toHaveLength(1)
}

export interface PurgeOutcome {
  purged: string[]
  cleared: string[]
  heldGuardianSigned: string[]
  heldAdultRoute: string[]
  errors: Array<{ memberId: string; error: string }>
}

/** Runs the daily 30-day purge, deleting only these members if they are due. */
export function runPurge(memberIds: string[]): PurgeOutcome {
  return cli<PurgeOutcome>('purge', ...memberIds)
}

// ── The guardian's consent form, on Stellr signing ──────────────────────────

export function esignConfigured(): boolean {
  return (process.env.ESIGN_TOKEN_SECRET ?? '').length >= 32
}

export interface ConsentForm {
  rowId: string
  signers: { id: string; role: string }[]
  birthYear: string
  guardianName: string
  studentName: string
}

export function issueConsentForm(input: {
  memberId: string; dateOfBirth: string; firstName: string; studentEmail: string; guardianEmail: string
}): ConsentForm {
  return cli<ConsentForm>('issue-consent', JSON.stringify({ ...input, guardianName: 'Robin Guardian', grade: '10' }))
}

function signingPath(recipientId: string): string {
  return cli<string>('link', recipientId)
}

/** The guardian signs the form from their email link: year check, attestation, details, typed name. */
export async function guardianSigns(page: Page, form: ConsentForm): Promise<void> {
  const guardian = form.signers.find((s) => s.role === 'Guardian')
  if (!guardian) throw new Error('the consent form has no guardian signer')
  await page.goto('about:blank')
  await page.goto(signingPath(guardian.id))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('One quick check')
  await page.getByLabel('Year of birth').fill(form.birthYear)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel(/agree to receive and sign this document electronically/).check()
  await page.getByLabel(/I am the parent or legal guardian/).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: /I’ve read it/ }).click()
  await expect(page.getByRole('heading', { name: 'Your details and choices' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review and sign' })).toBeVisible()
  await page.getByLabel(/I have read the .* and agree to it/).check()
  await page.locator('#signature').fill(form.guardianName)
  await page.getByRole('button', { name: 'Sign', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signed. Thank you.')
}

/** Then the student signs theirs, which completes the form. */
export async function studentSigns(page: Page, form: ConsentForm): Promise<void> {
  const student = form.signers.find((s) => s.role === 'Minor')
  if (!student) throw new Error('the consent form has no student signer')
  await page.goto('about:blank')
  await page.goto(signingPath(student.id))
  await page.getByLabel('Year of birth').fill(form.birthYear)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel(/agree to receive and sign this document electronically/).check()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: /I’ve read it/ }).click()
  await expect(page.getByRole('heading', { name: 'Review and sign' })).toBeVisible()
  await page.getByLabel(/I have read the .* and agree to it/).check()
  await page.locator('#signature').fill(form.studentName)
  await page.getByRole('button', { name: 'Sign', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signed. Thank you.', { timeout: 60_000 })
  await expect(page.getByText('Everyone has signed.')).toBeVisible()
}
