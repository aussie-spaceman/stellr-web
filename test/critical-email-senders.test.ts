// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// S1 suppression list: the mail that still goes to an address on
// email_suppressions is the mail a child's participation or an account's
// security depends on (policy in lib/email/suppressions.ts). Those senders pass
// `critical: true` to sendEmail. Most have a behaviour test beside them
// (lib/esign/outbox.test.ts, lib/member-invite.test.ts,
// lib/privacy-requests.test.ts, lib/notify.critical.test.ts,
// lib/compliance-notify.critical.test.ts, lib/app-errors.test.ts); this pins
// the call sites that have none, and the ones in lib/notify.ts and
// lib/compliance-notify.ts again by source, and
// keeps the whole list in one place so a refactor cannot quietly drop one.

const root = join(__dirname, '..')

/** The text of the first `fn(` call at or after `marker`, to its closing paren. */
function callAfter(file: string, marker: string, fn: string): string {
  const src = readFileSync(join(root, file), 'utf8')
  const at = src.indexOf(marker)
  if (at < 0) throw new Error(`${file}: marker not found: ${marker}`)
  const start = src.indexOf(`${fn}(`, at)
  if (start < 0) throw new Error(`${file}: no ${fn}( after ${marker}`)
  let depth = 0
  for (let i = start + fn.length; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error(`${file}: unbalanced ${fn}( call`)
}

const CRITICAL_SENDS: { what: string; file: string; marker: string; fn: string }[] = [
  { what: 'signing invitations (guardian, student, member)', file: 'lib/esign/outbox.ts', marker: 'const sent = await', fn: 'sendEmail' },
  { what: 'DocuSign heads-up to the guardian', file: 'lib/docusign-agreements.ts', marker: 'safeEmail(ctx.guardianEmail', fn: 'safeEmail' },
  { what: 'admin account invite (sign-in)', file: 'lib/member-invite.ts', marker: 'accountInviteEmail({', fn: 'sendEmail' },
  { what: 'group account invite (sign-in)', file: 'lib/member-invite.ts', marker: 'groupAccountCreatedEmail({', fn: 'sendEmail' },
  { what: 'privacy request confirmation link', file: 'lib/privacy-requests.ts', marker: 'mintToken(data.id', fn: 'sendEmail' },
  { what: 'safeguarding clearance notice', file: 'lib/compliance-notify.ts', marker: 'if (member.email) {', fn: 'sendEmail' },
  { what: 'staff alert to the team inbox (no holder, or every holder opted out)', file: 'lib/notify.ts', marker: 'async function alertTeamInbox(', fn: 'sendEmail' },
  { what: 'daily error digest', file: 'lib/app-errors.ts', marker: 'const email = renderErrorDigest(rows)', fn: 'sendEmail' },
]

describe('critical mail passes critical: true', () => {
  for (const s of CRITICAL_SENDS) {
    it(s.what, () => {
      expect(callAfter(s.file, s.marker, s.fn)).toMatch(/critical:\s*true/)
    })
  }

  it('DocuSign reminder to the guardian', () => {
    const src = readFileSync(join(root, 'app/api/cron/docusign-reminders/route.ts'), 'utf8')
    const at = src.indexOf('to: guardian.email')
    expect(at).toBeGreaterThan(0)
    // The sendEmail call that carries `to: guardian.email`.
    const call = callAfter('app/api/cron/docusign-reminders/route.ts', src.slice(src.lastIndexOf('await sendEmail(', at), at), 'sendEmail')
    expect(call).toContain('to: guardian.email')
    expect(call).toMatch(/critical:\s*true/)
  })

  it('notifyMember passes the NotifyInput critical flag through, and notifyCommunityAdmins always sets it', () => {
    expect(callAfter('lib/notify.ts', 'if (email && member?.email) {', 'sendEmail')).toMatch(/critical:\s*input\.critical === true/)
    const src = readFileSync(join(root, 'lib/notify.ts'), 'utf8')
    const body = src.slice(src.indexOf('export async function notifyCommunityAdmins('))
    expect(body).toMatch(/\{\s*\.\.\.notice,\s*critical:\s*true\s*\}/)
  })

  it('safeEmail in lib/docusign-agreements passes critical through', () => {
    expect(callAfter('lib/docusign-agreements.ts', 'async function safeEmail(', 'sendEmail')).toMatch(/critical/)
  })
})
