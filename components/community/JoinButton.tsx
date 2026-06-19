'use client'

import Link from 'next/link'
import { Video } from 'lucide-react'

// Opens the embedded in-portal session room (FR-COM-11/12). The room page
// authorises the viewer and mints a moderator/guest token server-side.
//
// isHost: true = mentor/coach; they can start any time.
// scheduledStart: ISO string; non-hosts cannot join until 5 min before start.
export function JoinButton({
  sessionId,
  scheduledStart,
  isHost = false,
}: {
  sessionId: string
  scheduledStart?: string
  isHost?: boolean
}) {
  const now = Date.now()
  const startMs = scheduledStart ? new Date(scheduledStart).getTime() : now
  const fiveMinBefore = startMs - 5 * 60 * 1000
  const canJoin = isHost || now >= fiveMinBefore

  if (!canJoin) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-hairline px-3 py-1.5 text-xs font-medium text-brand-muted-soft cursor-not-allowed">
        <Video className="h-3.5 w-3.5" />
        Join (opens soon)
      </span>
    )
  }

  return (
    <Link
      href={`/community/sessions/${sessionId}/room`}
      className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark"
    >
      <Video className="h-3.5 w-3.5" />
      {isHost ? 'Start' : 'Join'}
    </Link>
  )
}
