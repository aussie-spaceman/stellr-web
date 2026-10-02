import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'
import { storageStatePath } from '../fixtures/users'
import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import type { Page } from '@playwright/test'

/** WCAG 2.1 A and AA, on the signing page's own content (not the site chrome around it). */
async function expectAccessible(page: Page, step: string) {
  const { violations } = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(violations.map((v) =>
    `${step}: ${v.id} ${v.help} — ${v.nodes.slice(0, 6).map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`,
  )).toEqual([])
}
import {
  esignConfigured,
  issueMinorAgreement,
  readAgreement,
  removeAgreement,
  signingPath,
  type TestAgreement,
} from '../fixtures/esign'

/**
 * Stellr signing, driven through the page a family reaches from their email.
 *
 * A minor's consent form: the parent signs first (year-of-birth check,
 * electronic-signing disclosure, guardian attestation, details, typed name),
 * then the student, and the agreement is sealed and stored. The agreement is
 * issued fresh for each test and removed afterwards (see ../fixtures/esign).
 *
 * Needs ESIGN_TOKEN_SECRET in the environment of both this process and the
 * server; without it Stellr signing is switched off and the spec skips.
 */

test.describe('Stellr signing', () => {
  test.skip(!esignConfigured(), 'ESIGN_TOKEN_SECRET is not set, so Stellr signing is off')
  // Each test creates and removes its own agreement; serial keeps dev-DB load low.
  test.describe.configure({ mode: 'serial' })

  let agreement: TestAgreement | null = null
  test.afterEach(async () => {
    if (agreement) await removeAgreement(agreement.rowId)
    agreement = null
  })

  test('a parent then a student sign a consent form, and it is sealed and stored', async ({ page }) => {
    test.setTimeout(120_000)
    const consoleErrors = attachConsoleGuard(page)
    const trackerRequests: string[] = []
    page.on('request', (r) => {
      if (/googletagmanager|google-analytics|hs-scripts|hubspot|_vercel\/insights/.test(r.url())) trackerRequests.push(r.url())
    })

    agreement = await issueMinorAgreement()
    const [parent, student] = agreement.signers
    expect([parent.role, student.role]).toEqual(['Guardian', 'Minor'])

    // The student cannot start before the parent has signed.
    await page.goto(await signingPath(student.id))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Not your turn yet')

    // ── Parent ────────────────────────────────────────────────────────────
    // Leaving the page first makes the next link a full load, as from an email,
    // rather than a fragment change on the open page.
    await page.goto('about:blank')
    const signResponse = await page.goto(await signingPath(parent.id))
    const headers = signResponse?.headers() ?? {}
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['x-robots-tag']).toContain('noindex')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One quick check')
    // The key leaves the address bar as soon as the page has read it.
    await expect.poll(() => new URL(page.url()).hash).toBe('')
    await expectAccessible(page, 'year check')

    const year = page.getByLabel('Year of birth')
    await year.fill('1999')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText('That doesn’t match')).toBeVisible()
    await year.fill(agreement.birthYear)
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Agreeing to sign electronically' })).toBeVisible()
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
    await expect(continueButton).toBeDisabled()
    await expect(page.getByText('Tick both boxes to continue.')).toBeVisible()
    await expectAccessible(page, 'disclosure')
    await page.getByLabel(/agree to receive and sign this document electronically/).check()
    await page.getByLabel(/I am the parent or legal guardian/).check()
    await continueButton.click()

    await expect(page.getByRole('heading', { name: 'Read the document' })).toBeVisible()
    // The document is drawn into the page, every page of it.
    await expect(page.getByRole('img', { name: /^Page 1 of \d+$/ })).toBeVisible()
    await expect(page.getByText(/\d+ pages?\. Scroll to read them all\./)).toBeVisible()
    await expectAccessible(page, 'read')
    await page.getByRole('button', { name: /I’ve read it/ }).click()

    await expect(page.getByRole('heading', { name: 'Your details and choices' })).toBeVisible()
    await expect(page.getByLabel(/Parent or guardian phone/)).toHaveValue('555 0142')
    // A required field left empty: the signer is taken to it.
    const phone = page.getByLabel(/Parent or guardian phone/)
    await phone.fill('')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(phone).toBeFocused()
    await expectAccessible(page, 'details with an error')
    await phone.fill('555 0142')
    // Photo and media release is an opt-out, unticked unless the parent ticks it.
    const mediaOptOut = page.getByLabel(/do NOT consent to photo and media use/)
    await expect(mediaOptOut).not.toBeChecked()
    await mediaOptOut.check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Review and sign' })).toBeVisible()
    await expectAccessible(page, 'review and sign')
    const signature = page.locator('#signature')
    await page.getByLabel(/I have read the .* and agree to it/).check()

    // Someone else's name is not taken without a second, explicit step.
    await signature.fill('Somebody Else')
    await page.getByRole('button', { name: 'Sign', exact: true }).click()
    await expect(page.getByText(`That’s different from the name on this form (${agreement.guardianName}).`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign as “Somebody Else”' })).toBeVisible()

    await signature.fill(agreement.guardianName.toLowerCase())
    await page.getByRole('button', { name: 'Sign', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signed. Thank you.')
    await expect(page.getByText('We’ll email you a link to your copy once everyone has signed.')).toBeVisible()

    // The parent's link is spent.
    await page.goto('about:blank')
    await page.goto(await signingPath(parent.id))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Already signed')

    // ── Student ───────────────────────────────────────────────────────────
    await page.goto('about:blank')
    await page.goto(await signingPath(student.id))
    await expect(page.getByText('To make sure this consent form reached you')).toBeVisible()
    await page.getByLabel('Year of birth').fill(agreement.birthYear)
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Agreeing to sign electronically' })).toBeVisible()
    await expect(page.getByLabel(/I am the parent or legal guardian/)).toHaveCount(0)
    await page.getByLabel(/agree to receive and sign this document electronically/).check()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: /I’ve read it/ }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByLabel(/I have read the .* and agree to it/).check()
    await page.locator('#signature').fill(agreement.studentName)

    // The student draws their signature.
    await page.getByLabel('Draw my signature').check()
    const sign = page.getByRole('button', { name: 'Sign', exact: true })
    await expect(sign).toBeDisabled() // nothing drawn yet
    const pad = await page.getByRole('img', { name: /Signature pad/ }).boundingBox()
    if (!pad) throw new Error('no signature pad')
    await page.mouse.move(pad.x + 30, pad.y + 100)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(pad.x + 30 + i * 18, pad.y + 100 - Math.sin(i / 2) * 40)
    await page.mouse.up()
    await expect(page.getByRole('img', { name: 'Signature pad, with your drawn signature' })).toBeVisible()
    await expectAccessible(page, 'drawn signature')
    await sign.click()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Signed. Thank you.', { timeout: 60_000 })
    await expect(page.getByText('Everyone has signed.')).toBeVisible()

    // The signed copy downloads from storage behind a short-lived link.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download your signed copy' }).click()
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
    const copy = await (await download).path()

    // ── The record ────────────────────────────────────────────────────────
    const record = await readAgreement(agreement.rowId)
    expect(record.envelope).toMatchObject({ status: 'completed', signers_completed: 2 })
    // A certificate seal where one is configured (locally); the hash seal otherwise (CI).
    expect(['hash', 'pades', 'pades-t']).toContain(record.envelope.seal_kind)
    if (record.envelope.seal_kind !== 'hash') {
      // The copy the signer downloaded checks out on its own, with no database.
      let out: string
      try {
        out = execFileSync('npx', ['tsx', 'scripts/esign-seal.ts', 'verify', copy], { encoding: 'utf8', stdio: 'pipe' })
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string }
        throw new Error(`Seal verification failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`)
      }
      expect(out).toContain('Bytes unchanged since sealing: YES')
      expect(out).toContain('Seal signature valid:          YES')
      if (record.envelope.seal_kind === 'pades-t') expect(out).toMatch(/Trusted timestamp:\s+\d{4}-\d{2}-\d{2}T/)
    }
    expect(record.envelope.signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(record.envelope.signed_pdf_path).toMatch(/^native\/\d{4}\/[0-9a-f-]{36}\/(signed|sealed)\.pdf$/)
    expect(record.envelope.completion_notified_at).not.toBeNull()
    expect(record.recipients.map((r) => [r.role_name, r.status])).toEqual([['Guardian', 'completed'], ['Minor', 'completed']])
    expect(record.recipients[0].signer_values).toMatchObject({ MediaOptOut: 'true', GuardianPhone: '555 0142' })
    expect(record.chainBrokenAt).toBeNull()
    const signed = record.events.filter((e) => e.event === 'signed')
    expect(signed.map((e) => (e.detail as { nameMatchesRecord: boolean }).nameMatchesRecord)).toEqual([true, true])
    expect(record.recipients.map((r) => r.signature_kind)).toEqual(['typed', 'drawn'])
    expect(record.recipients[1].signature_image_path).toMatch(/\/signature-[0-9a-f-]{36}-[0-9a-f]{16}\.png$/)
    expect(record.events.map((e) => e.event)).toEqual(expect.arrayContaining(['issued', 'consented', 'attested', 'sealed', 'completed']))

    expect(trackerRequests).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('a link nobody minted, and a second link opened in the same tab, show the generic refusal', async ({ page }) => {
    agreement = await issueMinorAgreement()
    await page.goto(await signingPath(agreement.signers[0].id))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('One quick check')

    // Only the fragment changes: the page must start again from the new link.
    await page.evaluate(() => { window.location.hash = 'not-a-real-link' })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This link can’t be used')

    const res = await page.request.post('/api/sign/session', {
      data: { token: `${agreement.signers[0].id}.s1.9999999999.forged` },
      headers: { Origin: new URL(page.url()).origin },
    })
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ state: 'invalid' })
  })
})

test.describe('Agreement documents (admin)', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('lists each version and previews it blank and with its fields labelled', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)
    await page.goto('/admin/docusigns')
    await expect(page.getByRole('heading', { name: 'Needs paperwork' })).toBeVisible()
    await page.getByRole('link', { name: 'Agreement documents' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Agreement documents')

    // Open the parental consent form's newest version.
    await page.getByRole('link', { name: 'Parental Consent Form' }).first().click()
    await expect(page.getByRole('heading', { level: 2 })).toContainText(/version \d+/)
    await expect(page.locator('iframe')).toHaveCount(2)
    await expect(page.getByRole('cell', { name: /MediaOptOut/ })).toBeVisible()

    for (const as of ['blank', 'labels']) {
      const src = await page.locator(`iframe[src$="as=${as}"]`).getAttribute('src')
      const res = await page.request.get(src as string)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toBe('application/pdf')
      expect(res.headers()['cache-control']).toContain('no-store')
      expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-')
    }
    expect(consoleErrors).toEqual([])
  })

  test('the preview is for admins only', async ({ browser, baseURL }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL })
    const res = await anonymous.request.get('/api/admin/esign/templates/00000000-0000-4000-8000-000000000000/preview')
    expect([401, 403]).toContain(res.status())
    expect(res.headers()['content-type']).not.toBe('application/pdf')
    await anonymous.close()
  })
})
