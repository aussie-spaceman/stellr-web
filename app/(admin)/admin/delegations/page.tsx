import { supabaseServer } from '@/lib/supabase'
import DelegationsManager, { type Delegation } from '@/components/admin/DelegationsManager'
import type { ObjectType } from '@/lib/object-roles'

export const metadata = { title: 'Admin — Delegations' }

// Central view of the "manage" axis (access-model Phase 3): every object_roles
// grant across events, groups and containers, with grant/revoke.
export default async function AdminDelegationsPage() {
  const db = supabaseServer()
  const { data } = await db
    .from('object_roles')
    .select('id, object_type, object_id, role, members:member_id(first_name, last_name, email)')
    .order('created_at', { ascending: false })

  type Row = {
    id: string
    object_type: ObjectType
    object_id: string
    role: string
    members: { first_name: string | null; last_name: string | null; email: string | null }
      | { first_name: string | null; last_name: string | null; email: string | null }[]
      | null
  }

  const delegations: Delegation[] = ((data ?? []) as Row[]).map((r) => {
    const m = Array.isArray(r.members) ? r.members[0] : r.members
    const name = m ? `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() : ''
    return {
      id: r.id,
      object_type: r.object_type,
      object_id: r.object_id,
      role: r.role,
      member_name: name || null,
      member_email: m?.email ?? null,
    }
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delegations</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Who manages what — object-scoped manager grants over events, groups and containers.
        </p>
      </div>
      <DelegationsManager initial={delegations} />
    </div>
  )
}
