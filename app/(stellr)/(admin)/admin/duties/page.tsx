import { supabaseServer } from '@/lib/supabase'
import { DUTY_SCOPES, requireAdminPage } from '@/lib/admin-auth'
import DutiesManager, { type DutyRow } from '@/components/admin/DutiesManager'

export const metadata = { title: 'Admin — Duties' }

// Duties: who gets which admin alerts and digests (was Staff roles until 13 Nov 2026).
export default async function AdminDutiesPage() {
  await requireAdminPage()
  const db = supabaseServer()
  const { data } = await db
    .from('admin_duties')
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

  const roles: DutyRow[] = ((data ?? []) as Row[]).map((r) => {
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
        <h1 className="font-heading text-ds-h2 text-brand-blue-dark">Duties</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Give a member a duty: the alerts and digests for an area of Stellr’s work, such as community
          alerts or the Friday digest. A duty routes notices. It does not open the admin portal.
        </p>
      </div>
      <DutiesManager initial={roles} allScopes={[...DUTY_SCOPES]} />
    </div>
  )
}
