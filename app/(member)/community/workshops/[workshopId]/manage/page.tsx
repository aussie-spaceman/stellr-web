import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getWorkshopFull } from '@/lib/workshops'
import { listCohortFileResources } from '@/lib/mentoring'
import { AddResourceForm } from '@/components/community/resources/AddResourceForm'
import { AttachedResourceList } from '@/components/community/resources/AttachedResourceList'

export const metadata = { title: 'Coach workspace · Manage workshop' }

// Coach "Add a resource" surface (handover §4.5 — the /coach/manage equivalent of
// /mentoring/manage, scoped to one managed workshop). Gated on coaching the
// workshop (mentor_member_id) or platform admin.
export default async function ManageWorkshopPage({ params }: { params: Promise<{ workshopId: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { workshopId } = await params
  const workshop = await getWorkshopFull(workshopId)
  if (!workshop) notFound()

  const allowed = member.isAdmin || workshop.mentorMemberId === member.id
  if (!allowed) redirect(`/community/workshops/${workshopId}`)

  const fileResources = await listCohortFileResources(workshopId)

  return (
    <div className="mx-auto max-w-content space-y-5">
      <Link
        href="/community/coach/manage"
        className="inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Your workshops
      </Link>

      <header>
        <p className="font-subheading text-[13px] font-semibold uppercase tracking-[0.13em] text-pathway-amber">
          Coach workspace
        </p>
        <h1 className="mt-1 font-display text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
          {workshop.name}
        </h1>
      </header>

      <AddResourceForm containerId={workshop.id} objectName={workshop.name} />

      <div className="rounded-card border border-line bg-white p-5">
        <h2 className="mb-3 font-display text-[16px] font-bold text-ink">Attached resources</h2>
        <AttachedResourceList
          containerId={workshop.id}
          items={fileResources.map((r) => ({
            resourceId: r.resourceId,
            title: r.title,
            fileType: r.fileType,
            minMembership: r.minMembership,
          }))}
        />
      </div>
    </div>
  )
}
