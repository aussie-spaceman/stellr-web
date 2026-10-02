'use client'

import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'

// The group's join link, handed from the registration form to the
// confirmation page through this tab's session storage. It used to travel in
// the confirmation page's address (?join=…), where analytics recorded it: the
// link is the key that lets anyone add themselves to the group.

export const joinLinkStorageKey = (registrationId: string) => `stellr:join-link:${registrationId}`

export function JoinLinkButton({ registrationId }: { registrationId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    try {
      setUrl(window.sessionStorage.getItem(joinLinkStorageKey(registrationId)))
    } catch {
      // Storage unavailable: the link is in the confirmation email too.
    }
  }, [registrationId])
  if (!url) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center justify-center gap-2 text-sm">
      Individual completion link <ExternalLink size={14} />
    </a>
  )
}
