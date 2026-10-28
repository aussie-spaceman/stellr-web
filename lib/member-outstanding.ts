import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { getEventsBySlugs } from '@/lib/sanity'
import { registrationPaid } from '@/lib/payment-status'
import { deriveCompliance, loadComplianceRecordsByMemberIds, requiresBackgroundCheck } from '@/lib/compliance'
import { classifyAgreement } from '@/lib/docusign'
import { eventLastDay, todayInAppZone } from '@/lib/utils'
import { formatUsd } from '@/lib/mentoring-format'
import { CLEARANCE_PATH } from '@/lib/compliance-links'

// What a member still owes for their upcoming events — payment, paperwork,
// clearance — and, for an organiser, how much of their group's paperwork is
// outstanding. One answer for the banner across the top of the portal and the
// event page, so a teacher and their students read the same facts.
//
// Report only: nothing here blocks access. The event page's own gate
// (lib/access-gates) decides that; organisers are never gated (28 Oct 2026 —
// a teacher must always see the state of the group they registered).

export type OutstandingKind = 'payment' | 'paperwork' | 'clearance' | 'group_paperwork'

export interface OutstandingItem {
  kind: OutstandingKind
  eventSlug: string
  eventTitle: string
  text: string
  cta: string
  href: string
}

const STUDENT_ROLES = new Set(['participant', 'school_student_manager'])
// A teacher brings a team to a live event ('group') or to a campaign ('campaign').
const ORGANISED_TYPES = new Set(['group', 'campaign'])

type Reg = {
  id: string
  event_slug: string
  event_title: string | null
  status: string
  type: string
  amount_due_cents: number | null
  invoice_requested: boolean | null
  invoice_paid_at: string | null
  member_pays_individually: boolean | null
  teacher_member_id: string | null
}
type Part = {
  id: string
  event_role: string | null
  date_of_birth: string | null
  individual_payment_status: string | null
  registrations: Reg | Reg[] | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

/**
 * Outstanding items for `memberId` across their upcoming events (or just
 * `eventSlug`). Past events are dropped; an event Sanity can't date is kept.
 */
export async function getOutstandingItems(
  memberId: string,
  opts: { eventSlug?: string; db?: SupabaseClient } = {},
): Promise<OutstandingItem[]> {
  const db = opts.db ?? supabaseServer()
  let partQuery = db
    .from('participants')
    .select(`id, event_role, date_of_birth, individual_payment_status,
      registrations!inner(id, event_slug, event_title, status, type, amount_due_cents, invoice_requested,
        invoice_paid_at, member_pays_individually, teacher_member_id)`)
    .eq('member_id', memberId)
    .neq('registrations.status', 'withdrawn')
  if (opts.eventSlug) partQuery = partQuery.eq('registrations.event_slug', opts.eventSlug)
  const { data: partRows } = await partQuery
  const parts = ((partRows ?? []) as unknown as Part[])
    .map((p) => ({ p, reg: one(p.registrations) }))
    .filter((x): x is { p: Part; reg: Reg } => !!x.reg)
  if (parts.length === 0) return []

  // Upcoming only.
  const slugs = [...new Set(parts.map((x) => x.reg.event_slug))]
  const meta = await getEventsBySlugs(slugs).catch(() => [])
  const metaBySlug = new Map(meta.map((m) => [m.slug.current, m]))
  const today = todayInAppZone()
  const upcoming = parts.filter(({ reg }) => {
    const last = eventLastDay(metaBySlug.get(reg.event_slug) ?? {})
    return !last || last >= today
  })
  if (upcoming.length === 0) return []

  const titleOf = (reg: Reg) => metaBySlug.get(reg.event_slug)?.title ?? reg.event_title ?? 'your event'
  const dateOf = (reg: Reg) => metaBySlug.get(reg.event_slug)?.date ?? undefined

  // Latest agreement per participant (completed wins), for this member's rows
  // and, for an organiser, everyone in their groups.
  const ownedRegIds = [...new Set(upcoming.filter(({ reg }) => ORGANISED_TYPES.has(reg.type) && reg.teacher_member_id === memberId).map(({ reg }) => reg.id))]
  const { data: groupRows } = ownedRegIds.length
    ? await db.from('participants').select('id, event_role, registration_id').in('registration_id', ownedRegIds)
    : { data: [] }
  const groupParts = (groupRows ?? []) as Array<{ id: string; event_role: string | null; registration_id: string }>
  const allIds = [...new Set([...upcoming.map(({ p }) => p.id), ...groupParts.map((g) => g.id)])]
  const { data: agreementRows } = await db
    .from('agreements')
    .select('participant_id, status, envelope_id')
    .in('participant_id', allIds)
    .order('created_at', { ascending: true })
  const agreementOf = new Map<string, string>()
  for (const a of (agreementRows ?? []) as Array<{ participant_id: string; status: string; envelope_id: string | null }>) {
    if (agreementOf.get(a.participant_id) === 'completed') continue
    agreementOf.set(a.participant_id, a.envelope_id?.startsWith('failed:') ? 'failed' : a.status)
  }

  const compliance = await loadComplianceRecordsByMemberIds(db, [memberId])
  const records = compliance.get(memberId)

  const items: OutstandingItem[] = []
  const seen = new Set<string>()
  const push = (item: OutstandingItem) => {
    const key = `${item.kind}:${item.eventSlug}`
    if (seen.has(key)) return
    seen.add(key)
    items.push(item)
  }

  for (const { p, reg } of upcoming) {
    const title = titleOf(reg)
    const isOrganiser = ORGANISED_TYPES.has(reg.type) && reg.teacher_member_id === memberId
    const isStudent = STUDENT_ROLES.has(p.event_role ?? '')
    const eventHref = `/community/events/${reg.event_slug}`

    // Payment.
    const owes = (reg.amount_due_cents ?? 0) > 0 || reg.member_pays_individually
    const paid = registrationPaid({
      invoiceRequested: reg.invoice_requested,
      invoicePaidAt: reg.invoice_paid_at,
      status: reg.status,
      individualPaymentStatus: p.individual_payment_status,
    })
    if (owes && !paid) {
      if (reg.member_pays_individually) {
        push({ kind: 'payment', eventSlug: reg.event_slug, eventTitle: title,
          text: `Your registration fee for ${title} hasn't been paid yet.`, cta: 'Pay now', href: '/account?tab=billing' })
      } else if (isOrganiser) {
        const amount = reg.amount_due_cents ? `${formatUsd(reg.amount_due_cents)} ` : ''
        push({ kind: 'payment', eventSlug: reg.event_slug, eventTitle: title,
          text: reg.invoice_requested
            ? `The ${amount}invoice for ${title} hasn't been paid yet.`
            : `Payment for ${title} hasn't been completed yet.`,
          cta: 'View billing', href: '/account?tab=billing' })
      } else {
        push({ kind: 'payment', eventSlug: reg.event_slug, eventTitle: title,
          text: `Your group's registration fee for ${title} hasn't been paid yet — your teacher has the invoice.`,
          cta: 'View event', href: eventHref })
      }
    }

    // This member's own paperwork.
    const agreement = agreementOf.get(p.id)
    const needsAgreement = !!classifyAgreement(p.event_role, p.date_of_birth)
    if (needsAgreement && agreement !== 'completed') {
      const text = isStudent
        ? agreement && agreement !== 'failed'
          ? `Your parent or guardian hasn't signed your consent form for ${title} yet. It was emailed to them.`
          : `Your consent form for ${title} hasn't reached your parent or guardian yet. We're on it.`
        : agreement && agreement !== 'failed'
          ? `You haven't signed your participation agreement for ${title} yet. Check your email for the signing link.`
          : `Your participation agreement for ${title} hasn't been sent yet. We're on it.`
      push({ kind: 'paperwork', eventSlug: reg.event_slug, eventTitle: title, text, cta: 'See details', href: '/account?tab=profile' })
    }

    // Clearance (teachers and other adults working with students).
    if (requiresBackgroundCheck(p.event_role, p.date_of_birth, dateOf(reg))) {
      const state = deriveCompliance(records?.license ?? null, records?.checks ?? [], p.event_role, p.date_of_birth, dateOf(reg)).state
      if (state !== 'valid_bc' && state !== 'valid_license') {
        push({ kind: 'clearance', eventSlug: reg.event_slug, eventTitle: title,
          text: state === 'in_process'
            ? `Your clearance for ${title} is being reviewed.`
            : `Upload your teaching license or complete a background check before ${title}.`,
          cta: state === 'in_process' ? 'View status' : 'Upload license', href: CLEARANCE_PATH })
      }
    }

    // The organiser's view of their group's paperwork.
    if (isOrganiser) {
      const students = groupParts.filter((g) => g.registration_id === reg.id && STUDENT_ROLES.has(g.event_role ?? ''))
      const unsigned = students.filter((s) => agreementOf.get(s.id) !== 'completed').length
      if (unsigned > 0) {
        push({ kind: 'group_paperwork', eventSlug: reg.event_slug, eventTitle: title,
          text: `${unsigned} of ${students.length} students' consent forms for ${title} ${unsigned === 1 ? 'is' : 'are'} still unsigned.`,
          cta: 'View group', href: `${eventHref}#group` })
      }
    }
  }
  return items
}
