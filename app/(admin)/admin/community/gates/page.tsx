import { supabaseServer } from '@/lib/supabase'
import GatesManager, { type ModuleRef, type Prereq } from '@/components/admin/community/GatesManager'

export const metadata = { title: 'Admin — Gates' }

// Configure access gates (Phase 5): training prerequisites + persistence policy.
export default async function AdminGatesPage() {
  const db = supabaseServer()
  const [{ data: modules }, { data: prereqs }, { data: persistence }] = await Promise.all([
    db.from('training_modules').select('id, title').order('display_order'),
    db
      .from('content_prerequisites')
      .select('id, target_ref, requires_target_ref')
      .eq('target_type', 'training_module'),
    db
      .from('content_persistence')
      .select('target_ref, policy')
      .eq('target_type', 'training_module'),
  ])

  const persistenceMap: Record<string, string> = {}
  for (const p of (persistence ?? []) as { target_ref: string; policy: string }[]) {
    persistenceMap[p.target_ref] = p.policy
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Access gates</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Require a member to complete one module before another, and choose what stays open after a
          container archives. These layer on top of tier/entitlement access.
        </p>
      </div>
      <GatesManager
        modules={(modules ?? []) as ModuleRef[]}
        prereqs={(prereqs ?? []) as Prereq[]}
        persistence={persistenceMap}
      />
    </div>
  )
}
