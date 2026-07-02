import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

export interface CampaignMembership {
  schoolName: string | null
  roleLabel: string
}

export interface MemberCampaignContext {
  memberId: string | null
  /** Slugs of campaigns this member is registered for. */
  registeredSlugs: Set<string>
  /** Recognised-membership details for the registration modal banner. */
  membership: CampaignMembership | null
}

// Resolves the signed-in member's campaign context: which campaigns they've
// registered for, plus their current school + role for the "recognised
// membership" banner. Returns empties for signed-out visitors.
export async function getMemberCampaignContext(): Promise<MemberCampaignContext> {
  const member = await getCurrentMember()
  if (!member) return { memberId: null, registeredSlugs: new Set(), membership: null }

  const db = supabaseServer()
  const [{ data: regs }, { data: school }] = await Promise.all([
    db.from('registrations').select('event_slug').eq('type', 'campaign').eq('teacher_member_id', member.id),
    db
      .from('member_schools')
      .select('schools(name)')
      .eq('member_id', member.id)
      .eq('is_current', true)
      .maybeSingle(),
  ])

  const schoolName =
    (school as { schools?: { name?: string } | null } | null)?.schools?.name ?? null

  return {
    memberId: member.id,
    registeredSlugs: new Set((regs ?? []).map((r) => r.event_slug as string)),
    membership: { schoolName, roleLabel: member.activeTierName ?? 'Educator' },
  }
}

// A single registration row for a member's campaign, or null. Includes proposal
// fields so the workspace/submit pages can show submission state.
export interface CampaignRegistrationRow {
  id: string
  event_slug: string
  event_title: string
  group_name: string | null
  contact_role: string | null
  student_count: number | null
  proposal_file_name: string | null
  proposal_storage_path: string | null
  proposal_notes: string | null
  proposal_submitted_at: string | null
}

export async function getMemberCampaignRegistration(
  memberId: string,
  campaignSlug: string,
): Promise<CampaignRegistrationRow | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('registrations')
    .select(
      'id, event_slug, event_title, group_name, contact_role, student_count, proposal_file_name, proposal_storage_path, proposal_notes, proposal_submitted_at',
    )
    .eq('type', 'campaign')
    .eq('event_slug', campaignSlug)
    .eq('teacher_member_id', memberId)
    .maybeSingle()
  return (data as CampaignRegistrationRow | null) ?? null
}

export async function listMemberCampaignRegistrations(
  memberId: string,
): Promise<CampaignRegistrationRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('registrations')
    .select(
      'id, event_slug, event_title, group_name, contact_role, student_count, proposal_file_name, proposal_storage_path, proposal_notes, proposal_submitted_at',
    )
    .eq('type', 'campaign')
    .eq('teacher_member_id', memberId)
    .order('created_at', { ascending: false })
  return (data as CampaignRegistrationRow[] | null) ?? []
}
