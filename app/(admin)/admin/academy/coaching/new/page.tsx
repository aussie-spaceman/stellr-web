import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { listModules } from '@/lib/training'
import { supabaseServer } from '@/lib/supabase'
import { ALL_TIER_NAMES } from '@/lib/tiers'
import { AdminCoachingNav } from '@/components/admin/coaching/AdminCoachingNav'
import { CreateWorkshopForm } from '@/components/admin/coaching/CreateWorkshopForm'

export const metadata = { title: 'Admin · New coaching workshop' }

export default async function NewWorkshopPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  if (!member.isAdmin) redirect('/community/coaching')

  const db = supabaseServer()
  const [modules, { data: tierRows }] = await Promise.all([
    listModules(member),
    db.from('membership_tiers').select('id, name').in('name', ALL_TIER_NAMES).order('sort_order'),
  ])
  const tiers = ((tierRows ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="flex gap-8">
      <AdminCoachingNav />
      <div className="min-w-0 flex-1 space-y-5">
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">New coaching workshop</h1>
        <CreateWorkshopForm modules={modules.map((m) => ({ id: m.id, title: m.title }))} tiers={tiers} />
      </div>
    </div>
  )
}
