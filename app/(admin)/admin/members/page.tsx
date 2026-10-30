import { supabaseServer } from '@/lib/supabase'
import { MemberTable, type MemberRow } from '@/components/admin/MemberTable'
import { requireAdminPage } from '@/lib/admin-auth'
import {
  activeMemberFilterCount,
  applyMemberFilters,
  applyMemberSort,
  memberFilterEmbeds,
  memberFilterParams,
  parseMemberFilters,
} from '@/lib/admin-member-filters'

export const metadata = { title: 'Admin — Members' }

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdminPage()
  const params = await searchParams
  const filters = parseMemberFilters(params)
  const page = Math.max(1, parseInt(String(params.page ?? '1'), 10) || 1)
  const pageSize = 50

  const db = supabaseServer()

  const query = db
    .from('members')
    .select(`
      id, member_code, first_name, last_name, email, phone,
      age_bracket, event_role, grade, is_active, created_at,
      member_memberships(renewal_status, membership_tiers(name)),
      member_schools(is_current, schools(name))${memberFilterEmbeds(filters)}
    `, { count: 'exact' })
    .eq('is_active', true)
    .range((page - 1) * pageSize, page * pageSize - 1)

  const { data: members, count, error } = await applyMemberSort(applyMemberFilters(query, filters), filters)
  if (error) console.error('[admin/members] list query failed:', error.message)

  const [{ data: tiers }, { data: schoolRows }] = await Promise.all([
    db.from('membership_tiers').select('id, name').order('sort_order'),
    db.from('schools').select('name').order('name').limit(1000),
  ])
  const schools = [...new Set((schoolRows ?? []).map((s) => s.name as string).filter(Boolean))]
  const exportQuery = memberFilterParams(filters).toString()

  // A6 — at-a-glance summary (cheap head counts).
  const [{ count: totalMembers }, { count: schoolCount }, { count: activeMemberships }] = await Promise.all([
    db.from('members').select('id', { count: 'exact', head: true }).eq('is_active', true),
    db.from('schools').select('id', { count: 'exact', head: true }),
    db.from('member_memberships').select('id', { count: 'exact', head: true }).eq('renewal_status', 'active'),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2 text-brand-blue">
            <span className="h-2 w-2 rounded-full bg-brand-blue-bright" />{' '}Members &amp; membership
          </p>
          <h1 className="mt-1 font-heading text-ds-h2 text-brand-blue-dark">Members</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">{count ?? 0} matching</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href="/admin/members/new"
            className="inline-flex min-h-11 items-center bg-brand-blue text-white px-4 rounded-lg text-sm font-medium hover:bg-brand-blue-dark"
          >
            + Add member
          </a>
          <a
            href={`/api/admin/members/export${exportQuery ? `?${exportQuery}` : ''}`}
            className="inline-flex min-h-11 items-center bg-white border border-brand-border text-brand-muted px-4 rounded-lg text-sm font-medium hover:bg-brand-canvas"
          >
            {activeMemberFilterCount(filters) > 0 ? 'Export filtered CSV' : 'Export CSV'}
          </a>
        </div>
      </div>

      {/* At-a-glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active members" value={totalMembers ?? 0} accent="#2C53C6" />
        <StatCard label="Active memberships" value={activeMemberships ?? 0} accent="#E0A23A" />
        <StatCard label="Schools" value={schoolCount ?? 0} accent="#3C6DF6" />
      </div>

      <MemberTable
        members={(members ?? []) as unknown as MemberRow[]}
        tiers={tiers ?? []}
        schools={schools}
        total={count ?? 0}
        page={page}
        pageSize={pageSize}
        filters={filters}
      />
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="app-card relative overflow-hidden p-4">
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />
      <p className="font-display text-ds-h2 leading-none text-brand-blue-dark">{value.toLocaleString()}</p>
      <p className="mt-1 font-subheading text-xs font-medium text-brand-muted-soft">{label}</p>
    </div>
  )
}
