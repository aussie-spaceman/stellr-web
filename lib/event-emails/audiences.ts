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
import type { AudienceKey, RecipientRole } from './types'
import type { PaymentLine, RecipientForRender } from './render'

export interface ResolvedRecipient extends RecipientForRender {
  /** Display name for previews and history. */
  name: string
  reasons: AudienceKey[]
}

export interface ResolvedAudience {
  recipients: ResolvedRecipient[]
  /** Participants whose DocuSign is outstanding — the resend set. */
  docusignParticipantIds: string[]
}

export interface MentorContact { email: string; firstName: string; lastName: string; role: 'volunteer' | 'event_manager' }

interface Add {
  email: string | null | undefined
  firstName: string | null | undefined
  lastName?: string | null
  role: RecipientRole
  reason: AudienceKey
  participantName?: string
  isParticipant?: boolean
  payment?: PaymentLine & { key: string }
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
      }
      byEmail.set(email, r)
    }
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
      const participant = { email: p.email, firstName: p.first_name, lastName: p.last_name, participantName: p.first_name, isParticipant: true }
      const parent = { email: guardian, firstName: p.emergency_contact_first_name, lastName: p.emergency_contact_last_name, participantName: p.first_name }

      if (want.has('participants')) add({ ...participant, role: 'participant', reason: 'participants' })
      if (want.has('guardians')) add({ ...parent, role: 'guardian', reason: 'guardians' })

      if (want.has('docusign_outstanding') && p.docusign === 'outstanding') {
        docusignIds.add(p.id)
        add({ ...participant, role: 'participant', reason: 'docusign_outstanding' })
        add({ ...parent, role: 'guardian', reason: 'docusign_outstanding' })
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
        role: 'teacher',
        reason: 'payment_outstanding',
        participantName: 'your group',
        payment: { key: g.registrationId, participantName: 'your group', payUrl, method },
      })
    }
  }

  if (want.has('mentors')) {
    for (const m of mentors) add({ email: m.email, firstName: m.firstName, lastName: m.lastName, role: m.role, reason: 'mentors' })
  }

  const recipients = [...byEmail.values()]
    .map(({ paymentKeys: _k, ...r }) => r)
    .sort((a, b) => a.name.localeCompare(b.name))
  return { recipients, docusignParticipantIds: [...docusignIds] }
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
      .select('members(first_name, last_name, email)')
      .eq('cohort_id', container.id)
      .eq('relationship', 'volunteer')
      .eq('status', 'active')
    for (const r of rows ?? []) {
      const m = (Array.isArray(r.members) ? r.members[0] : r.members) as
        { first_name: string | null; last_name: string | null; email: string | null } | null
      if (m?.email) out.push({ email: m.email, firstName: m.first_name ?? '', lastName: m.last_name ?? '', role: 'volunteer' })
    }
  }

  const { data: managers } = await db
    .from('event_manager_assignments')
    .select('clerk_user_id')
    .eq('event_slug', slug)
  if (managers?.length) {
    try {
      const client = await clerkClient()
      const { data: users } = await client.users.getUserList({
        userId: managers.map((m) => m.clerk_user_id as string),
        limit: managers.length,
      })
      for (const u of users) {
        const email = u.primaryEmailAddress?.emailAddress
        if (email) out.push({ email, firstName: u.firstName ?? '', lastName: u.lastName ?? '', role: 'event_manager' })
      }
    } catch (err) {
      console.error('[event-emails] event manager lookup failed:', err)
    }
  }
  return out
}

export async function resolveAudience(
  db: SupabaseClient,
  event: { slug: string; date?: string | null },
  audiences: AudienceKey[],
  opts: { mintPayLinks?: boolean } = {},
): Promise<ResolvedAudience> {
  const roster = await getEventRoster(event.slug, event.date ?? undefined)
  const mentors = audiences.includes('mentors') ? await loadMentorContacts(db, event.slug) : []

  // Pay tokens are minted only for a real send; a preview shows a placeholder
  // rather than writing a token to every pending registration it looks at.
  const payUrls = new Map<string, string>()
  if (audiences.includes('payment_outstanding') && opts.mintPayLinks) {
    for (const g of roster.groups) {
      if (g.payLinkSendable) payUrls.set(g.registrationId, payPageUrl(event.slug, await ensurePayToken(db, g.registrationId)))
    }
  }
  return buildRecipients(roster, mentors, audiences, (g) =>
    g.payLinkSendable ? payUrls.get(g.registrationId) ?? (opts.mintPayLinks ? null : '[pay link]') : null,
  )
}
