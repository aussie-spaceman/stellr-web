'use client'

import { useEffect, useRef } from 'react'

// Embeds the video call inside the portal (FR-COM-11/12) using the Jitsi/JaaS
// external API, rather than opening a separate tab. Loads the provider script,
// mounts the meeting in a container, and passes the JaaS JWT (moderator vs guest
// rights are baked into the token server-side).
//
// JitsiMeetExternalAPI is injected by the external script and has no types here.

interface JitsiApiCtor {
  new (domain: string, options: Record<string, unknown>): { dispose: () => void }
}
declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiCtor
  }
}

export function SessionRoom({
  scriptSrc,
  domain,
  roomName,
  jwt,
  displayName,
}: {
  scriptSrc: string
  domain: string
  roomName: string
  jwt: string
  displayName: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let api: { dispose: () => void } | null = null
    let cancelled = false

    const start = () => {
      if (cancelled || !containerRef.current || !window.JitsiMeetExternalAPI) return
      api = new window.JitsiMeetExternalAPI(domain, {
        roomName,
        ...(jwt ? { jwt } : {}),
        parentNode: containerRef.current,
        width: '100%',
        height: '100%',
        userInfo: { displayName },
        configOverwrite: { prejoinPageEnabled: true },
      })
    }

    // Load the provider script once, then mount.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptSrc}"]`)
    if (window.JitsiMeetExternalAPI) {
      start()
    } else if (existing) {
      existing.addEventListener('load', start, { once: true })
    } else {
      const s = document.createElement('script')
      s.src = scriptSrc
      s.async = true
      s.onload = start
      document.body.appendChild(s)
    }

    return () => {
      cancelled = true
      api?.dispose()
    }
  }, [scriptSrc, domain, roomName, jwt, displayName])

  return <div ref={containerRef} className="h-[70vh] w-full overflow-hidden rounded-lg bg-black" />
}
