import { supabaseServer } from '@/lib/supabase'
import { SpacesManager, type SpaceRow } from '@/components/admin/community/SpacesManager'

export const metadata = { title: 'Admin — Spaces' }
export const dynamic = 'force-dynamic'

// Dedicated Spaces admin (convergence P3). Central list of all community Spaces.
export default async function AdminSpacesPage() {
  const db = supabaseServer()
  const { data } = await db
    .from('community_spaces')
    .select('id, slug, name, description, min_tier_rank, display_order, is_archived')
    .order('display_order', { ascending: true })

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Spaces</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">
        Community spaces — the places members chat, share resources and follow a calendar. Set who
        can see each one; finer tier rules live in the Access map.
      </p>
      <SpacesManager initial={(data ?? []) as SpaceRow[]} />
    </div>
  )
}
