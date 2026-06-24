'use client'

import { useEffect, useRef } from 'react'

// Embeds a Jitsi/JaaS call inside the portal rather than opening a separate tab.
// Loads the provider script once, mounts the meeting in a container, and passes
// the JaaS JWT (moderator vs guest rights are baked into the token server-side).
// Shared by Coaching/Mentoring session rooms (FR-COM-11/12) and live training
// lessons (FR-COM-10) — the embed coordinates come from getEmbedConfig().
//
// JitsiMeetExternalAPI is injected by the external script and has no types here.

// Minimal surface of the Jitsi external API we use (host controls, events, count).
export interface JitsiApi {
  dispose: () => void
  executeCommand: (command: string, ...args: unknown[]) => void
  addListener: (event: string, handler: (...args: unknown[]) => void) => void
  getNumberOfParticipants?: () => number
}
interface JitsiApiCtor {
  new (domain: string, options: Record<string, unknown>): JitsiApi
}
declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiApiCtor
  }
}

export function VideoRoom({
  scriptSrc,
  domain,
  roomName,
  jwt,
  displayName,
  className = 'h-[70vh] w-full overflow-hidden rounded-lg bg-black',
  isHost = false,
  autoRecord = false,
  onApi,
  onParticipantCount,
}: {
  scriptSrc: string
  domain: string
  roomName: string
  jwt: string
  displayName: string
  className?: string
  /** Host gets moderator UX (auto-record kick-off, host commands). */
  isHost?: boolean
  /** Start file recording automatically once the host joins (auto-save → Resources). */
  autoRecord?: boolean
  /** Receive the API instance for host commands (muteEveryone / endConference). */
  onApi?: (api: JitsiApi) => void
  /** Live participant count for the embedding chrome. */
  onParticipantCount?: (n: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let api: JitsiApi | null = null
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

      const reportCount = () => {
        try { onParticipantCount?.(api?.getNumberOfParticipants?.() ?? 0) } catch { /* noop */ }
      }
      api.addListener('participantJoined', reportCount)
      api.addListener('participantLeft', reportCount)
      api.addListener('videoConferenceJoined', () => {
        reportCount()
        // Auto-record: the host's join kicks off file recording so the session is
        // captured without manual action; the webhook saves it to Resources.
        if (isHost && autoRecord) {
          try { api?.executeCommand('startRecording', { mode: 'file' }) } catch { /* JaaS may reject if unconfigured */ }
        }
      })
      onApi?.(api)
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
  }, [scriptSrc, domain, roomName, jwt, displayName, isHost, autoRecord, onApi, onParticipantCount])

  return <div ref={containerRef} className={className} />
}
