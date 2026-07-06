import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember, canPostInSpace } from '@/lib/spaces'
import { getChannelPosts } from '@/lib/space-posts'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { ChannelFeed } from '@/components/community/spaces/ChannelFeed'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'

export default async function ChannelPage({
  params,
}: {
  params: Promise<{ spaceSlug: string; channelSlug: string }>
}) {
  const { spaceSlug, channelSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space) notFound()
  if (!space.access.canAccess) return <LockedSpaceGate space={space} />

  const channel = space.channels.find((c) => c.slug === channelSlug)
  if (!channel) notFound()

  const posts = await getChannelPosts(channel.id, space.id, member.id)
  const selfName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'You'

  return (
    <SpaceShell space={space} activeKey={channelSlug}>
      <ChannelFeed
        spaceSlug={space.slug}
        channelId={channel.id}
        channelSlug={channel.slug}
        channelName={channel.name}
        selfId={member.id}
        canPost={canPostInSpace(member, space.postingPolicy, space.myRole, space.myMuted)}
        canModerate={member.isAdmin || space.myRole === 'admin' || space.myRole === 'moderator'}
        allowUploads={space.allowMemberUploads || member.isAdmin}
        initialPosts={posts}
      />
    </SpaceShell>
  )
}

export const dynamic = 'force-dynamic'
