import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'

// Space root: resolve access, then route to the first channel. Private spaces the
// member can't enter render the locked screen; secret-inaccessible → not found.
export default async function SpaceRootPage({
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

  const first = space.channels[0]
  if (first) redirect(`/community/${spaceSlug}/c/${first.slug}`)
  // No channels yet — send to the Members section as a sensible landing.
  redirect(`/community/${spaceSlug}/members`)
}
