import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { listModules } from '@/lib/training'
import { CreateCohortForm } from '@/components/community/mentoring/CreateCohortForm'

export const metadata = { title: 'Mentoring · New cohort' }

export default async function NewCohortPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canMentor) redirect('/community/mentoring')

  const modules = await listModules(member)

  return (
    <div className="mx-auto max-w-[760px] space-y-5">
      <Link href="/community/mentoring/manage" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-muted hover:text-primary">
        <ArrowLeft className="h-4 w-4" /> Your cohorts
      </Link>
      <div>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-space-violet">Mentor workspace</p>
        <h1 className="mt-1 font-display text-[30px] font-bold tracking-[-0.02em] text-ink">Create a cohort</h1>
      </div>
      <CreateCohortForm modules={modules.map((m) => ({ id: m.id, title: m.title }))} isAdmin={member.isAdmin} />
    </div>
  )
}
