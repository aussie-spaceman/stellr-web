'use client'

import { useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, MicOff, PhoneOff, Users } from 'lucide-react'
import { VideoRoom, type JitsiApi } from '@/components/video/VideoRoom'

// Bespoke dark-stage live session (handoff "Live session" / "Host live session").
// Wraps the JaaS embed with Stellr chrome: top bar (Leave · title · RECORDING ·
// participants), the call stage, host-only controls (Mute all / End for all), and
// a right agenda panel. Mic/camera/share stay on Jitsi's own in-call toolbar.
export function CohortLiveRoom({
  embed,
  jwt,
  displayName,
  title,
  isHost,
  backHref,
  agenda,
}: {
  embed: { scriptSrc: string; domain: string; roomName: string }
  jwt: string
  displayName: string
  title: string
  isHost: boolean
  backHref: string
  agenda: string[]
}) {
  const router = useRouter()
  const apiRef = useRef<JitsiApi | null>(null)
  const [count, setCount] = useState(1)

  const onApi = useCallback((api: JitsiApi) => { apiRef.current = api }, [])
  const leave = () => {
    try { apiRef.current?.executeCommand('hangup') } catch { /* noop */ }
    router.push(backHref)
  }
  const muteAll = () => { try { apiRef.current?.executeCommand('muteEveryone', 'audio') } catch { /* noop */ } }
  const endForAll = () => {
    try { apiRef.current?.executeCommand('endConference') } catch {
      try { apiRef.current?.executeCommand('hangup') } catch { /* noop */ }
    }
    router.push(backHref)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0B0E22' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 text-white">
        <button onClick={leave} className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#1C2143] px-3 py-2 text-sm font-medium hover:bg-[#262C52]">
          <ChevronLeft className="h-4 w-4" /> Leave
        </button>
        <p className="truncate font-display text-[16px] font-bold">{title}</p>
        <div className="flex items-center gap-4 text-[13px]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#FF6B6B]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#FF6B6B]" /> RECORDING
          </span>
          <span className="inline-flex items-center gap-1.5 text-hero-lead">
            <Users className="h-4 w-4" /> {count}
          </span>
        </div>
      </div>

      {/* Stage + agenda */}
      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <div className="min-w-0 flex-1">
          <VideoRoom
            scriptSrc={embed.scriptSrc}
            domain={embed.domain}
            roomName={embed.roomName}
            jwt={jwt}
            displayName={displayName}
            isHost={isHost}
            autoRecord={isHost}
            onApi={onApi}
            onParticipantCount={setCount}
            className="h-full w-full overflow-hidden rounded-[14px] bg-black"
          />
        </div>

        {/* Right panel */}
        <aside className="hidden w-[260px] shrink-0 flex-col rounded-[14px] p-4 text-white lg:flex" style={{ background: '#13183A' }}>
          <p className="font-subheading text-[11px] font-semibold uppercase tracking-[0.13em] text-hero-dim">Session agenda</p>
          <ul className="mt-3 flex-1 space-y-2.5">
            {agenda.length === 0 ? (
              <li className="text-[13px] text-hero-dim">No agenda set.</li>
            ) : (
              agenda.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-[13.5px] text-hero-lead">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-space-violet" />
                  {a}
                </li>
              ))
            )}
          </ul>
          <p className="mt-3 rounded-[10px] bg-white/5 px-3 py-2 text-[12px] text-hero-dim">
            This recording auto-saves to Resources when the session ends.
          </p>
        </aside>
      </div>

      {/* Host controls */}
      {isHost && (
        <div className="flex items-center justify-center gap-3 pb-4">
          <button onClick={muteAll} className="inline-flex items-center gap-2 rounded-[9px] bg-[#1C2143] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#262C52]">
            <MicOff className="h-4 w-4" /> Mute all
          </button>
          <button onClick={endForAll} className="inline-flex items-center gap-2 rounded-[9px] bg-[#D9433C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#B83731]">
            <PhoneOff className="h-4 w-4" /> End for all
          </button>
        </div>
      )}
    </div>
  )
}
