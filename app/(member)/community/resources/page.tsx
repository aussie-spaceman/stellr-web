import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { listMemberResources } from '@/lib/resources-catalogue'
import { ResourcesCatalogue } from '@/components/community/resources/ResourcesCatalogue'

export const metadata = { title: 'Community · Resources' }

// Global Resources Catalogue (Resources_Refactor handover §4.1).
// A single list aggregated across the member's training courses, mentoring
// cohorts, coaching workshops, competitions and spaces — every resource|recording
// attached to a container they're on the roster of and can open. Access is
// resolved server-side (listMemberResources only returns openable rows); the
// client component handles grid/list, search, type filter and sort.
export default async function ResourcesPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const rows = await listMemberResources(member)

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Resources</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Files, links and recordings shared across everything you’re part of. Each one lives in the
          cohort, course, space or competition it came from.
        </p>
      </div>

      <ResourcesCatalogue rows={rows} />
    </div>
  )
}
