'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell } from 'lucide-react'
import Link from 'next/link'

interface Notification {
  id: string
  type: string
  reference_type: string | null
  reference_id: string | null
  body: string | null
  is_read: boolean
  created_at: string
  actor: { first_name: string | null; last_name: string | null } | null
}

function actorName(actor: Notification['actor']): string {
  if (!actor) return 'Someone'
  return [actor.first_name, actor.last_name].filter(Boolean).join(' ') || 'A member'
}

function typeLabel(n: Notification): string {
  switch (n.type) {
    case 'reply': return `${actorName(n.actor)} replied to your post`
    case 'mention': return `${actorName(n.actor)} mentioned you`
    case 'announcement': return 'New announcement'
    case 'resource': return 'New resource added'
    default: return n.body ?? 'New notification'
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Polls /api/community/notifications?unread=1 every 30 s for the badge count.
// On open, fetches the full list and marks all read.
export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/community/notifications?unread=1')
      if (res.ok) {
        const { count } = await res.json()
        setUnread(count)
      }
    } catch { /* silent — non-critical */ }
  }, [])

  // Poll every 30 s (stays within Supabase Realtime-free budget).
  useEffect(() => {
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => clearInterval(id)
  }, [fetchCount])

  // Close dropdown when clicking outside.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openDropdown = async () => {
    setOpen((o) => !o)
    if (!open) {
      setLoading(true)
      try {
        const res = await fetch('/api/community/notifications')
        if (res.ok) {
          const { notifications: list } = await res.json()
          setNotifications(list)
          setUnread(0)
          // Mark all read — fire-and-forget
          fetch('/api/community/notifications', { method: 'POST' })
        }
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={openDropdown}
        className="relative rounded-md p-1.5 text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-muted"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-brand-border bg-white shadow-lg">
          <div className="border-b border-brand-hairline px-4 py-2.5">
            <p className="text-sm font-semibold text-brand-blue-dark">Notifications</p>
          </div>
          <ul className="max-h-80 divide-y divide-brand-hairline overflow-y-auto">
            {loading && (
              <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">Loading…</li>
            )}
            {!loading && notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">No notifications yet.</li>
            )}
            {!loading && notifications.map((n) => {
              const href = n.reference_type === 'post' && n.reference_id
                ? `/community/general/${n.reference_id}`
                : '/community'
              return (
                <li key={n.id}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className={[
                      'block px-4 py-3 text-sm hover:bg-brand-canvas',
                      n.is_read ? 'text-brand-muted-soft' : 'text-brand-blue-dark',
                    ].join(' ')}
                  >
                    <p className={n.is_read ? '' : 'font-medium'}>{typeLabel(n)}</p>
                    {n.body && <p className="mt-0.5 line-clamp-1 text-xs text-brand-muted-soft">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-brand-muted-soft">{timeAgo(n.created_at)}</p>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="border-t border-brand-hairline px-4 py-2">
            <Link
              href="/community"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
            >
              Go to community →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
