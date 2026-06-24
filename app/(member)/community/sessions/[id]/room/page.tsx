import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getVideoProvider, getEmbedConfig } from '@/lib/video-provider'
import { VideoRoom } from '@/components/video/VideoRoom'
import { CohortLiveRoom } from '@/components/community/mentoring/CohortLiveRoom'

export const metadata = { title: 'Community · Session Room' }

// Embedded video room (FR-COM-11/12). Authorises the viewer (host or participant),
// mints a JaaS join token, and renders the call inside the portal.
export default async function SessionRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')
  const { id } = await params

  const db = supabaseServer()
  const { data: session } = await db
    .from('sessions')
    .select('id, title, host_member_id, cohort_id, provider, provider_room, status')
    .eq('id', id)
    .maybeSingle()
  if (!session || !session.provider_room) notFound()
  if (session.status === 'cancelled' || session.status === 'declined') notFound()

  const isHost = session.host_member_id === member.id
  if (!isHost) {
    const { data: p } = await db
      .from('session_participants')
      .select('member_id')
      .eq('session_id', id)
      .eq('member_id', member.id)
      .maybeSingle()
    if (!p) notFound()
  }

  const provider = getVideoProvider()
  const token = await provider.getJoinToken(
    session.provider_room,
    {
      id: member.id,
      name: [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member',
      email: member.email,
    },
    isHost
  )

  // Resolve embed coordinates from the shared seam (JaaS when configured, else
  // the open meet.jit.si dev fallback).
  const embed = getEmbedConfig(session.provider_room)

  const backHref = session.cohort_id
    ? `/community/mentoring/${session.cohort_id}`
    : '/community/coaching'
  const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'

  // Mentoring cohort sessions get the bespoke dark-stage live screen with host
  // controls + agenda + auto-record. (Coaching keeps the simple embed.)
  if (session.cohort_id) {
    const { data: acts } = await db
      .from('session_actions')
      .select('title')
      .eq('cohort_id', session.cohort_id)
      .order('display_order')
      .limit(6)
    const agenda = (acts ?? []).map((a) => (a as { title: string }).title)
    return (
      <CohortLiveRoom
        embed={{ scriptSrc: embed.scriptSrc, domain: embed.domain, roomName: embed.roomName }}
        jwt={token}
        displayName={displayName}
        title={session.title ?? 'Mentoring session'}
        isHost={isHost}
        backHref={backHref}
        agenda={agenda}
      />
    )
  }

  return (
    <div>
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
      <h1 className="mb-3 text-xl font-bold text-brand-blue-dark">{session.title ?? 'Session'}</h1>
      <VideoRoom
        scriptSrc={embed.scriptSrc}
        domain={embed.domain}
        roomName={embed.roomName}
        jwt={token}
        displayName={displayName}
      />
    </div>
  )
}
