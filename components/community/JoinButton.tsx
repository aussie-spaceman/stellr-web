'use client'

import Link from 'next/link'
import { Video } from 'lucide-react'

// Opens the embedded in-portal session room (FR-COM-11/12). The room page
// authorises the viewer and mints a moderator/guest token server-side.
export function JoinButton({ sessionId }: { sessionId: string }) {
  return (
    <Link
      href={`/community/sessions/${sessionId}/room`}
      className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark"
    >
      <Video className="h-3.5 w-3.5" />
      Join
    </Link>
  )
}
