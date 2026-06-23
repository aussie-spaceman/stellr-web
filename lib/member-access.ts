import { supabaseServer } from '@/lib/supabase'

// "All access in one place" (convergence P3). Aggregates the roster-based access a
// member holds — the competitions, mentoring cohorts and coaching workshops they're
// on — so an admin can see, from the member page, exactly what they can get into.
// (Membership tiers + event activity are shown elsewhere on the member page; this
// panel surfaces the container/roster access that was previously invisible.)

export interface MemberAccessSummary {
  competitions: { slug: string; label: string }[]
  mentoring: { label: string; relationship: string; archived: boolean }[]
  coaching: { label: string; relationship: string }[]
}

export async function getMemberAccessSummary(memberId: string): Promise<MemberAccessSummary> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select('relationship, mentoring_cohorts!inner(name, container_type, campaign_ref, lifecycle)')
    .eq('member_id', memberId)
    .eq('status', 'active')

  type Cont = { name: string; container_type: string; campaign_ref: string | null; lifecycle: string }
  const rows = (data ?? []).map((r) => {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as Cont
    return { relationship: (r.relationship as string) ?? 'participant', c }
  })

  // Competitions: distinct campaign_ref (a member can be on both the event-level
  // container and a group sub-container — collapse to one entry per event).
  const compMap = new Map<string, string>()
  for (const { c } of rows) {
    if (c.container_type === 'event_participation' && c.campaign_ref && !compMap.has(c.campaign_ref)) {
      compMap.set(c.campaign_ref, c.name.split(' — ')[0])
    }
  }
  const competitions = [...compMap.entries()].map(([slug, label]) => ({ slug, label }))

  const mentoring = rows
    .filter(({ c }) => c.container_type === 'mentoring')
    .map(({ c, relationship }) => ({ label: c.name, relationship, archived: c.lifecycle === 'archived' }))

  const coaching = rows
    .filter(({ c }) => c.container_type === 'coaching')
    .map(({ c, relationship }) => ({ label: c.name, relationship }))

  return { competitions, mentoring, coaching }
}
