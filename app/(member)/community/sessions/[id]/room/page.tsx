import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { getVideoProvider } from '@/lib/video-provider'
import { SessionRoom } from '@/components/community/SessionRoom'

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
    .select('id, title, host_member_id, provider, provider_room, status')
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

  // Resolve embed coordinates for the active provider.
  const appId = process.env.JAAS_APP_ID
  const jaasConfigured = session.provider === 'jaas' && !!appId
  const domain = jaasConfigured ? '8x8.vc' : 'meet.jit.si'
  const roomName = jaasConfigured ? `${appId}/${session.provider_room}` : session.provider_room
  const scriptSrc = jaasConfigured
    ? `https://8x8.vc/${appId}/external_api.js`
    : 'https://meet.jit.si/external_api.js'

  return (
    <div>
      <Link
        href="/community/coaching"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>
      <h1 className="mb-3 text-xl font-bold text-gray-900">{session.title ?? 'Session'}</h1>
      <SessionRoom
        scriptSrc={scriptSrc}
        domain={domain}
        roomName={roomName}
        jwt={token}
        displayName={[member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'}
      />
    </div>
  )
}
