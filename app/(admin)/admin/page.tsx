import { supabaseServer } from '@/lib/supabase'
import { MemberTable, type MemberRow } from '@/components/admin/MemberTable'

export const metadata = { title: 'Admin — Members' }

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; bracket?: string; role?: string; tier?: string; page?: string }>
}) {
  const params = await searchParams
  const q = params.q ?? ''
  const bracket = params.bracket ?? ''
  const role = params.role ?? ''
  const tier = params.tier ?? ''
  const page = Math.max(1, parseInt(params.page ?? '1', 10))
  const pageSize = 50

  const db = supabaseServer()

  let query = db
    .from('members')
    .select(`
      id, member_code, first_name, last_name, email, phone,
      age_bracket, event_role, grade, is_active, created_at,
      member_memberships(renewal_status, membership_tiers(name)),
      member_schools(is_current, schools(name))
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (q) {
    query = query.or(
      `first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`
    )
  }
  if (bracket) query = query.eq('age_bracket', bracket)
  if (role) query = query.eq('event_role', role)

  const { data: members, count } = await query

  const { data: tiers } = await db
    .from('membership_tiers')
    .select('id, name')
    .order('sort_order')

  // A6 — at-a-glance summary (cheap head counts).
  const [{ count: totalMembers }, { count: schoolCount }, { count: activeMemberships }] = await Promise.all([
    db.from('members').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('schools').select('id', { count: 'exact', head: true }),
    db.from('member_memberships').select('id', { count: 'exact', head: true }).eq('renewal_status', 'active'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow flex items-center gap-2 text-brand-blue">
            <span className="h-2 w-2 rounded-full bg-brand-blue-bright" /> Members &amp; membership
          </p>
          <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Members</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">{count ?? 0} matching</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/admin/members/new"
            className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-blue-dark"
          >
            + Add member
          </a>
          <a
            href="/api/admin/members/export"
            className="bg-white border border-brand-border text-brand-muted px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-canvas"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* At-a-glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active members" value={totalMembers ?? 0} accent="#1d5fd6" />
        <StatCard label="Active memberships" value={activeMemberships ?? 0} accent="#dda33b" />
        <StatCard label="Schools" value={schoolCount ?? 0} accent="#0d439d" />
      </div>

      <MemberTable
        members={(members ?? []) as unknown as MemberRow[]}
        tiers={tiers ?? []}
        total={count ?? 0}
        page={page}
        pageSize={pageSize}
        filters={{ q, bracket, role, tier }}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="app-card relative overflow-hidden p-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <p className="font-display text-display leading-none text-brand-blue-dark">{value.toLocaleString()}</p>
      <p className="mt-1 font-subheading text-xs font-medium text-brand-muted-soft">{label}</p>
    </div>
  )
}
