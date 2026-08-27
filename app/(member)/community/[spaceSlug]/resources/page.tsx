import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { listSpaceResources } from '@/lib/space-resources'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'
import { ResourcesList, type ResourceItem } from '@/components/community/spaces/ResourcesList'

export const dynamic = 'force-dynamic'

export default async function SpaceResourcesPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>
}) {
  const { spaceSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space) notFound()
  if (!space.access.canAccess) return <LockedSpaceGate space={space} />

  // Access is the space's (decision 6b — no per-resource ACL). The page already
  // gated on space.access.canAccess above, so every space file is shown — both
  // files uploaded into the space and files linked in from the global catalogue.
  const items: ResourceItem[] = await listSpaceResources(space.id, space.slug)

  return (
    <SpaceShell space={space} activeKey="resources">
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-4 font-heading text-[21px] text-brand-blue-dark">Resources</h1>
        <ResourcesList items={items} />
      </div>
    </SpaceShell>
  )
}
