// Who an event email goes to. Built on the same roster the Roster tab shows
// (getEventRoster), so "outstanding" means exactly what the pills say, and
// resolved at SEND time — a family that signs overnight drops out of the next
// scheduled reminder without anyone editing it.
//
// One email per address: a parent with two children, or a student whose own
// address is also the emergency contact, gets a single message naming everyone.

import type { SupabaseClient } from '@supabase/supabase-js'
import { clerkClient } from '@clerk/nextjs/server'
import { getEventRoster, type EventRosterData, type RosterGroup } from '@/lib/event-admin'
import { ensurePayToken, payPageUrl } from '@/lib/registration-checkout'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import { eventManagerAudienceClerkIds } from '@/lib/authz/audiences'
import { loadEventTenantId } from '@/lib/authz/principal'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import type { AudienceKey, RecipientRole } from './types'
import { crewKey } from '@/lib/check-in-desk'
import { AWARD_TYPES, EVENT_AWARDS, isAwardType } from '@/lib/event-awards'
import { familyCertificateUrl, familyCredentialUrl } from '@/lib/credentials-link'
import type { CredentialLine, PaymentLine, RecipientForRender } from './render'

export interface ResolvedRecipient extends RecipientForRender {
  /** Display name for previews and history. */
  name: string
  reasons: AudienceKey[]
  /** The recipient's own members row (not a guardian's child's), for the admin link in history. */
  memberId?: string | null
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[]
  /** Participants whose DocuSign is outstanding — the resend set. */
  docusignParticipantIds: string[]
  /** Students whose team profile is outstanding, for {{team_profile_link}}. */
  teamProfileParticipantIds?: string[]
  /**
   * Of those, the ones whose outstanding agreement is on Stellr signing. An
   * email carrying {{agreement_link}} already gives them their link, so they
   * are not sent a second signing email as well.
   */
  nativeParticipantIds?: string[]
}

interface OutstandingSigner {
  participantId: string | null
  provider: 'native' | 'docusign'
  email: string
  /** The signer is the participant themselves, not their parent. */
  own: boolean
  /** Stellr signing only: this signer's link, or null while the parent signs first. */
  signUrl: string | null
  waiting: boolean
}

/**
 * Everyone who still has to sign an agreement for this event, by address.
 * Links are minted only for a real send: a preview or a test email to staff
 * shows a placeholder, so a family's working link never lands in a staff inbox.
 */
export async function loadOutstandingSigners(
  db: SupabaseClient,
  slug: string,
  opts: { mintLinks: boolean },
): Promise<OutstandingSigner[]> {
  const { data: envelopes } = await db
    .from('agreements')
    .select('id, provider, participant_id, signer_email')
    .eq('event_slug', slug)
    .in('status', ['sent', 'delivered'])
    .is('reused_from', null)
  if (!envelopes?.length) return []
  const { data: recipients } = await db
    .from('agreement_recipients')
    .select('id, envelope_row, email, role_name, status, token_version, token_expires_at')
    .in('envelope_row', envelopes.map((e) => e.id as string))
  const byEnvelope = new Map<string, NonNullable<typeof recipients>>()
  for (const r of recipients ?? []) {
    const list = byEnvelope.get(r.envelope_row as string) ?? []
    list.push(r)
    byEnvelope.set(r.envelope_row as string, list)
  }

  const { signNowUrlFor } = await import('@/lib/esign/outbox')
  const out: OutstandingSigner[] = []
  for (const e of envelopes) {
    const provider = (e.provider === 'native' ? 'native' : 'docusign') as OutstandingSigner['provider']
    const rows = byEnvelope.get(e.id as string) ?? []
    if (!rows.length && e.signer_email) {
      out.push({ participantId: e.participant_id as string | null, provider, email: e.signer_email as string, own: false, signUrl: null, waiting: false })
      continue
    }
    for (const r of rows) {
      if (!r.email || ['completed', 'declined', 'voided'].includes(r.status as string)) continue
      const live = r.status === 'sent' || r.status === 'delivered'
      out.push({
        participantId: e.participant_id as string | null,
        provider,
        email: r.email as string,
        own: r.role_name !== 'Guardian',
        signUrl: provider === 'native' && live
          ? (opts.mintLinks ? signNowUrlFor(r as never) : '[signing link]')
          : null,
        waiting: provider === 'native' && r.status === 'created',
      })
    }
  }
  return out
}

/** Adds each recipient's {{agreement_link}} lines; returns the participants on Stellr signing. */
export function attachAgreementLines(
  recipients: ResolvedRecipient[],
  signers: OutstandingSigner[],
  firstNameOf: (participantId: string) => string | undefined,
): string[] {
  const byEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]))
  const native = new Set<string>()
  for (const s of signers) {
    if (s.provider === 'native' && s.participantId) native.add(s.participantId)
    const r = byEmail.get(s.email.trim().toLowerCase())
    if (!r) continue
    const participantName = s.own ? 'your' : (s.participantId && firstNameOf(s.participantId)) || 'your child'
    r.agreements ??= []
    r.agreements.push({ participantName, provider: s.provider, signUrl: s.signUrl, waiting: s.waiting })
  }
  return [...native]
}

export interface MentorContact {
  email: string
  firstName: string
  lastName: string
  role: 'volunteer' | 'event_manager'
  /** How the desk names them (lib/check-in-desk crewKey): v.<members.id> or m.<Clerk user id>. */
  key: string
  /** Their members row, when there is one. */
  memberId: string | null
  /** Checked in at the desk's Mentors tab. Set only when the attendees group is resolved. */
  checkedIn?: boolean
}

interface Add {
  email: string | null | undefined
  firstName: string | null | undefined
  lastName?: string | null
  role: RecipientRole
  reason: AudienceKey
  /** The recipient's own members row, when known. Never set for a guardian. */
  memberId?: string | null
  participantName?: string
  isParticipant?: boolean
  payment?: PaymentLine & { key: string }
}

/** A roster row's role in an email's history: teachers and mentors are on the roster too. */
function rosterRecipientRole(eventRole: string | null): RecipientRole {
  if (eventRole === 'teacher') return 'teacher'
  if (eventRole === 'mentor' || eventRole === 'volunteer') return 'volunteer'
  return 'participant'
}

/**
 * Pure core: roster + mentor contacts in, deduplicated recipients out. The pay
 * URL for a card registration comes from `payUrlFor` so tests need no database.
 */
export function buildRecipients(
  roster: EventRosterData,
  mentors: MentorContact[],
  audiences: AudienceKey[],
  payUrlFor: (group: RosterGroup) => string | null,
): ResolvedAudience {
  const want = new Set(audiences)
  const byEmail = new Map<string, ResolvedRecipient & { paymentKeys: Set<string> }>()
  const docusignIds = new Set<string>()
  const teamProfileIds = new Set<string>()

  const add = (a: Add) => {
    const email = a.email?.trim().toLowerCase()
    if (!email || !email.includes('@')) return
    let r = byEmail.get(email)
    if (!r) {
      r = {
        email,
        firstName: a.firstName?.trim() || '',
        name: [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || email,
        roles: [],
        reasons: [],
        participantNames: [],
        isParticipant: false,
        payments: [],
        paymentKeys: new Set(),
        memberId: a.memberId ?? null,
      }
      byEmail.set(email, r)
    }
    if (!r.memberId && a.memberId) r.memberId = a.memberId
    // A participant's own name wins the greeting over a guardian's.
    if (a.isParticipant && !r.isParticipant) {
      r.isParticipant = true
      r.firstName = a.firstName?.trim() || r.firstName
      r.name = [a.firstName, a.lastName].filter(Boolean).join(' ').trim() || r.name
    }
    if (!r.roles.includes(a.role)) r.roles.push(a.role)
    if (!r.reasons.includes(a.reason)) r.reasons.push(a.reason)
    if (a.participantName && !r.participantNames.includes(a.participantName)) r.participantNames.push(a.participantName)
    if (a.payment && !r.paymentKeys.has(a.payment.key)) {
      r.paymentKeys.add(a.payment.key)
      const { key: _key, ...line } = a.payment
      r.payments.push(line)
    }
  }

  for (const g of roster.groups) {
    // A group registration settled in one go (invoice, or the organiser's card
    // checkout) is the organiser's to pay — parents are not chased for it.
    const groupPaysAsOne = g.type === 'group' && !g.memberPaysIndividually
    const method: PaymentLine['method'] = g.invoiceRequested
      ? 'invoice'
      : g.memberPaysIndividually
        ? 'individual'
        : 'link'
    const payUrl = want.has('payment_outstanding') && method === 'link' ? payUrlFor(g) : null
    let groupOwes = false

    for (const p of g.participants) {
      const guardian = p.minor ? p.emergency_contact_email : null
      const participant = { email: p.email, firstName: p.first_name, lastName: p.last_name, participantName: p.first_name, isParticipant: true, memberId: p.member_id }
      const parent = { email: guardian, firstName: p.emergency_contact_first_name, lastName: p.emergency_contact_last_name, participantName: p.first_name }

      if (want.has('participants')) add({ ...participant, role: 'participant', reason: 'participants' })
      if (want.has('guardians')) add({ ...parent, role: 'guardian', reason: 'guardians' })

      // Everyone the desk (or their own phone) checked in, whatever their role.
      // A group's organising teacher is here only if they were checked in too.
      if (want.has('attendees') && p.checked_in_at) {
        add({ ...participant, role: rosterRecipientRole(p.event_role), reason: 'attendees' })
      }

      if (want.has('docusign_outstanding') && p.docusign === 'outstanding') {
        docusignIds.add(p.id)
        add({ ...participant, role: 'participant', reason: 'docusign_outstanding' })
        add({ ...parent, role: 'guardian', reason: 'docusign_outstanding' })
      }

      // Forms signed (or none needed), team profile not submitted.
      if (
        want.has('team_profile_outstanding') &&
        STUDENT_ROLES.includes(p.event_role ?? '') &&
        p.docusign !== 'outstanding' &&
        !p.team_profile_submitted
      ) {
        teamProfileIds.add(p.id)
        add({ ...participant, role: 'participant', reason: 'team_profile_outstanding' })
        add({ ...parent, role: 'guardian', reason: 'team_profile_outstanding' })
      }

      if (want.has('payment_outstanding') && !p.paid) {
        if (groupPaysAsOne) {
          groupOwes = true
        } else {
          const payment = { key: `${g.registrationId}:${p.id}`, participantName: p.first_name, payUrl, method }
          add({ ...participant, role: 'participant', reason: 'payment_outstanding', payment })
          add({ ...parent, role: 'guardian', reason: 'payment_outstanding', payment })
        }
      }
    }

    if (groupOwes && g.teacherEmail) {
      add({
        email: g.teacherEmail,
        firstName: g.teacherFirstName,
        memberId: g.teacherMemberId,
        role: 'teacher',
        reason: 'payment_outstanding',
        participantName: 'your group',
        payment: { key: g.registrationId, participantName: 'your group', payUrl, method },
      })
    }
  }

  if (want.has('mentors')) {
    for (const m of mentors) add({ email: m.email, firstName: m.firstName, lastName: m.lastName, role: m.role, reason: 'mentors', memberId: m.memberId })
  }
  // Volunteer mentors and event managers checked in at the desk's Mentors tab.
  if (want.has('attendees')) {
    for (const m of mentors) {
      if (m.checkedIn) add({ email: m.email, firstName: m.firstName, lastName: m.lastName, role: m.role, reason: 'attendees', memberId: m.memberId })
    }
  }

  const recipients = [...byEmail.values()]
    .map(({ paymentKeys: _k, ...r }) => r)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { recipients, docusignParticipantIds: [...docusignIds], teamProfileParticipantIds: [...teamProfileIds] }
}

/** Adds each recipient's {{team_profile_link}} lines: the student's own, and their parent's. */
export function attachTeamProfileLines(
  recipients: ResolvedRecipient[],
  roster: EventRosterData,
  links: Map<string, string>,
): void {
  const byEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]))
  for (const g of roster.groups) {
    for (const p of g.participants) {
      const url = links.get(p.id)
      if (!url) continue
      const own = byEmail.get(p.email?.trim().toLowerCase() ?? '')
      if (own) (own.teamProfiles ??= []).push({ participantName: own.isParticipant && own.firstName === p.first_name ? 'your' : p.first_name, url })
      const guardian = p.minor ? byEmail.get(p.emergency_contact_email?.trim().toLowerCase() ?? '') : undefined
      if (guardian && guardian !== own) (guardian.teamProfiles ??= []).push({ participantName: p.first_name, url })
    }
  }
}

/**
 * Clerk ids of this event's managers, through the event-manager audience in
 * lib/authz/audiences (S5 B17), for the tenant that owns the event. A Stellr
 * event gets every assignment for its slug, as before. Another tenant's event
 * gets only managers assigned to it who also hold that tenant's event_manager
 * membership, so it never emails Stellr's managers.
 *
 * If the events mirror cannot be read, the event is treated as Stellr's: the
 * audience then keeps only assignments stamped for Stellr (or not stamped yet),
 * so a Stellr event still reaches its managers and another tenant's stamped
 * assignments are left out. If the assignments cannot be read, this send leaves
 * event managers out and logs that it did, as a failed read did before (then
 * without a log line).
 */
async function eventManagerIds(db: SupabaseClient, slug: string): Promise<string[]> {
  let tenantId = STELLR_TENANT_ID
  try {
    tenantId = await loadEventTenantId(db, slug)
  } catch (err) {
    console.error('[event-emails] event tenant lookup failed; using Stellr assignments only:', err)
  }
  try {
    return await eventManagerAudienceClerkIds(db, tenantId, slug)
  } catch (err) {
    console.error('[event-emails] event manager lookup failed; this audience leaves event managers out:', err)
    return []
  }
}

/** Assigned volunteers (event container) plus this event's event managers. */
export async function loadMentorContacts(db: SupabaseClient, slug: string): Promise<MentorContact[]> {
  const out: MentorContact[] = []

  const { data: container } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', slug)
    .maybeSingle()
  if (container?.id) {
    const { data: rows } = await db
      .from('cohort_members')
      .select('members(id, first_name, last_name, email)')
      .eq('cohort_id', container.id)
      .eq('relationship', 'volunteer')
      .eq('status', 'active')
    for (const r of rows ?? []) {
      const m = (Array.isArray(r.members) ? r.members[0] : r.members) as
        { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
      if (m?.email) {
        out.push({ email: m.email, firstName: m.first_name ?? '', lastName: m.last_name ?? '', role: 'volunteer', key: crewKey('volunteer', m.id), memberId: m.id })
      }
    }
  }

  const managers = await eventManagerIds(db, slug)
  if (managers.length) {
    try {
      const client = await clerkClient()
      const { data: users } = await client.users.getUserList({
        userId: managers,
        limit: managers.length,
      })
      const { data: memberRows } = await db.from('members').select('id, clerk_user_id').in('clerk_user_id', managers)
      const memberByClerk = new Map(((memberRows ?? []) as { id: string; clerk_user_id: string }[]).map((m) => [m.clerk_user_id, m.id]))
      for (const u of users) {
        const email = u.primaryEmailAddress?.emailAddress
        if (email) {
          out.push({
            email,
            firstName: u.firstName ?? '',
            lastName: u.lastName ?? '',
            role: 'event_manager',
            key: crewKey('event_manager', u.id),
            memberId: memberByClerk.get(u.id) ?? null,
          })
        }
      }
    } catch (err) {
      console.error('[event-emails] event manager lookup failed:', err)
    }
  }
  return out
}

// ── {{certificate_links}} and {{credential_links}} ───────────────────────────

export interface EventCredential {
  id: string
  number: string
  award_type: string | null
  award: string | null
  title: string
  participant_id: string | null
  member_id: string | null
}

/** Every issued (not revoked, not erased) credential of this event. */
export async function loadEventCredentials(db: SupabaseClient, slug: string): Promise<EventCredential[]> {
  const { data, error } = await db
    .from('credentials')
    .select('id, number, award_type, award, title, participant_id, member_id')
    .eq('event_slug', slug)
    .eq('source', 'event')
    .eq('status', 'issued')
    .is('tombstoned_at', null)
  if (error) {
    console.error('[event-emails] credentials could not be read; certificate and credential links are left out:', error)
    return []
  }
  return (data ?? []) as EventCredential[]
}

function credentialLabel(c: EventCredential): string {
  if (isAwardType(c.award_type)) return EVENT_AWARDS[c.award_type].label
  return c.award?.trim() || c.title.split(' — ')[0] || 'Certificate'
}

const awardRank = (c: EventCredential) => {
  const i = isAwardType(c.award_type) ? AWARD_TYPES.indexOf(c.award_type) : -1
  return i < 0 ? AWARD_TYPES.length : i
}

/**
 * Adds each recipient's credential lines: a student's own, the ones of the
 * minors they are the parent or guardian of, and a mentor's own (matched by
 * the member's address). Links are the family links (no sign-in needed) on a
 * real send, placeholders in a preview or test, so a family's working link
 * never lands in a staff inbox.
 */
export function attachCredentialLines(
  recipients: ResolvedRecipient[],
  roster: EventRosterData,
  credentials: EventCredential[],
  memberEmails: Map<string, string>,
  mint: boolean,
): void {
  if (!credentials.length) return
  const byEmail = new Map(recipients.map((r) => [r.email.toLowerCase(), r]))
  const sorted = [...credentials].sort((a, b) => awardRank(a) - awardRank(b))
  const line = (c: EventCredential, participantName: string): CredentialLine => ({
    participantName,
    label: credentialLabel(c),
    certificateUrl: mint ? familyCertificateUrl(c) ?? '[certificate link]' : '[certificate link]',
    credentialUrl: mint ? familyCredentialUrl(c) : '[credential link]',
  })
  const push = (r: ResolvedRecipient | undefined, l: CredentialLine) => {
    if (r) (r.credentials ??= []).push(l)
  }

  const byParticipant = new Map<string, EventCredential[]>()
  for (const c of sorted) {
    if (!c.participant_id) continue
    const list = byParticipant.get(c.participant_id) ?? []
    list.push(c)
    byParticipant.set(c.participant_id, list)
  }
  for (const g of roster.groups) {
    for (const p of g.participants) {
      const creds = byParticipant.get(p.id)
      if (!creds) continue
      const own = byEmail.get(p.email?.trim().toLowerCase() ?? '')
      const guardian = p.minor ? byEmail.get(p.emergency_contact_email?.trim().toLowerCase() ?? '') : undefined
      for (const c of creds) {
        push(own, line(c, own?.isParticipant && own.firstName === p.first_name ? 'your' : p.first_name))
        if (guardian && guardian !== own) push(guardian, line(c, p.first_name))
      }
    }
  }
  // A mentor's Certificate of Appreciation: a member, with no participant row.
  for (const c of sorted) {
    if (c.participant_id || !c.member_id) continue
    push(byEmail.get(memberEmails.get(c.member_id)?.trim().toLowerCase() ?? ''), line(c, 'your'))
  }
}

/**
 * The roster without a tenant's consent-pending participants (S5 wave 6), and
 * without a group left empty by that. Unchanged, with no read, for Stellr. A failed
 * read throws, so the send fails and is retried rather than reaching them.
 */
async function withoutUnconsented(
  db: SupabaseClient,
  roster: EventRosterData,
  tenantId: string | undefined,
): Promise<{ roster: EventRosterData; left: ReadonlySet<string> }> {
  if (!tenantId || tenantId === STELLR_TENANT_ID) return { roster, left: new Set() }
  const { unconsentedParticipantIds } = await import('@/lib/registration/tenant-guardian-consent')
  const left = await unconsentedParticipantIds(db, tenantId)
  if (!left.size) return { roster, left }
  return {
    roster: {
      ...roster,
      groups: roster.groups
        .map((g) => ({ ...g, participants: g.participants.filter((p) => !left.has(p.id)) }))
        .filter((g) => g.participants.length > 0),
    },
    left,
  }
}

async function loadMemberEmails(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data } = await db.from('members').select('id, email').in('id', ids)
  return new Map(((data ?? []) as { id: string; email: string | null }[]).filter((m) => m.email).map((m) => [m.id, m.email as string]))
}

export async function resolveAudience(
  db: SupabaseClient,
  event: { slug: string; date?: string | null },
  audiences: AudienceKey[],
  opts: {
    mintPayLinks?: boolean
    /**
     * S5 wave 6: the owning tenant, passed only for another tenant's email. Its
     * participants whose guardian has not signed the consent form are left out,
     * with their guardians' and signers' lines. Stellr's sends pass nothing and
     * read nothing more.
     */
    tenantId?: string
  } = {},
): Promise<ResolvedAudience> {
  // Every roster-based group, All attendees included, reads this filtered roster:
  // a tenant's consent-pending participant is not on it, so cannot be reached.
  const { roster, left } = await withoutUnconsented(db, await getEventRoster(event.slug, event.date ?? undefined), opts.tenantId)
  // Volunteer mentors and event managers are staff, not roster participants: the
  // consent rule does not apply to them.
  const attendees = audiences.includes('attendees')
  const mentors = audiences.includes('mentors') || attendees ? await loadMentorContacts(db, event.slug) : []
  if (attendees && mentors.length) {
    const { loadCrewCheckIns } = await import('@/lib/check-in-crew')
    const checkedIn = await loadCrewCheckIns(db, event.slug)
    for (const m of mentors) m.checkedIn = checkedIn.has(m.key)
  }

  // Pay tokens are minted only for a real send; a preview shows a placeholder
  // rather than writing a token to every pending registration it looks at.
  const payUrls = new Map<string, string>()
  if (audiences.includes('payment_outstanding') && opts.mintPayLinks) {
    for (const g of roster.groups) {
      if (g.payLinkSendable) payUrls.set(g.registrationId, payPageUrl(event.slug, await ensurePayToken(db, g.registrationId)))
    }
  }
  const resolved = buildRecipients(roster, mentors, audiences, (g) =>
    g.payLinkSendable ? payUrls.get(g.registrationId) ?? (opts.mintPayLinks ? null : '[pay link]') : null,
  )

  // {{agreement_link}}: each address's own signing links (minted on a real send only).
  const firstNames = new Map(roster.groups.flatMap((g) => g.participants.map((p) => [p.id, p.first_name] as const)))
  const signers = (await loadOutstandingSigners(db, event.slug, { mintLinks: !!opts.mintPayLinks }))
    // A left-out participant's signers (the guardian's consent link) are left out too.
    .filter((s) => !s.participantId || !left.has(s.participantId))
  resolved.nativeParticipantIds = attachAgreementLines(resolved.recipients, signers, (id) => firstNames.get(id) ?? undefined)

  // {{team_profile_link}}: minting creates the student's profile row, so only on a real send.
  if (resolved.teamProfileParticipantIds?.length) {
    const { outstandingProfileLinks } = await import('@/lib/team-profile/store')
    const links = await outstandingProfileLinks(db, event.slug, resolved.teamProfileParticipantIds, !!opts.mintPayLinks)
    attachTeamProfileLines(resolved.recipients, roster, links)
  }

  // {{certificate_links}} / {{credential_links}}: issued credentials, as family links on a real send.
  const credentials = await loadEventCredentials(db, event.slug)
  if (credentials.length) {
    const memberEmails = await loadMemberEmails(db, [...new Set(credentials.filter((c) => !c.participant_id && c.member_id).map((c) => c.member_id as string))])
    attachCredentialLines(resolved.recipients, roster, credentials, memberEmails, !!opts.mintPayLinks)
  }
  return resolved
}
