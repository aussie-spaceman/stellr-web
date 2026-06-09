import { supabaseServer } from '@/lib/supabase'
import { ActivityLogReview } from '@/components/admin/ActivityLogReview'

export const metadata = { title: 'Admin — Activity Log Review' }

export default async function ActivityLogPage() {
  const db = supabaseServer()

  const { data } = await db
    .from('event_participations')
    .select(`
      id, event_year, event_location, team_name, award, status, created_at,
      members(id, first_name, last_name, email)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  return <ActivityLogReview initialItems={data ?? []} />
}
