'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Send, Flag, Trash2 } from 'lucide-react'
import { useAuth } from '@clerk/nextjs'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { Avatar } from '@/components/ui/Avatar'
import { ConfirmDialog } from '@stellr/web-ui'

interface Message {
  id: string
  body: string
  author_member_id: string | null
  author_name: string
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
  selfName,
  title,
  canModerate = false,
}: {
  channelId: string
  selfMemberId: string
  selfName?: string
  title: string
  canModerate?: boolean
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const [typing, setTyping] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserSupabase>['channel']> | null>(null)
  const lastTypingSent = useRef(0)

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
  // The same channel carries presence (who's online) and a typing broadcast.
  // Best-effort — falls back to the 8s poll if third-party auth isn't configured.
  const { getToken } = useAuth()
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createBrowserSupabase>['channel']> | null = null
    const timers: Record<string, ReturnType<typeof setTimeout>> = {}
    try {
      const sb = createBrowserSupabase(getToken)
      channel = sb
        .channel(`chat:${channelId}`, { config: { presence: { key: selfMemberId } } })
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channelId}` },
          () => load(),
        )
        .on('presence', { event: 'sync' }, () => {
          setOnlineCount(Object.keys(channel?.presenceState() ?? {}).length)
        })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          const { memberId, name } = (payload ?? {}) as { memberId?: string; name?: string }
          if (!memberId || memberId === selfMemberId) return
          const label = name || 'Someone'
          setTyping((prev) => (prev.includes(label) ? prev : [...prev, label]))
          clearTimeout(timers[memberId])
          timers[memberId] = setTimeout(() => setTyping((prev) => prev.filter((n) => n !== label)), 3500)
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') channel?.track({ memberId: selfMemberId, name: selfName ?? 'Member' })
        })
      channelRef.current = channel
    } catch {
      /* realtime is optional; polling covers it */
    }
    return () => {
      Object.values(timers).forEach(clearTimeout)
      channel?.unsubscribe()
      channelRef.current = null
    }
  }, [channelId, getToken, load, selfMemberId, selfName])

  // New messages scroll the chat, never the page: scrollIntoView moved the
  // whole window on a phone each time one arrived. Only follows them while
  // the reader is at the bottom, so reading back isn't interrupted.
  useEffect(() => {
    const el = scrollerRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  // Throttled "typing" ping as the member writes.
  const pingTyping = () => {
    const now = Date.now()
    if (now - lastTypingSent.current < 1500) return
    lastTypingSent.current = now
    channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { memberId: selfMemberId, name: selfName ?? 'Member' },
    })
  }

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
        stickToBottom.current = true
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

  const deleteConfirmed = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await act('/api/community/chat/delete', confirmDelete)
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
      // The delete button went with its message, so focus has nowhere to
      // return to: put it on the messages rather than the top of the page.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) scrollerRef.current?.focus({ preventScroll: true })
      })
    }
  }

  // Flag and delete show on hover where there is a mouse. A touch screen has
  // no hover, so there they are always shown (they were invisible but still
  // tappable), each a 44px target around a small icon.
  const actionClass =
    'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-content-muted transition ' +
    'opacity-100 focus-visible:opacity-100 mouse:opacity-0 mouse:group-hover:opacity-100 mouse:group-focus-within:opacity-100'

  return (
    // On a phone the chat is most of the screen's height (svh, so it never
    // outgrows it, sideways included); from sm it keeps its compact 20rem.
    <div className="flex h-[70svh] max-h-[32rem] flex-col rounded-lg border border-brand-border bg-white sm:max-h-80">
      <div className="flex items-center justify-between border-b border-brand-hairline px-4 py-2">
        <span className="text-sm font-semibold text-brand-muted">{title}</span>
        {onlineCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-brand-muted-soft">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
            {onlineCount} online
          </span>
        )}
      </div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        role="log"
        aria-label={`${title} messages`}
        // Focusable so the messages can be scrolled from the keyboard.
        tabIndex={0}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && <p className="text-sm text-brand-muted-soft">No messages yet — say hello.</p>}
        {messages.map((m) => {
          const mine = m.author_member_id === selfMemberId
          return (
            <div key={m.id} className={`group flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
              {!mine && (
                <Avatar id={m.author_member_id || m.author_name} name={m.author_name} size="sm" ring={false} />
              )}
              {!mine && !m.flagged && (
                <button
                  type="button"
                  onClick={() => act('/api/community/chat/flag', m.id)}
                  title="Flag for the mentor"
                  aria-label="Flag message"
                  className={`${actionClass} hover:text-brand-gold-ink`}
                >
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
              <div className="flex max-w-[75%] flex-col">
                {!mine && (
                  <span className="mb-0.5 ml-1 font-subheading text-[11px] font-medium text-brand-muted-soft">
                    {m.author_name}
                  </span>
                )}
                <div
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    mine ? 'bg-brand-blue text-white' : 'bg-brand-hairline text-brand-blue-dark'
                  }`}
                >
                  {m.body}
                  {m.flagged && (
                    <span className="ml-2 align-middle text-[10px] font-medium text-brand-gold-ink">⚑ flagged</span>
                  )}
                </div>
              </div>
              {canModerate && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(m.id)}
                  title="Delete message"
                  aria-label="Delete message"
                  className={`${actionClass} hover:text-danger`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="h-4 px-4 text-xs italic text-brand-muted-soft">
        {typing.length > 0 &&
          (typing.length === 1 ? `${typing[0]} is typing…` : `${typing.slice(0, 2).join(', ')} are typing…`)}
      </div>
      <div className="flex items-center gap-2 border-t border-brand-hairline p-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            pingTyping()
          }}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Message…"
          aria-label="Message"
          className="min-w-0 flex-1 rounded-md border border-brand-border px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-brand-blue text-white hover:bg-brand-blue-dark disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this message?"
        description="It's removed for everyone in this chat. This can't be undone."
        confirmLabel="Delete"
        tone="danger"
        busy={deleting}
        onConfirm={deleteConfirmed}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}
