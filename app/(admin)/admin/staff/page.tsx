import { supabaseServer } from '@/lib/supabase'
import { STAFF_SCOPES } from '@/lib/admin-auth'
import StaffRolesManager, { type StaffRole } from '@/components/admin/StaffRolesManager'

export const metadata = { title: 'Admin — Staff roles' }

// Function-scoped staff (platform RBAC seam, D10).
export default async function AdminStaffPage() {
  const db = supabaseServer()
  const { data } = await db
    .from('staff_roles')
    .select('member_id, scopes, members:member_id(first_name, last_name, email)')
    .order('created_at', { ascending: false })

  type Row = {
    member_id: string
    scopes: string[] | null
    members:
      | { first_name: string | null; last_name: string | null; email: string | null }
      | { first_name: string | null; last_name: string | null; email: string | null }[]
      | null
  }

  const roles: StaffRole[] = ((data ?? []) as Row[]).map((r) => {
    const m = Array.isArray(r.members) ? r.members[0] : r.members
    const name = m ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() : ''
    return {
      member_id: r.member_id,
      member_name: name || null,
      member_email: m?.email ?? null,
      scopes: r.scopes ?? [],
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Staff roles</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Grant members a scoped set of staff permissions — the seam for granular roles like a future
          Graduations coordinator.
        </p>
      </div>
      <StaffRolesManager initial={roles} allScopes={[...STAFF_SCOPES]} />
    </div>
  )
}
