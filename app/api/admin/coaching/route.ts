import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { ensureCoachingContainer } from '@/lib/container-sync'
import { getCoachingChannel } from '@/lib/sessions'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

// Admin direct-grant for coaching (convergence P3). Create a coaching workshop —
// a coach + coachee pairing — as a container + roster, and provision its chat so
// access works immediately. Mirrors what booking a session now does, but admin-led
// ("assign a coach to a member") per the requirements doc.

// GET — existing coaching workshops (coach + coachee), for the admin list.
export async function GET() {
  if (!(await isStellrAdmin({ route: '/api/admin/coaching' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(
      'id, name, coach:members!mentoring_cohorts_mentor_member_id_fkey(first_name, last_name), cohort_members(members(first_name, last_name))',
    )
    .eq('container_type', 'coaching')
    .eq('lifecycle', 'active')
    .order('created_at', { ascending: false })

  const fullName = (m: { first_name?: string | null; last_name?: string | null } | null) =>
    [m?.first_name, m?.last_name].filter(Boolean).join(' ') || null

  const workshops = (data ?? []).map((w) => {
    const coach = Array.isArray(w.coach) ? w.coach[0] : w.coach
    const roster = (w.cohort_members ?? []) as { members: { first_name?: string; last_name?: string } | { first_name?: string; last_name?: string }[] | null }[]
    const coachees = roster
      .map((cm) => fullName(Array.isArray(cm.members) ? cm.members[0] : cm.members))
      .filter(Boolean)
    return { id: w.id as string, coach: fullName(coach), coachees }
  })
  return NextResponse.json({ workshops })
}

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'coaching.workshop.ensure',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'mentoring_cohorts', id: auditedId.get(req) ?? null },
  }),
  ensureCoachingWorkshop,
)

// POST { coachId, coacheeId } — create / ensure a coaching workshop for the pair.
async function ensureCoachingWorkshop(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/coaching' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { coachId, coacheeId } = await req.json().catch(() => ({}))
  if (!coachId || !coacheeId) {
    return NextResponse.json({ error: 'coachId and coacheeId required' }, { status: 400 })
  }
  if (coachId === coacheeId) {
    return NextResponse.json({ error: 'Coach and coachee must be different members' }, { status: 400 })
  }

  const db = supabaseServer()
  const containerId = await ensureCoachingContainer(db, coacheeId, coachId)
  if (!containerId) return NextResponse.json({ error: 'Could not create workshop' }, { status: 500 })
  auditedId.set(req, containerId)

  // Provision the pair's chat channel so the coachee has access immediately.
  await getCoachingChannel(coacheeId, coachId).catch(() => null)

  return NextResponse.json({ ok: true })
}
