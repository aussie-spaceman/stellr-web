import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyCommunityAdmins, notifyMember, type NotifyInput } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { BRAND_NAVY, emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { maskEmail } from '@/lib/utils'
import { AUTH_APP_URL } from '@/lib/env'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { eventManagerAudienceClerkIds, dutyAudienceMemberIds } from '@/lib/authz/audiences'
import { changeLinkUrl, createChangeLink } from '@/lib/esign/email-change-tokens'
import { isTenantRow, loadTenantSender } from '@/lib/event-emails/tenant-mail'

// Who is told when a signing email bounces, and what each of them sees. The one
// place every bounce is announced from, for both engines:
//
//   • DocuSign: recipient status 'autoresponded', mirrored by
//     syncEnvelopeRecipients (Connect webhook, reminder cron, roster refresh);
//   • Stellr signing: a Resend bounce (lib/esign/bounces.ts) or a send the
//     suppression list held back (lib/esign/outbox.ts).
//
// Audience (owner decisions, 9 Nov 2026):
//   staff        admins (the tenant's alert audience) and the event's active
//                event managers: full address, the reason, a link to the roster
//   organisers   on a group registration, the registrant (teacher or student
//                manager) and the nominated teacher: full address (they see it
//                on their roster already), a link to Your group
//   other signer on a two-person form (a Guardian with a Minor or under-age
//                Mentor), the other person, whatever their age: masked address
//                and a one-time link. A parent corrects the student's address
//                directly; a student may only suggest the parent's
//
// Never sent to the address that bounced. One notice per bounced address: the
// claim on agreement_recipients.bounce_notified_email means a bounce seen by
// Connect, the cron and the roster at once is announced once, and a corrected
// address that bounces again is announced again.

export type BounceKind = 'bounced' | 'suppressed'

/** Signer roles whose address the other signer on a two-person form may act on. */
const GUARDIAN = 'Guardian'
const STUDENT_ROLES = new Set(['Minor', 'Mentor'])
const STELLR_ROLE = 'StellrRepresentative'

export interface BounceRecipientRow {
  id: string
  recipient_id: string
  role_name: string | null
  name: string | null
  email: string | null
  status: string | null
  bounce_notified_email?: string | null
  invite_error?: string | null
}

export interface BounceAgreement {
  id: string
  tenant_id: string | null
  event_slug: string | null
  event_title: string | null
  minor_name: string | null
  signer_name: string | null
  participant_id: string | null
  provider: string | null
  status: string | null
}

export interface GroupOrganisers {
  registrationId: string
  registrantRole: 'teacher' | 'student_manager' | null
  /** member ids and/or addresses: the registrant and the nominated teacher. */
  people: { memberId: string | null; email: string | null }[]
}

export interface BounceContext {
  agreement: BounceAgreement
  recipients: BounceRecipientRow[]
  organisers: GroupOrganisers | null
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/** The person the form is about, for copy. */
export function aboutName(a: Pick<BounceAgreement, 'minor_name' | 'signer_name'>): string {
  return a.minor_name?.trim() || a.signer_name?.trim() || 'a participant'
}

export function roleLabel(role: string | null | undefined): string {
  if (role === GUARDIAN) return 'parent/guardian'
  if (role === 'Minor') return 'student'
  return (role ?? 'signer').toLowerCase()
}

/** True for a form signed by a parent/guardian and one other person. */
export function isTwoPersonForm(recipients: Pick<BounceRecipientRow, 'role_name'>[]): boolean {
  const roles = recipients.map((r) => r.role_name).filter((r) => r && r !== STELLR_ROLE)
  return roles.includes(GUARDIAN) && roles.some((r) => STUDENT_ROLES.has(r as string))
}

/**
 * The other signer on a two-person form, for a bounced signer: the student for
 * a bounced guardian, the guardian for a bounced student. Null when the form
 * is not a two-person form, or the other signer shares the dead address (a
 * family using one inbox), or has no address.
 */
export function otherSigner(recipients: BounceRecipientRow[], bounced: BounceRecipientRow): BounceRecipientRow | null {
  if (!isTwoPersonForm(recipients)) return null
  const wantRoles = bounced.role_name === GUARDIAN ? STUDENT_ROLES : STUDENT_ROLES.has(bounced.role_name ?? '') ? new Set([GUARDIAN]) : null
  if (!wantRoles) return null
  const other = recipients.find((r) => r.recipient_id !== bounced.recipient_id && wantRoles.has(r.role_name ?? ''))
  if (!other?.email) return null
  if (norm(other.email) === norm(bounced.email)) return null
  if (other.status === 'autoresponded') return null
  return other
}

// ─── Loading ──────────────────────────────────────────────────────────────

const AGREEMENT_COLUMNS = 'id, tenant_id, event_slug, event_title, minor_name, signer_name, participant_id, provider, status'
const RECIPIENT_COLUMNS = 'id, recipient_id, role_name, name, email, status, bounce_notified_email, invite_error'

export async function loadBounceContext(db: SupabaseClient, agreementId: string): Promise<BounceContext | null> {
  const [{ data: agreement }, { data: recipients }] = await Promise.all([
    db.from('agreements').select(AGREEMENT_COLUMNS).eq('id', agreementId).maybeSingle(),
    db.from('agreement_recipients').select(RECIPIENT_COLUMNS).eq('envelope_row', agreementId).order('routing_order', { ascending: true }),
  ])
  if (!agreement) return null
  return {
    agreement: agreement as BounceAgreement,
    recipients: (recipients ?? []) as BounceRecipientRow[],
    organisers: await loadGroupOrganisers(db, (agreement as BounceAgreement).participant_id),
  }
}

/** The group's organisers when the participant is on a group registration. */
export async function loadGroupOrganisers(db: SupabaseClient, participantId: string | null): Promise<GroupOrganisers | null> {
  if (!participantId) return null
  const { data: p } = await db.from('participants').select('registration_id').eq('id', participantId).maybeSingle()
  const registrationId = (p as { registration_id: string | null } | null)?.registration_id
  if (!registrationId) return null
  const { data: reg } = await db
    .from('registrations')
    .select('id, type, registrant_role, teacher_member_id, teacher_email, teacher_poc_email')
    .eq('id', registrationId)
    .maybeSingle()
  const r = reg as {
    id: string
    type: string | null
    registrant_role: string | null
    teacher_member_id: string | null
    teacher_email: string | null
    teacher_poc_email: string | null
  } | null
  if (!r || r.type !== 'group') return null
  const people = [
    { memberId: r.teacher_member_id, email: r.teacher_email },
    { memberId: null, email: r.teacher_poc_email },
  ].filter((x) => x.memberId || x.email)
  return {
    registrationId: r.id,
    registrantRole: r.registrant_role === 'student_manager' ? 'student_manager' : r.registrant_role === 'teacher' ? 'teacher' : null,
    people,
  }
}

// ─── The claim ────────────────────────────────────────────────────────────

/**
 * Claims the right to announce this row's bounce. True for exactly one caller
 * per (row, address): a compare-and-set on bounce_notified_email.
 */
export async function claimBounceNotice(db: SupabaseClient, row: BounceRecipientRow): Promise<boolean> {
  const email = norm(row.email)
  if (!email) return false
  const prior = row.bounce_notified_email ?? null
  if (prior === email) return false
  const base = db.from('agreement_recipients').update({ bounce_notified_email: email }).eq('id', row.id)
  const { data, error } = await (prior === null ? base.is('bounce_notified_email', null) : base.eq('bounce_notified_email', prior)).select('id')
  if (error) {
    console.error('[bounce-notices] claim failed:', error.message)
    return false
  }
  return (data ?? []).length > 0
}

// ─── Delivery ─────────────────────────────────────────────────────────────

interface Person {
  memberId: string | null
  email: string | null
}

/**
 * Resolves people to member rows where they have one, drops any whose address
 * is in `exclude`, and de-duplicates by member id and address.
 */
async function resolvePeople(db: SupabaseClient, people: Person[], exclude: Set<string>): Promise<Person[]> {
  const ids = [...new Set(people.map((p) => p.memberId).filter((v): v is string => !!v))]
  const emails = [...new Set(people.map((p) => norm(p.email)).filter(Boolean))]
  const byId = new Map<string, string | null>()
  const byEmail = new Map<string, string>()
  if (ids.length) {
    const { data } = await db.from('members').select('id, email').in('id', ids).eq('is_active', true)
    for (const m of (data ?? []) as { id: string; email: string | null }[]) byId.set(m.id, m.email)
  }
  if (emails.length) {
    const { data } = await db.from('members').select('id, email').in('email', emails).eq('is_active', true)
    for (const m of (data ?? []) as { id: string; email: string | null }[]) if (m.email) byEmail.set(norm(m.email), m.id)
  }
  const out: Person[] = []
  const seenIds = new Set<string>()
  const seenEmails = new Set<string>()
  for (const p of people) {
    const memberId = p.memberId && byId.has(p.memberId) ? p.memberId : byEmail.get(norm(p.email)) ?? null
    const email = norm((memberId && byId.get(memberId)) || p.email) || null
    if (!memberId && !email) continue
    if (email && exclude.has(email)) continue
    if (memberId && seenIds.has(memberId)) continue
    if (email && seenEmails.has(email)) continue
    if (memberId) seenIds.add(memberId)
    if (email) seenEmails.add(email)
    out.push({ memberId, email })
  }
  return out
}

// S5 B14 follow-up: who the notices to signers and group organisers are from.
// On Stellr's agreements, Stellr's default sender (no keys). On another
// tenant's, that tenant's own sender ("<Tenant> via Stellr", its Reply-To),
// read once per notice and only while TENANT_EVENT_MAIL_ENABLED is true; with
// none, those notices are not sent (logged), so a tenant's family never gets one
// as Stellr. Notices to staff and event managers are unchanged.
type SignerMail = { from?: string; replyTo?: string }

async function signerMailFor(db: SupabaseClient, a: BounceAgreement): Promise<SignerMail | null> {
  if (!isTenantRow(a.tenant_id)) return {}
  const sender = await loadTenantSender(db, a.tenant_id)
  if (!sender) console.error(`[bounce-notices] agreement ${a.id}: its tenant has no usable sender; signer and organiser notices not sent`)
  return sender
}

/**
 * A member gets their usual channels (bell + email, by their preferences); anyone else an email.
 * `mail` is the sender for a signer or organiser (S5): null sends nothing; left out, Stellr's default.
 */
async function tell(person: Person, input: NotifyInput, stellr: boolean, mail: SignerMail | null = {}): Promise<void> {
  try {
    if (person.memberId && stellr) {
      await notifyMember(person.memberId, input)
      return
    }
    if (!person.email || !input.email || !mail) return
    await sendEmail({ to: person.email, subject: input.email.subject, html: input.email.html, text: input.email.text ?? input.body, ...mail })
  } catch (err) {
    console.error('[bounce-notices] notice failed:', err instanceof Error ? err.message : err)
  }
}

/** The event's active managers, as people. Empty on a lookup error (logged). */
async function eventManagers(db: SupabaseClient, tenantId: string, eventSlug: string | null): Promise<Person[]> {
  if (!eventSlug) return []
  try {
    const clerkIds = await eventManagerAudienceClerkIds(db, tenantId, eventSlug)
    if (!clerkIds.length) return []
    const { data } = await db.from('members').select('id, email').in('clerk_user_id', clerkIds).eq('is_active', true)
    return ((data ?? []) as { id: string; email: string | null }[]).map((m) => ({ memberId: m.id, email: m.email }))
  } catch (err) {
    console.error('[bounce-notices] event manager lookup failed:', err instanceof Error ? err.message : err)
    return []
  }
}

async function crewMemberIds(db: SupabaseClient, tenantId: string): Promise<Set<string>> {
  try {
    return new Set(await dutyAudienceMemberIds(db, tenantId, ['all', 'community']))
  } catch {
    return new Set()
  }
}

function rosterUrl(eventSlug: string | null): string {
  return eventSlug ? `${AUTH_APP_URL}/admin/competitions/${encodeURIComponent(eventSlug)}` : `${AUTH_APP_URL}/admin/docusigns`
}

const YOUR_GROUP_URL = () => `${AUTH_APP_URL}/account?tab=teams`

/** The same button the signing emails use (lib/esign/emails.ts). */
function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">${esc(label)}</a></p>`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' })
}

// ─── Announcing a bounce ──────────────────────────────────────────────────

export interface AnnounceOptions {
  kind?: BounceKind
  /** Prefer an already-loaded context (tests, callers that have it). */
  context?: BounceContext
  now?: Date
}

/**
 * Announces every bounced signer on the agreement that has not been announced
 * for its current address. Returns how many signers were announced. Never
 * throws: a failed notice must not undo the bounce being recorded.
 */
export async function announceBounces(db: SupabaseClient, agreementId: string, opts: AnnounceOptions = {}): Promise<number> {
  try {
    const ctx = opts.context ?? (await loadBounceContext(db, agreementId))
    if (!ctx) return 0
    const candidates = ctx.recipients.filter((r) => r.status === 'autoresponded' && r.email && r.role_name !== STELLR_ROLE)
    const claimed: BounceRecipientRow[] = []
    for (const r of candidates) if (await claimBounceNotice(db, r)) claimed.push(r)
    if (!claimed.length) return 0
    await deliverBounceNotices(db, ctx, claimed, opts.kind ?? 'bounced', opts.now ?? new Date())
    return claimed.length
  } catch (err) {
    console.error('[bounce-notices] announce failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

async function deliverBounceNotices(
  db: SupabaseClient,
  ctx: BounceContext,
  bounced: BounceRecipientRow[],
  kind: BounceKind,
  now: Date,
): Promise<void> {
  const a = ctx.agreement
  const tenantId = a.tenant_id ?? STELLR_TENANT_ID
  const stellr = tenantId === STELLR_TENANT_ID
  const about = aboutName(a)
  const event = a.event_title?.trim() || 'the event'
  const live = a.status === 'sent' || a.status === 'delivered'
  const dead = new Set(bounced.map((b) => norm(b.email)))
  const engine = a.provider === 'native' ? 'Stellr signing' : 'DocuSign'
  const what = kind === 'suppressed' ? 'was not sent: the address is on the email suppression list' : 'bounced'

  // Who else is told, for the staff notice.
  const others = new Map<string, BounceRecipientRow>()
  if (live) {
    for (const b of bounced) {
      const o = otherSigner(ctx.recipients, b)
      if (o && !dead.has(norm(o.email))) others.set(b.recipient_id, o)
    }
  }
  const organisers = live && ctx.organisers ? await resolvePeople(db, ctx.organisers.people, dead) : []
  const alsoTold = [
    organisers.length ? (ctx.organisers?.registrantRole === 'student_manager' ? "the group's student manager and teacher" : "the group's teacher") : null,
    others.size ? 'the other signer on the form' : null,
  ].filter(Boolean)

  // 1. Staff: admins and event managers.
  const lines = bounced.map((b) => `${b.name ?? 'Signer'} <${b.email}> — ${b.role_name ?? 'signer'}${b.invite_error ? ` (${b.invite_error})` : ''}`)
  const htmlLines = bounced.map(
    (b) => `${esc(b.name ?? 'Signer')} &lt;${esc(b.email ?? '')}&gt; — ${esc(b.role_name ?? 'signer')}${b.invite_error ? ` (${esc(b.invite_error)})` : ''}`,
  )
  const told = alsoTold.length ? ` Also told: ${alsoTold.join(' and ')}.` : ''
  const fix = live
    ? 'Reminders will never reach this address. Fix it with Correct email on the event roster: it keeps any signature already given.'
    : 'The form is no longer live, so nothing is waiting on this address.'
  const crewInput: NotifyInput = {
    type: 'action',
    body: `${engine}: a signing email ${what} for ${about} (${event}): ${lines.join('; ')}. ${fix}${told}`,
    referenceType: a.participant_id ? 'participant' : undefined,
    referenceId: a.participant_id ?? undefined,
    email: {
      subject: `Action needed: a signing email ${kind === 'suppressed' ? 'was not sent' : 'bounced'} for ${about}`,
      html:
        `<p>${esc(engine)}: a signing email ${esc(what)} on the form for <strong>${esc(about)}</strong> (${esc(event)}):</p>` +
        `<ul>${htmlLines.map((l) => `<li>${l}</li>`).join('')}</ul><p>${esc(fix)}${esc(told)}</p>` +
        (live ? `<p><a href="${esc(rosterUrl(a.event_slug))}">Open the event roster</a></p>` : ''),
      text: `${engine}: a signing email ${what} on the form for ${about} (${event}): ${lines.join('; ')}. ${fix}${told}${live ? `\n\nOpen the event roster: ${rosterUrl(a.event_slug)}` : ''}`,
    },
  }
  await notifyCommunityAdmins(crewInput, { tenantId }).catch(() => {})
  const crewIds = await crewMemberIds(db, tenantId)
  const managers = (await resolvePeople(db, await eventManagers(db, tenantId, a.event_slug), dead)).filter(
    (m) => !m.memberId || !crewIds.has(m.memberId),
  )
  for (const m of managers) await tell(m, crewInput, stellr)
  if (!live) return
  const mail = await signerMailFor(db, a)

  const crewLike = new Set([...managers.map((m) => m.memberId).filter(Boolean), ...crewIds])
  const crewEmails = new Set(managers.map((m) => m.email).filter(Boolean))

  // 2. Group organisers.
  for (const o of organisers) {
    if ((o.memberId && crewLike.has(o.memberId)) || (o.email && crewEmails.has(o.email))) continue
    const bodyLines = bounced.map((b) => `${b.name ?? 'The signer'} (${roleLabel(b.role_name)}) at ${b.email}`)
    const text =
      `The email asking ${bodyLines.join(' and ')} to sign ${about}'s form for ${event} could not be delivered. ` +
      `Open Your group and choose Fix email to give the right address: the form is sent again to it, and any signature already given is kept.`
    await tell(
      o,
      {
        type: 'action',
        body: text,
        email: {
          subject: `A consent form email bounced for ${about}`,
          html: emailLayout({
            heading: `A consent form email bounced for ${about}`,
            preheader: `Fix the address in Your group.`,
            bodyHtml:
              `<p>The email asking ${bounced.map((b) => `<strong>${esc(b.name ?? 'the signer')}</strong> (${esc(roleLabel(b.role_name))}) at ${esc(b.email ?? '')}`).join(' and ')} to sign ${esc(about)}'s form for ${esc(event)} could not be delivered.</p>` +
              `<p>Open Your group and choose <strong>Fix email</strong> to give the right address. The form is sent again to it, and any signature already given is kept.</p>` +
              button(YOUR_GROUP_URL(), 'Open Your group'),
          }),
          text: `${text}\n\nOpen Your group: ${YOUR_GROUP_URL()}`,
        },
      },
      stellr,
      mail,
    )
  }

  // 3. The other signer on a two-person form.
  const organiserEmails = new Set(organisers.map((o) => o.email).filter(Boolean))
  // No sender for this tenant: no change link is minted, since nobody is sent it.
  if (!mail) return
  for (const b of bounced) {
    const other = others.get(b.recipient_id)
    if (!other?.email) continue
    const otherEmail = norm(other.email)
    if (crewEmails.has(otherEmail) || organiserEmails.has(otherEmail)) continue
    const studentBounced = b.role_name !== GUARDIAN
    const { token, expiresAt } = await createChangeLink(db, {
      agreementId: a.id,
      recipientId: b.recipient_id,
      roleName: b.role_name,
      oldEmail: b.email as string,
      kind: studentBounced ? 'direct' : 'suggestion',
      requestedByRole: other.role_name,
      requestedByEmail: other.email,
      now,
    })
    const link = changeLinkUrl(token)
    const masked = maskEmail(b.email as string)
    const first = (other.name ?? '').trim().split(/\s+/)[0] || 'there'
    const until = formatDate(expiresAt)
    // On another tenant's agreement, its own staff check the address, not Stellr.
    const checker = ctx.organisers ? 'Your teacher checks' : stellr ? 'Stellr checks' : 'The event organiser checks'
    const email = studentBounced
      ? {
          subject: `We couldn't reach ${about}`,
          heading: `We couldn't reach ${about}`,
          paras: [
            `Hi ${first}, we sent ${about}'s part of the ${event} form to ${masked}, but the email bounced.`,
            `You can give us the right address for ${about}. The form is sent to it straight away, and your signature is kept.`,
          ],
          cta: `Update ${about.split(/\s+/)[0]}'s email`,
        }
      : {
          subject: 'We couldn’t reach your parent or guardian',
          heading: 'We couldn’t reach your parent or guardian',
          paras: [
            `Hi ${first}, we sent the ${event} consent form to your parent or guardian at ${masked}, but the email bounced.`,
            `Ask them for the address they use, then suggest it here. ${checker} it before the form is sent again.`,
          ],
          cta: 'Suggest an address',
        }
    const note = `This link works once and expires on ${until}. If you weren't expecting this, you can ignore it.`
    try {
      await sendEmail({
        to: other.email,
        subject: email.subject,
        html: emailLayout({
          heading: email.heading,
          preheader: email.paras[0],
          bodyHtml: email.paras.map((p) => `<p>${esc(p)}</p>`).join('') + button(link, email.cta) + `<p style="font-size:14px">${esc(note)}</p>`,
        }),
        text: `${email.paras.join('\n\n')}\n\n${email.cta}: ${link}\n\n${note}`,
        ...mail,
      })
    } catch (err) {
      console.error('[bounce-notices] other-signer notice failed:', err instanceof Error ? err.message : err)
    }
  }
}

// ─── Announcing a change ──────────────────────────────────────────────────

export type ChangeActor =
  | { kind: 'organiser'; memberId: string; role: 'teacher' | 'student_manager' | 'teacher_poc' }
  | { kind: 'guardian' }
  | { kind: 'approved'; label: string }

/**
 * Tells everyone who was told about a bounce that it was fixed, so a change
 * nobody expected is seen: staff and event managers always; the organisers
 * unless one of them made it; the other signer when an organiser made it (the
 * check on an organiser redirecting a family's address).
 */
export async function announceCorrection(
  db: SupabaseClient,
  input: { agreementId: string; recipientId: string; oldEmail: string; newEmail: string; actor: ChangeActor },
): Promise<void> {
  try {
    const ctx = await loadBounceContext(db, input.agreementId)
    if (!ctx) return
    const a = ctx.agreement
    const tenantId = a.tenant_id ?? STELLR_TENANT_ID
    const stellr = tenantId === STELLR_TENANT_ID
    const about = aboutName(a)
    const event = a.event_title?.trim() || 'the event'
    const signer = ctx.recipients.find((r) => r.recipient_id === input.recipientId)
    const role = roleLabel(signer?.role_name)
    const by =
      input.actor.kind === 'organiser'
        ? input.actor.role === 'student_manager' ? "the group's student manager" : "the group's teacher"
        : input.actor.kind === 'guardian' ? 'the parent/guardian on the form' : input.actor.label

    const crewText = `The ${role}'s signing address on ${about}'s form (${event}) was changed by ${by}: ${input.oldEmail} → ${input.newEmail}. The form was sent to the new address.`
    const crewInput: NotifyInput = {
      type: 'action',
      body: crewText,
      referenceType: a.participant_id ? 'participant' : undefined,
      referenceId: a.participant_id ?? undefined,
      email: {
        subject: `Signing address changed for ${about}`,
        html: `<p>${esc(crewText)}</p><p><a href="${esc(rosterUrl(a.event_slug))}">Open the event roster</a></p>`,
        text: `${crewText}\n\nOpen the event roster: ${rosterUrl(a.event_slug)}`,
      },
    }
    await notifyCommunityAdmins(crewInput, { tenantId }).catch(() => {})
    const crewIds = await crewMemberIds(db, tenantId)
    const exclude = new Set([norm(input.oldEmail)])
    const managers = (await resolvePeople(db, await eventManagers(db, tenantId, a.event_slug), exclude)).filter(
      (m) => !m.memberId || !crewIds.has(m.memberId),
    )
    for (const m of managers) await tell(m, crewInput, stellr)
    const crewLike = new Set([...crewIds, ...managers.map((m) => m.memberId).filter(Boolean)])

    const actorId = input.actor.kind === 'organiser' ? input.actor.memberId : null
    const mail = await signerMailFor(db, a)
    if (ctx.organisers && input.actor.kind !== 'organiser') {
      const orgText = `The ${role}'s address on ${about}'s consent form for ${event} was updated by ${by}, and the form was sent to the new address (${input.newEmail}).`
      for (const o of await resolvePeople(db, ctx.organisers.people, exclude)) {
        if (o.memberId && (crewLike.has(o.memberId) || o.memberId === actorId)) continue
        await tell(o, { type: 'action', body: orgText, email: { subject: `Consent form address updated for ${about}`, html: emailLayout({ heading: `Consent form address updated for ${about}`, bodyHtml: `<p>${esc(orgText)}</p>` }), text: orgText } }, stellr, mail)
      }
    }

    if (input.actor.kind === 'organiser' && signer && mail) {
      const other = otherSigner(ctx.recipients, { ...signer, email: input.oldEmail, status: 'autoresponded' })
      if (other?.email && norm(other.email) !== norm(input.newEmail)) {
        const text = `The ${role}'s email on ${about}'s ${event} form was changed by ${by} to ${maskEmail(input.newEmail)}, because the old address bounced. If that looks wrong, reply to your teacher or contact ${stellr ? 'Stellr' : 'the event organiser'}.`
        try {
          await sendEmail({
            to: other.email,
            subject: `An email address on ${about}'s form was updated`,
            html: emailLayout({ heading: `An email address on ${about}'s form was updated`, bodyHtml: `<p>${esc(text)}</p>` }),
            text,
            ...mail,
          })
        } catch (err) {
          console.error('[bounce-notices] change notice failed:', err instanceof Error ? err.message : err)
        }
      }
    }
  } catch (err) {
    console.error('[bounce-notices] correction notice failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Tells whoever approves a student's suggested parent/guardian address that one
 * is waiting: the group's organisers on a group registration, otherwise the
 * admins and the event's managers.
 */
export async function announceSuggestion(db: SupabaseClient, input: { agreementId: string; suggested: string }): Promise<void> {
  try {
    const ctx = await loadBounceContext(db, input.agreementId)
    if (!ctx) return
    const a = ctx.agreement
    const tenantId = a.tenant_id ?? STELLR_TENANT_ID
    const stellr = tenantId === STELLR_TENANT_ID
    const about = aboutName(a)
    const event = a.event_title?.trim() || 'the event'
    if (ctx.organisers) {
      const mail = await signerMailFor(db, a)
      const text = `${about} suggested a new parent/guardian email for their ${event} consent form, because the old one bounced. Open Your group to approve or reject it: it is used only once you approve.`
      for (const o of await resolvePeople(db, ctx.organisers.people, new Set())) {
        await tell(
          o,
          {
            type: 'action',
            body: text,
            email: {
              subject: `Approve a parent/guardian email for ${about}`,
              html: emailLayout({ heading: `Approve a parent/guardian email for ${about}`, bodyHtml: `<p>${esc(text)}</p>${button(YOUR_GROUP_URL(), 'Open Your group')}` }),
              text: `${text}\n\nOpen Your group: ${YOUR_GROUP_URL()}`,
            },
          },
          stellr,
          mail,
        )
      }
      return
    }
    const text = `${about} suggested a new parent/guardian email (${input.suggested}) for their ${event} consent form, because the old one bounced. Approve or reject it from Correct email on the event roster.`
    const crewInput: NotifyInput = {
      type: 'action',
      body: text,
      referenceType: a.participant_id ? 'participant' : undefined,
      referenceId: a.participant_id ?? undefined,
      email: {
        subject: `Approve a parent/guardian email for ${about}`,
        html: `<p>${esc(text)}</p><p><a href="${esc(rosterUrl(a.event_slug))}">Open the event roster</a></p>`,
        text: `${text}\n\nOpen the event roster: ${rosterUrl(a.event_slug)}`,
      },
    }
    await notifyCommunityAdmins(crewInput, { tenantId }).catch(() => {})
    const crewIds = await crewMemberIds(db, tenantId)
    for (const m of await resolvePeople(db, await eventManagers(db, tenantId, a.event_slug), new Set())) {
      if (m.memberId && crewIds.has(m.memberId)) continue
      await tell(m, crewInput, stellr)
    }
  } catch (err) {
    console.error('[bounce-notices] suggestion notice failed:', err instanceof Error ? err.message : err)
  }
}
