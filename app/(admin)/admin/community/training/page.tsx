import { supabaseServer } from '@/lib/supabase'
import { TrainingManager, type AdminModule } from '@/components/admin/community/TrainingManager'

export const metadata = { title: 'Admin — Community Training' }

// Admin training management (FR-COM-10).
// Create modules, upload/record video or document lessons, link Google Docs.
// Assign courses to events from the event's Training tab (/admin/events/[slug]?tab=training).
// Tier gating for each module is configured on the Access (entitlements) page.
export default async function AdminTrainingPage() {
  const db = supabaseServer()
  const { data: modules } = await db
    .from('training_modules')
    .select(
      'id, title, description, material_kind, course_type, start_date, event_ref, min_tier_rank, is_published, ' +
        'training_sections(id, title, display_order, drip_days), ' +
        'training_items(id, title, content_kind, status, section_id, display_order, estimated_minutes, body)'
    )
    .order('display_order', { ascending: true })

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-gold-ink">
          <span className="h-2 w-2 rounded-full bg-brand-orange" /> Academy
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Training</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Build training modules. To assign a course to a competition, open the event and use the
          Training tab. Fine-grained tier access is set on the{' '}
          <span className="font-medium">Access</span> tab.
        </p>
      </div>

      <TrainingManager modules={(modules ?? []) as unknown as AdminModule[]} />
    </div>
  )
}
