'use client'

import { useState, useEffect, useRef, useCallback, useId, type CSSProperties } from 'react'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { timeAgo } from '@/lib/utils'
import { CLEARANCE_PATH } from '@/lib/compliance-links'

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
  // Clearance notices (lib/compliance-notify) carry the detail in the body.
  if (n.reference_type === 'compliance') return 'Clearance needed'
  switch (n.type) {
    case 'reply': return `${actorName(n.actor)} replied to your post`
    case 'mention': return `${actorName(n.actor)} mentioned you`
    case 'announcement': return 'New announcement'
    case 'resource': return 'New resource added'
    case 'invite': return n.body ?? `${actorName(n.actor)} invited you to a space`
    default: return n.body ?? 'New notification'
  }
}

// Polls /api/community/notifications?unread=1 every 30 s for the badge count.
// On open, fetches the full list and marks all read.
export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [sheetTop, setSheetTop] = useState(60)
  const ref = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/community/notifications?unread=1')
      if (res.ok) {
        const { count } = await res.json()
        setUnread(count)
      }
    } catch { /* silent — non-critical */ }
  }, [])

  // Poll every 30 s (stays within Supabase Realtime-free budget), but only
  // while the tab is in view: a phone with the app open in a background tab
  // kept waking the radio every 30 s. Coming back refreshes at once.
  useEffect(() => {
    fetchCount()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fetchCount()
    }, 30_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchCount()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchCount])

  // Close on a tap or click outside, or on Escape (focus back on the bell).
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const openDropdown = async () => {
    // On a phone the panel is a sheet hung from the bottom of the top bar
    // (which sits lower while a banner is above it), so measure where that is.
    if (!open) {
      const bar = ref.current?.closest('header')
      if (bar) setSheetTop(Math.round(bar.getBoundingClientRect().bottom))
    }
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
        ref={buttonRef}
        type="button"
        onClick={openDropdown}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-muted"
        // The count is in the name: the badge is drawn, not read.
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Notifications"
          style={{ '--sheet-top': `${sheetTop}px` } as CSSProperties}
          className={[
            // Phone: a full-width sheet under the top bar, never taller than
            // the screen above the tab bar (dvh: the browser's toolbars count).
            'fixed inset-x-0 top-[var(--sheet-top)] z-20 flex max-h-[calc(100dvh_-_var(--sheet-top)_-_6rem)] flex-col',
            'rounded-b-ds-card border-b border-line bg-white shadow-panel',
            // From sm: the popover anchored to the bell.
            'sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-80 sm:rounded-xl sm:border sm:border-brand-border sm:shadow-lg',
          ].join(' ')}
        >
          <div className="shrink-0 border-b border-brand-hairline px-4 py-2.5">
            <p className="text-sm font-semibold text-brand-blue-dark">Notifications</p>
          </div>
          <ul className="min-h-0 divide-y divide-brand-hairline overflow-y-auto overscroll-contain sm:max-h-80">
            {loading && (
              <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">Loading…</li>
            )}
            {!loading && notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">No notifications yet.</li>
            )}
            {!loading && notifications.map((n) => {
              // Cohort invite → inline Accept & review / Decline (handoff bell spec).
              if (n.reference_type === 'cohort_invite' && n.reference_id) {
                return (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-brand-blue-dark">
                      {actorName(n.actor)} invited you to a mentoring cohort
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-brand-muted-soft">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-brand-muted-soft">Also sent to your email · {timeAgo(n.created_at)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Link
                        href={`/community/mentoring/${n.reference_id}/invite`}
                        onClick={() => setOpen(false)}
                        className="rounded-md bg-space-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5B3FE0]"
                      >
                        Accept &amp; review
                      </Link>
                      <button
                        onClick={async () => {
                          await fetch('/api/community/cohorts/respond', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ cohortId: n.reference_id, action: 'decline' }),
                          })
                          setNotifications((prev) => prev.filter((x) => x.id !== n.id))
                        }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                )
              }
              // Coaching workshop invite → inline Accept & review / Decline.
              if (n.reference_type === 'coaching_invite' && n.reference_id) {
                return (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-brand-blue-dark">
                      {actorName(n.actor)} invited you to a coaching workshop
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-brand-muted-soft">{n.body}</p>}
                    <p className="mt-0.5 text-xs text-brand-muted-soft">Also sent to your email · {timeAgo(n.created_at)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Link
                        href={`/community/coaching/${n.reference_id}/invite`}
                        onClick={() => setOpen(false)}
                        className="rounded-md bg-space-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5B3FE0]"
                      >
                        Accept &amp; review
                      </Link>
                      <button
                        onClick={async () => {
                          await fetch('/api/community/cohorts/respond', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ cohortId: n.reference_id, action: 'decline' }),
                          })
                          setNotifications((prev) => prev.filter((x) => x.id !== n.id))
                        }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                )
              }
              // Space invite → inline Accept / Decline (mirrors the cohort flow).
              if (n.type === 'invite' && n.reference_type === 'space' && n.reference_id) {
                const respond = async (action: 'accept' | 'decline') => {
                  await fetch('/api/community/spaces/invite/respond', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ spaceId: n.reference_id, action }),
                  })
                  setNotifications((prev) => prev.filter((x) => x.id !== n.id))
                }
                return (
                  <li key={n.id} className="px-4 py-3">
                    <p className="text-sm font-medium text-brand-blue-dark">
                      {n.body ?? `${actorName(n.actor)} invited you to a space`}
                    </p>
                    <p className="mt-0.5 text-xs text-brand-muted-soft">Also sent to your email · {timeAgo(n.created_at)}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => respond('accept')}
                        className="rounded-md bg-space-violet px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#5B3FE0]"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => respond('decline')}
                        className="rounded-md px-3 py-1.5 text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
                      >
                        Decline
                      </button>
                    </div>
                  </li>
                )
              }
              const href =
                n.reference_type === 'post' && n.reference_id
                  ? `/community/general/${n.reference_id}`
                  : (n.reference_type === 'cohort' || n.reference_type === 'cohort_invite') && n.reference_id
                    ? `/community/mentoring/${n.reference_id}`
                    : (n.reference_type === 'coaching' || n.reference_type === 'coaching_invite') && n.reference_id
                      ? `/community/coaching/${n.reference_id}`
                      : n.reference_type === 'compliance'
                        ? CLEARANCE_PATH
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
          <div className="shrink-0 border-t border-brand-hairline px-4 py-2">
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
