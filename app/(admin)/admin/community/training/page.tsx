import { supabaseServer } from '@/lib/supabase'
import { TrainingManager, type AdminModule } from '@/components/admin/community/TrainingManager'

export const metadata = { title: 'Admin — Community Training' }

// Admin training management (FR-COM-10).
// Create modules, upload/record video or document lessons, link Google Docs, and
// assign modules to event participants by role. Tier gating for each module is
// configured on the Access (entitlements) page.
export default async function AdminTrainingPage() {
  const db = supabaseServer()
  const { data: modules } = await db
    .from('training_modules')
    .select('id, title, description, material_kind, event_ref, min_tier_rank, is_published, training_items(id)')
    .order('display_order', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Training</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Build training modules and assign them to event participants. Fine-grained tier access is
          set on the <span className="font-medium">Access</span> tab.
        </p>
      </div>

      <TrainingManager modules={(modules ?? []) as AdminModule[]} />
    </div>
  )
}
