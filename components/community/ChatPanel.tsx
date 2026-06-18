'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, Flag, Trash2 } from 'lucide-react'
import { useAuth } from '@clerk/nextjs'
import { createBrowserSupabase } from '@/lib/supabase-browser'

interface Message {
  id: string
  body: string
  author_member_id: string | null
  created_at: string
  flagged: boolean
}

// Persistent chat panel for a cohort, coaching pair, or space (FR-COM-11/12).
// Polls every 8s and upgrades to Realtime push when Clerk↔Supabase third-party
// auth is configured. Members can flag messages to the moderator; moderators
// (cohort mentor / coaching host, via canModerate) can delete messages (PRD §11).
export function ChatPanel({
  channelId,
  selfMemberId,
  title,
  canModerate = false,
}: {
  channelId: string
  selfMemberId: string
  title: string
  canModerate?: boolean
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

  // Realtime push: fetch immediately on insert instead of waiting for the poll.
  // Best-effort — falls back to the 8s poll if third-party auth isn't configured.
  const { getToken } = useAuth()
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createBrowserSupabase>['channel']> | null = null
    try {
      const sb = createBrowserSupabase(getToken)
      channel = sb
        .channel(`chat:${channelId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
          () => load(),
        )
        .subscribe()
    } catch {
      /* realtime is optional; polling covers it */
    }
    return () => {
      channel?.unsubscribe()
    }
  }, [channelId, getToken, load])

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

  const act = async (path: string, messageId: string) => {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId }),
    })
    await load()
  }

  return (
    <div className="flex h-80 flex-col rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-2 text-sm font-semibold text-gray-700">{title}</div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-sm text-gray-400">No messages yet — say hello.</p>}
        {messages.map((m) => {
          const mine = m.author_member_id === selfMemberId
          return (
            <div key={m.id} className={`group flex items-center gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && !m.flagged && (
                <button
                  onClick={() => act('/api/community/chat/flag', m.id)}
                  title="Flag for the mentor"
                  aria-label="Flag message"
                  className="text-gray-300 opacity-0 transition hover:text-amber-600 group-hover:opacity-100"
                >
                  <Flag className="h-3.5 w-3.5" />
                </button>
              )}
              <div
                className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${
                  mine ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {m.body}
                {m.flagged && (
                  <span className="ml-2 align-middle text-[10px] font-medium text-amber-500">⚑ flagged</span>
                )}
              </div>
              {canModerate && (
                <button
                  onClick={() => act('/api/community/chat/delete', m.id)}
                  title="Delete message"
                  aria-label="Delete message"
                  className="text-gray-300 opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
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
