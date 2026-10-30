import { clerkClient } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { describeEnvelope, describeMissingEnvelope, type DocusignPill } from '@/lib/docusign-status'
import { classifyAgreement } from '@/lib/docusign'
import { registrationPaid } from '@/lib/payment-status'
import { resolveSpaceAudiences } from '@/lib/spaces'
import { checkInCodeLink } from '@/lib/check-in-codes'

// The organiser's view of a group they registered: for each person, where
// their agreement is, whether their Stellr account is in use, and whether they
// can reach the event's space. Shown on the event page (/community/events/[slug])
// to the registration's organiser only — the person who has to chase it.

export type AccountState = 'active' | 'created' | 'none'

export interface GroupPersonStatus {
  participantId: string
  name: string
  isStudent: boolean
  isOrganiser: boolean
  agreementPill: DocusignPill
  agreementLabel: string
  /** Account exists (a login was made for them) / they have signed in at least once. */
  account: AccountState
  /** Can enter the event's space (null when the event has no space). */
  spaceAccess: boolean | null
}

export interface GroupStatus {
  registrationId: string
  name: string
  paid: boolean
  invoiceRequested: boolean
  amountDueCents: number | null
  /** The group's check-in code page, shown at the desk on the day (school groups only). */
  checkInCodeUrl: string | null
  people: GroupPersonStatus[]
}

const STUDENT_ROLES = new Set(['participant', 'school_student_manager'])

/** Group registrations for `eventSlug` that `memberId` organised (empty when none). */
export async function getOrganisedGroups(memberId: string, eventSlug: string): Promise<GroupStatus[]> {
  const db = supabaseServer()
  const { data: regs } = await db
    .from('registrations')
    .select(`id, type, status, school_name, amount_due_cents, invoice_requested, invoice_paid_at, school_address_state,
      participants(id, member_id, first_name, last_name, event_role, date_of_birth)`)
    .eq('event_slug', eventSlug)
    .in('type', ['group', 'campaign'])
    .eq('teacher_member_id', memberId)
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: true })
  type P = { id: string; member_id: string | null; first_name: string | null; last_name: string | null; event_role: string | null; date_of_birth: string | null }
  type R = {
    id: string; type: string; status: string; school_name: string | null; amount_due_cents: number | null
    invoice_requested: boolean | null; invoice_paid_at: string | null; school_address_state: string | null
    participants: P[] | null
  }
  const rows = (regs ?? []) as unknown as R[]
  if (rows.length === 0) return []

  const people = rows.flatMap((r) => r.participants ?? [])
  const participantIds = people.map((p) => p.id)
  const memberIds = [...new Set(people.map((p) => p.member_id).filter((id): id is string => !!id))]

  const [{ data: agreements }, { data: members }, { data: sources }] = await Promise.all([
    db.from('agreements')
      .select('participant_id, status, signers_total, signers_completed, reused_from, envelope_id, issue_error')
      .in('participant_id', participantIds)
      .order('created_at', { ascending: true }),
    memberIds.length
      ? db.from('members').select('id, clerk_user_id').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; clerk_user_id: string | null }> }),
    db.from('community_space_sources').select('space_id').eq('object_type', 'event').eq('object_ref', eventSlug),
  ])

  // Same row choice as the admin roster: completed, then a real envelope over a
  // refused-send marker, then the latest.
  type A = { participant_id: string; status: string; signers_total: number | null; signers_completed: number | null; reused_from: string | null; envelope_id: string | null; issue_error: string | null }
  const isMarker = (a: A) => !!a.envelope_id?.startsWith('failed:')
  const agreementOf = new Map<string, A>()
  for (const a of (agreements ?? []) as A[]) {
    const prev = agreementOf.get(a.participant_id)
    if (prev?.status === 'completed') continue
    if (prev && !isMarker(prev) && isMarker(a)) continue
    agreementOf.set(a.participant_id, a)
  }

  // Accounts: a login exists once clerk_user_id is set; "active" once they
  // have signed in. Clerk is the only record of a sign-in, so ask it once.
  const clerkIdByMember = new Map(((members ?? []) as Array<{ id: string; clerk_user_id: string | null }>).map((m) => [m.id, m.clerk_user_id]))
  const clerkIds = [...new Set([...clerkIdByMember.values()].filter((id): id is string => !!id))]
  const signedIn = new Set<string>()
  if (clerkIds.length) {
    try {
      const client = await clerkClient()
      for (let i = 0; i < clerkIds.length; i += 100) {
        const page = await client.users.getUserList({ userId: clerkIds.slice(i, i + 100), limit: 100 })
        for (const u of page.data) if (u.lastSignInAt) signedIn.add(u.id)
      }
    } catch (err) {
      // Unknown, not "never": show the account as created rather than guess.
      console.error('[group-status] Clerk lookup failed:', err)
    }
  }

  const spaceIds = [...new Set(((sources ?? []) as Array<{ space_id: string }>).map((s) => s.space_id))]
  const audiences = spaceIds.length ? await resolveSpaceAudiences(spaceIds) : new Map()
  const inSpace = new Set<string>()
  for (const entries of audiences.values()) for (const e of entries as Array<{ memberId: string }>) inSpace.add(e.memberId)

  return rows.map((r) => ({
    registrationId: r.id,
    name: r.school_name || 'Your group',
    paid: registrationPaid({ invoiceRequested: r.invoice_requested, invoicePaidAt: r.invoice_paid_at, status: r.status }),
    invoiceRequested: !!r.invoice_requested,
    amountDueCents: r.amount_due_cents,
    checkInCodeUrl: r.type === 'group' ? checkInCodeLink(eventSlug, 'g', r.id) : null,
    people: (r.participants ?? [])
      .map((p): GroupPersonStatus => {
        const env = agreementOf.get(p.id)
        const required = !!classifyAgreement(p.event_role, p.date_of_birth, r.school_address_state)
        const description = env ? describeEnvelope(env) : describeMissingEnvelope(required)
        const clerkId = p.member_id ? clerkIdByMember.get(p.member_id) ?? null : null
        return {
          participantId: p.id,
          name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Participant',
          isStudent: STUDENT_ROLES.has(p.event_role ?? ''),
          isOrganiser: p.member_id === memberId,
          agreementPill: description.pill,
          agreementLabel: description.label,
          account: !clerkId ? 'none' : signedIn.has(clerkId) ? 'active' : 'created',
          spaceAccess: spaceIds.length && p.member_id ? inSpace.has(p.member_id) : spaceIds.length ? false : null,
        }
      })
      // Organiser first, then adults, then students, each alphabetical.
      .sort((a, b) =>
        Number(b.isOrganiser) - Number(a.isOrganiser) ||
        Number(a.isStudent) - Number(b.isStudent) ||
        a.name.localeCompare(b.name)),
  }))
}
