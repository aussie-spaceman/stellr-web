// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'
import { testPng } from '@/test/png'

// The whole Stellr signing journey for a minor's consent form, against the
// in-memory database: issue, the parent's check and signature, the student's
// turn, sealing, storage and the completion emails. Emails are captured, not
// sent; every person and address here is invented.

const { sent } = vi.hoisted(() => ({ sent: [] as { to: string; subject: string; text: string }[] }))
vi.mock('@/lib/email', async (orig) => {
  const actual = await orig<typeof import('@/lib/email')>()
  return {
    ...actual,
    sendEmail: vi.fn(async (o: { to: string; subject: string; text: string }) => {
      sent.push(o)
      return { id: `email-${sent.length}` }
    }),
  }
})
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))
vi.mock('@/lib/credentials-notify', () => ({ applyGuardianOptOut: vi.fn(async () => {}) }))

import { nativeProvider } from '@/lib/esign/providers/native'
import { openLink, resolveSession, recordConsent, sameName, submitSignature, recordViewed } from './flow'
import { verifyToken } from './tokens'
import { sendInvites } from '@/lib/esign/outbox'
import { SIGNED_BUCKET } from '@/lib/esign/storage'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'
const meta = { ip: '203.0.113.7', userAgent: 'TestBrowser/1.0' }

async function templatePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) doc.addPage([612, 792]).drawText(`Consent page ${i + 1}`, { x: 54, y: 740, size: 12, font })
  return doc.save()
}

const fieldMap = {
  roles: [{ role: 'guardian', order: 1 }, { role: 'student', order: 2, optional: true }],
  fields: [
    { name: 'guardian_signature', label: 'Signature', role: 'guardian', type: 'signature', source: 'signer', page: 2, x: 100, y: 500, required: true },
    { name: 'guardian_full_name', label: 'Full name', role: 'guardian', type: 'full_name', source: 'system', page: 2, x: 100, y: 380 },
    { name: 'GuardianPhone', label: 'Parent or guardian phone', role: 'guardian', type: 'text', source: 'prefill', prefillKey: 'GuardianPhone', page: 2, x: 120, y: 470, required: true },
    { name: 'CredentialSharingOptOut', label: 'Credential opt-out', role: 'guardian', type: 'checkbox', source: 'signer', page: 1, x: 50, y: 400 },
    { name: 'MediaOptOut', label: 'Media opt-out', role: 'guardian', type: 'checkbox', source: 'signer', page: 1, x: 50, y: 454 },
    { name: 'student_signature', label: 'Signature', role: 'student', type: 'signature', source: 'signer', page: 2, x: 150, y: 585, required: true },
    { name: 'MinorDateOfBirth', label: 'Date of birth', role: 'student', type: 'text', source: 'prefill', prefillKey: 'MinorDateOfBirth', page: 2, x: 200, y: 236 },
  ],
}

function appendAuditRpc(db: FakeDb) {
  return (args: Record<string, unknown>) => {
    const rows = db.table('esign_audit_events').filter((r) => r.envelope_row === args.p_envelope)
    const prev = (rows.at(-1)?.hash as string | undefined) ?? null
    const row = {
      id: db.table('esign_audit_events').length + 1,
      envelope_row: args.p_envelope, recipient_row: args.p_recipient, event: args.p_event,
      at: new Date().toISOString(), ip: args.p_ip, user_agent: args.p_ua, detail: args.p_detail,
      prev_hash: prev,
      hash: createHash('sha256').update(`${prev}|${args.p_event}|${JSON.stringify(args.p_detail)}`).digest('hex'),
    }
    db.table('esign_audit_events').push(row)
    return row
  }
}

async function setup() {
  const pdf = await templatePdf()
  const sha = createHash('sha256').update(pdf).digest('hex')
  const db = fakeSupabase({
    esign_templates: [{
      id: TEMPLATE_ID, key: 'minor', version: 1, title: 'Parental Consent Form', pdf_path: 'minor/v1.pdf',
      pdf_sha256: sha, field_map: fieldMap, text_html: null, disclosure_version: '2026-10-v1',
      approved_at: '2026-10-01T00:00:00Z', active: true,
    }],
    members: [{ id: 'm-student', email: 'sam@student.test', first_name: 'Sam' }],
  })
  db.objects.set('agreement-templates/minor/v1.pdf', pdf)
  db.rpcs.esign_append_audit = appendAuditRpc(db)
  db.rpcs.esign_claim_email = () => true
  return db
}

async function issue(db: FakeDb) {
  const created = await nativeProvider.create({ db: db.client }, {
    type: 'minor',
    accounts: { memberId: 'm-student' },
    params: {
      minorFirstName: 'Sam', minorLastName: 'Rivera', minorEmail: 'sam@student.test', minorDateOfBirth: '2012-05-04',
      guardianName: 'Pat Rivera', guardianEmail: 'pat@home.test', guardianPhone: '555 0100', relationship: 'Parent',
      eventTitle: 'Colorado SDC', schoolName: 'Lincoln Middle', schoolState: 'CO',
    },
  })
  const row = {
    id: 'env-row-1', envelope_id: created.externalId, provider: 'native', status: 'sent', envelope_type: 'minor',
    member_id: 'm-student', participant_id: 'p-1', event_title: 'Colorado SDC', minor_name: 'Sam Rivera',
    signer_name: 'Pat Rivera', sent_at: new Date().toISOString(), completed_at: null, sealed_at: null,
    reused_from: null, credential_sharing_opt_out: false, archived_at: null, archive_attempts: 0,
    signers_total: created.signerCount, signers_completed: 0, completion_notified_at: null,
    ...created.rowFields,
  }
  db.table('docusign_envelopes').push(row)
  const after = await created.afterRecord!(db.client, row.id)
  return { created, row, after }
}

function linkFrom(email: { text: string }, kind: 'sign' | 'copy' = 'sign'): string {
  const re = kind === 'sign' ? /\/sign#([^\s]+)/ : /\/sign\/copy#([^\s]+)/
  const m = re.exec(email.text)
  if (!m) throw new Error(`no ${kind} link in email`)
  return m[1]
}

beforeEach(() => {
  sent.length = 0
  vi.stubEnv('ESIGN_TOKEN_SECRET', 's'.repeat(48))
})
afterEach(() => vi.unstubAllEnvs())

describe('Stellr signing: a minor’s consent form', () => {
  it('emails only the parent first, and the student cannot start before them', async () => {
    const db = await setup()
    await issue(db)

    const recipients = db.table('docusign_envelope_recipients')
    expect(recipients.map((r) => [r.role_name, r.status])).toEqual([['Guardian', 'sent'], ['Minor', 'created']])
    expect(sent.map((e) => e.to)).toEqual(['pat@home.test'])
    expect(sent[0].subject).toMatch(/Parent\/guardian signature needed/)

    const student = recipients.find((r) => r.role_name === 'Minor')!
    const early = await sendInvites(db.client, [student as never])
    expect(early.sent).toBe(1) // forced send, to test the page refuses it…
    const studentToken = linkFrom(sent[1])
    expect((await openLink(db.client, studentToken)).kind).toBe('not_yet')
    expect(db.table('esign_audit_events').map((e) => e.event)).toContain('issued')
  })

  it('asks the parent for the child’s birth year, and locks the link after repeated wrong answers', async () => {
    const db = await setup()
    await issue(db)
    const token = linkFrom(sent[0])

    expect(await openLink(db.client, token)).toMatchObject({ kind: 'verify', question: 'birth_year' })
    for (let i = 0; i < 4; i++) expect((await openLink(db.client, token, { birthYear: '1999' })).kind).toBe('verify')
    expect((await openLink(db.client, token, { birthYear: '1999' })).kind).toBe('invalid')
    // Locked even with the right answer now.
    expect((await openLink(db.client, token, { birthYear: '2012' })).kind).toBe('invalid')
  })

  it('runs end to end: parent signs, student signs, the record is sealed, stored and sent to both', async () => {
    const db = await setup()
    const { row } = await issue(db)

    // Parent.
    const parentLink = await openLink(db.client, linkFrom(sent[0]), { birthYear: '2012' })
    expect(parentLink.kind).toBe('ready')
    if (parentLink.kind !== 'ready') return
    const parent = (await resolveSession(db.client, parentLink.session, 'act'))!
    await recordViewed(db.client, parent, meta)

    // The parent must confirm they are the parent.
    expect(await recordConsent(db.client, parent, { disclosureVersion: '2026-10-v1' }, meta)).toMatchObject({ ok: false })
    expect(await recordConsent(db.client, parent, { disclosureVersion: '2026-10-v1', attest: true }, meta)).toEqual({ ok: true })

    const parentCtx = (await resolveSession(db.client, parentLink.session, 'act'))!
    const first = await submitSignature(db.client, parentCtx, {
      values: { GuardianPhone: '555 0199', CredentialSharingOptOut: true, MediaOptOut: false },
      signatureText: 'Pat Rivera',
    }, meta)
    expect(first).toMatchObject({ ok: true, agreementComplete: false })
    if (!first.ok) return
    expect(first.activated.map((r) => r.role_name)).toEqual(['Minor'])

    // A second submission of the same signature is refused.
    const again = await submitSignature(db.client, parentCtx, { values: { GuardianPhone: '1' }, signatureText: 'Pat Rivera' }, meta)
    expect(again).toMatchObject({ ok: false, status: 409 })

    // The emailed parent link is dead once used.
    expect((await openLink(db.client, linkFrom(sent[0]), { birthYear: '2012' })).kind).toBe('already_signed')

    // Student.
    await sendInvites(db.client, first.activated)
    const studentEmail = sent.at(-1)!
    expect(studentEmail.to).toBe('sam@student.test')
    const studentLink = await openLink(db.client, linkFrom(studentEmail), { birthYear: '2012' })
    expect(studentLink.kind).toBe('ready')
    if (studentLink.kind !== 'ready') return
    const student = (await resolveSession(db.client, studentLink.session, 'act'))!
    await recordConsent(db.client, student, { disclosureVersion: '2026-10-v1' }, meta)
    const done = await submitSignature(db.client, (await resolveSession(db.client, studentLink.session, 'act'))!, {
      values: { MinorDateOfBirth: '04-May-2012' }, signatureText: 'Sam Rivera',
    }, meta)
    expect(done).toMatchObject({ ok: true, agreementComplete: true })

    // Sealed and stored.
    const envelope = db.table('docusign_envelopes')[0]
    expect(envelope).toMatchObject({ status: 'completed', seal_kind: 'hash', signers_completed: 2 })
    expect(envelope.signed_pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(db.objects.has(`${SIGNED_BUCKET}/${envelope.signed_pdf_path}`)).toBe(true)
    const auditFile = JSON.parse(new TextDecoder().decode(db.objects.get(`${SIGNED_BUCKET}/${envelope.certificate_path}`)))
    expect(auditFile.signers.map((s: { role: string; ip: string }) => [s.role, s.ip])).toEqual([['guardian', meta.ip], ['student', meta.ip]])
    expect(auditFile.signers[0].values).toMatchObject({ GuardianPhone: '555 0199', CredentialSharingOptOut: 'true' })

    // The opt-out the parent ticked is read back.
    expect(envelope.credential_sharing_opt_out).toBe(true)

    // Audit trail in order, chained.
    const events = db.table('esign_audit_events').filter((e) => e.envelope_row === row.id)
    expect(events.map((e) => e.event)).toEqual([
      'issued', 'invite_sent', 'viewed', 'consented', 'attested', 'signed',
      'invite_sent', 'consented', 'signed', 'sealed', 'completed',
    ])
    for (let i = 1; i < events.length; i++) expect(events[i].prev_hash).toBe(events[i - 1].hash)

    // Both signers get a completion email with a link to their copy, never an attachment.
    const completion = sent.filter((e) => e.subject.startsWith('Signed:'))
    expect(completion.map((e) => e.to).sort()).toEqual(['pat@home.test', 'sam@student.test'])
    for (const e of completion) {
      expect((e as unknown as { attachments?: unknown }).attachments).toBeUndefined()
      expect(verifyToken(linkFrom(e, 'copy'), 'download')).not.toBeNull()
    }
  })

  it('asks before accepting a signature in a different name, and records that it differed', async () => {
    const db = await setup()
    await issue(db)
    const link = await openLink(db.client, linkFrom(sent[0]), { birthYear: '2012' })
    if (link.kind !== 'ready') throw new Error('expected a session')
    await recordConsent(db.client, (await resolveSession(db.client, link.session, 'act'))!, { disclosureVersion: '2026-10-v1', attest: true }, meta)
    const ctx = async () => (await resolveSession(db.client, link.session, 'act'))!
    const values = { GuardianPhone: '555 0199' }

    const refused = await submitSignature(db.client, await ctx(), { values, signatureText: 'Someone Else' }, meta)
    expect(refused).toMatchObject({ ok: false, status: 409, error: 'name_differs', nameOnRecord: 'Pat Rivera' })
    expect(db.table('docusign_envelope_recipients')[0].status).toBe('sent')

    const accepted = await submitSignature(db.client, await ctx(), { values, signatureText: 'Patricia Rivera', confirmDifferentName: true }, meta)
    expect(accepted).toMatchObject({ ok: true })
    const signed = db.table('esign_audit_events').find((e) => e.event === 'signed')!
    expect(signed.detail).toMatchObject({ signatureText: 'Patricia Rivera', nameOnRecord: 'Pat Rivera', nameMatchesRecord: false })
  })

  it('takes a drawn signature as an image, puts it on the document and keeps it with the record', async () => {
    const db = await setup()
    const { row } = await issue(db)
    const link = await openLink(db.client, linkFrom(sent[0]), { birthYear: '2012' })
    if (link.kind !== 'ready') throw new Error('expected a session')
    const ctx = async () => (await resolveSession(db.client, link.session, 'act'))!
    await recordConsent(db.client, await ctx(), { disclosureVersion: '2026-10-v1', attest: true }, meta)

    const png = testPng()
    const first = await submitSignature(db.client, await ctx(), { values: { GuardianPhone: '555 0199' }, signatureText: 'Pat Rivera', signaturePng: png }, meta)
    expect(first).toMatchObject({ ok: true })
    const parent = db.table('docusign_envelope_recipients').find((r) => r.role_name === 'Guardian')!
    expect(parent).toMatchObject({ signature_kind: 'drawn', signature_text: 'Pat Rivera' })
    expect(db.objects.get(`${SIGNED_BUCKET}/${parent.signature_image_path}`)).toEqual(png)
    expect(db.table('esign_audit_events').find((e) => e.event === 'signed')?.detail).toMatchObject({
      signatureKind: 'drawn', signatureImageSha256: createHash('sha256').update(png).digest('hex'),
    })

    // The student signs; the sealed record carries the drawn signature.
    if (!first.ok) return
    await sendInvites(db.client, first.activated)
    const studentLink = await openLink(db.client, linkFrom(sent.at(-1)!), { birthYear: '2012' })
    if (studentLink.kind !== 'ready') throw new Error('expected a session')
    const student = async () => (await resolveSession(db.client, studentLink.session, 'act'))!
    await recordConsent(db.client, await student(), { disclosureVersion: '2026-10-v1' }, meta)
    expect(await submitSignature(db.client, await student(), { values: { MinorDateOfBirth: '04-May-2012' }, signatureText: 'Sam Rivera' }, meta))
      .toMatchObject({ ok: true, agreementComplete: true })
    const envelope = db.table('docusign_envelopes').find((e) => e.id === row.id)!
    expect(envelope.status).toBe('completed')
    const pdf = await PDFDocument.load(db.objects.get(`${SIGNED_BUCKET}/${envelope.signed_pdf_path}`)!)
    expect(pdf.getPageCount()).toBeGreaterThan(1)
  })

  it('treats case, accents and spacing as the same name', () => {
    expect(sameName('  pat  RIVERA ', 'Pat Rivera')).toBe(true)
    expect(sameName('Zoë O’Brien', 'Zoe OBrien')).toBe(false)
    expect(sameName('Zoë O’Brien', 'Zoe O Brien')).toBe(true)
    expect(sameName('José Núñez', 'Jose Nunez')).toBe(true)
    expect(sameName('Pat Rivera', 'Sam Rivera')).toBe(false)
  })

  it('kills every outstanding link when the agreement is voided', async () => {
    const db = await setup()
    const { created } = await issue(db)
    const token = linkFrom(sent[0])
    await nativeProvider.void({ db: db.client }, created.externalId, 'Reissued')
    expect(db.table('docusign_envelopes')[0].status).toBe('voided')
    expect((await openLink(db.client, token, { birthYear: '2012' })).kind).toBe('invalid')
    expect(db.table('esign_audit_events').at(-1)?.event).toBe('voided')
  })

  it('reports per-signer status in DocuSign’s vocabulary', async () => {
    const db = await setup()
    const { created } = await issue(db)
    const recipients = await nativeProvider.getRecipients({ db: db.client }, created.externalId)
    expect(recipients.map((r) => [r.roleName, r.status, r.routingOrder])).toEqual([['Guardian', 'sent', 1], ['Minor', 'created', 2]])
  })
})
