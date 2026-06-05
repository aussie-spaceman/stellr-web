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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Members</h1>
          <p className="text-sm text-gray-500 mt-0.5">{count ?? 0} total</p>
        </div>
        <div className="flex gap-2">
          <a
            href="/admin/members/new"
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
          >
            + Add member
          </a>
          <a
            href="/api/admin/members/export"
            className="bg-white border border-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50"
          >
            Export CSV
          </a>
        </div>
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
