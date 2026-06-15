import { supabaseServer } from '@/lib/supabase'
import {
  EntitlementMatrix,
  type Tier,
  type Target,
  type Entitlement,
} from '@/components/admin/community/EntitlementMatrix'

export const metadata = { title: 'Admin — Community Access' }

// Admin access matrix (FR-COM-08 + entitlement engine).
// Surfaces every gateable target — spaces, training modules, resources, and the
// category-wide Mentoring/Coaching grants — and lets an admin drag membership
// tiers onto them. The mapping is the entitlement source of truth and is fully
// editable here without code changes, per the PRD's "flexible to introduce and
// modify in future" requirement.
export default async function AdminEntitlementsPage() {
  const db = supabaseServer()

  const [{ data: tiers }, { data: spaces }, { data: modules }, { data: resources }, { data: ents }] =
    await Promise.all([
      db.from('membership_tiers').select('id, name, is_free, age_bracket').order('sort_order'),
      db.from('community_spaces').select('id, name').eq('is_archived', false).order('display_order'),
      db.from('training_modules').select('id, title, material_kind').order('display_order'),
      db
        .from('community_resources')
        .select('id, title')
        .is('event_ref', null) // event-attached resources are gated via the event itself
        .order('created_at', { ascending: false })
        .limit(100),
      db
        .from('content_entitlements')
        .select('id, tier_id, content_tier, target_type, target_ref, access_level'),
    ])

  const targets: Target[] = [
    // Category-wide grants for the upcoming Mentoring/Coaching components.
    { type: 'mentoring', ref: '*', label: 'Mentoring — access (all)', group: 'Programs' },
    { type: 'coaching', ref: '*', label: 'Coaching — access (all)', group: 'Programs' },
    // Campaign delivery content, gated by the per-campaign content tier (drag a
    // content-tier chip here). Scoped to each member's enrolled campaign at run time.
    { type: 'campaign_material', ref: '*', label: 'Campaign materials — by content tier', group: 'Campaign content' },
    ...(spaces ?? []).map((s) => ({
      type: 'space' as const,
      ref: s.id,
      label: s.name,
      group: 'Spaces',
    })),
    ...(modules ?? []).map((m) => ({
      type: 'training_module' as const,
      ref: m.id,
      label: `${m.title}  ·  ${m.material_kind}`,
      group: 'Training modules',
    })),
    ...(resources ?? []).map((r) => ({
      type: 'resource' as const,
      ref: r.id,
      label: r.title,
      group: 'Resources',
    })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Access map</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Drag a membership tier onto any content row to grant access. This is the entitlement
          source of truth — edit it any time as your tier model evolves.
        </p>
      </div>

      <EntitlementMatrix
        tiers={(tiers ?? []) as Tier[]}
        targets={targets}
        initial={(ents ?? []) as Entitlement[]}
      />
    </div>
  )
}
