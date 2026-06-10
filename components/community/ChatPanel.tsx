'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Send } from 'lucide-react'

interface Message {
  id: string
  body: string
  author_member_id: string | null
  created_at: string
}

// Persistent chat panel for a cohort or coaching channel (FR-COM-11/12).
// Polls every 8s (the community tables are service-role-only, so no Realtime —
// same constraint as NotificationBell). Messages persist independently of any
// session, so the history survives between meetings.
export function ChatPanel({
  channelId,
  selfMemberId,
  title,
}: {
  channelId: string
  selfMemberId: string
  title: string
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/community/chat?channelId=${channelId}`)
    if (res.ok) {
      const json = await res.json()
      setMessages(json.messages ?? [])
    }
  }, [channelId])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = async () => {
    if (!draft.trim()) return
    setSending(true)
    try {
      const res = await fetch('/api/community/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, body: draft }),
      })
      if (res.ok) {
        setDraft('')
        await load()
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-80 flex-col rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">
        {title}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400">No messages yet — say hello.</p>
        )}
        {messages.map((m) => {
          const mine = m.author_member_id === selfMemberId
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${
                  mine ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {m.body}
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      <div className="flex items-center gap-2 border-t border-gray-100 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Message…"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={send}
          disabled={sending}
          className="rounded-md bg-gray-900 p-2 text-white hover:bg-gray-800 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
