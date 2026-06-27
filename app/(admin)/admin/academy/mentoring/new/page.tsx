import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { listModules } from '@/lib/training'
import { listMentoringTiers } from '@/lib/mentoring'
import { CreateCohortForm } from '@/components/community/mentoring/CreateCohortForm'
import { AdminMentoringNav } from '@/components/admin/mentoring/AdminMentoringNav'

export const metadata = { title: 'Admin · New cohort' }

export default async function AdminNewCohortPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const [modules, tiers] = await Promise.all([listModules(member), listMentoringTiers()])

  return (
    <div className="flex gap-8">
      <AdminMentoringNav />
      <div className="min-w-0 flex-1 max-w-[760px] space-y-5">
        <Link href="/admin/academy/mentoring" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Cohorts
        </Link>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Create a cohort</h1>
        <CreateCohortForm
          modules={modules.map((m) => ({ id: m.id, title: m.title }))}
          isAdmin
          tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
          searchEndpoint="/api/admin/members/search"
        />
      </div>
    </div>
  )
}
