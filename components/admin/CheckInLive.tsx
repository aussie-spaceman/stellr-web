'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { Maximize2, Minimize2, Printer, QrCode, Search, Settings2, X } from 'lucide-react'
import { Button, cn } from '@stellr/web-ui'

interface LiveParticipant {
  id: string
  firstName: string
  lastName: string
  eventRole: string | null
  shirtSize: string | null
  checkedInAt: string | null
  checkInMethod: string | null
  company: { number: number; name: string | null } | null
  merch: { name: string; qty: number }[]
  merchCollected: boolean
}

interface LiveState {
  checkInOpen: boolean
  checkInToken: string | null
  resourcesUrl: string | null
  participants: LiveParticipant[]
  /** The check-in banner (/check-in) sends phones to this event. */
  bannerTarget: boolean
  /** Other in-person events with check-in open; opening this one closes them. */
  otherOpen: { slug: string; title: string }[]
}

type Filter = 'all' | 'waiting' | 'arrived'
type Queued = { action: string; participantId: string; label: string }

const POLL_MS = 5000
const REQUEST_TIMEOUT_MS = 8000
const DESK_PREF_KEY = 'stellr_checkin_desk_mode'

function timeLabel(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

// The registration desk's console (PRD 6.7), built for a tablet on a stand or a
// phone in a volunteer's hand: big touch targets, and a list in a fixed
// first-name order so a row never moves under a finger when someone checks in
// (CO, Oct 2026). Taps update the row at once; a 5-second poll picks up phones
// checking themselves in.
//
// Venue Wi-Fi is unreliable, so the console has to be honest about what it
// knows:
//   - polls never overlap, and a response that started before a newer one (or
//     before a tap) is dropped, so a slow poll can't flip a row back;
//   - polling pauses while the tab is hidden and resumes with a fresh load;
//   - taps that can't reach the server wait in a queue and are sent, in order,
//     when the connection returns;
//   - the header says when it last synced, and an expired sign-in says so
//     instead of spinning.
export default function CheckInLive({
  eventSlug,
  eventTitle,
  siteUrl,
  isVirtual,
}: {
  eventSlug: string
  eventTitle: string
  siteUrl: string
  isVirtual: boolean
}) {
  const [state, setState] = useState<LiveState | null>(null)
  const [pending, setPending] = useState<Record<string, Partial<LiveParticipant>>>({})
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resourcesDraft, setResourcesDraft] = useState<string | null>(null)
  const [resourcesNote, setResourcesNote] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [offline, setOffline] = useState(false)
  const [authProblem, setAuthProblem] = useState<401 | 403 | null>(null)
  const [queued, setQueued] = useState(0)
  const [desk, setDesk] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Request ordering. Every GET takes the next sequence number; a response is
  // applied only if nothing newer has been applied and it started after the
  // most recent tap.
  const seq = useRef(0)
  const lastApplied = useRef(0)
  const minAccept = useRef(0)
  const pollInFlight = useRef(false)
  const queue = useRef<Queued[]>([])
  const flushing = useRef(false)

  const api = `/api/admin/events/${eventSlug}/check-in`
  const checkInUrl = state?.checkInToken ? `${siteUrl}/check-in/${eventSlug}?t=${state.checkInToken}` : null

  const refresh = useCallback(
    async (opts: { poll?: boolean } = {}) => {
      if (opts.poll && pollInFlight.current) return
      const mySeq = ++seq.current
      if (opts.poll) pollInFlight.current = true
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(api, { cache: 'no-store', signal: ctrl.signal })
        if (res.status === 401 || res.status === 403) {
          setAuthProblem(res.status)
          return
        }
        if (!res.ok) {
          setOffline(true)
          return
        }
        const data = (await res.json()) as LiveState
        if (mySeq < lastApplied.current || mySeq < minAccept.current) return
        lastApplied.current = mySeq
        setState(data)
        setAuthProblem(null)
        setOffline(false)
        setLastSynced(new Date())
      } catch {
        setOffline(true)
      } finally {
        clearTimeout(timer)
        if (opts.poll) pollInFlight.current = false
      }
    },
    [api]
  )

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
      try {
        return await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        })
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    },
    [api]
  )

  const clearPending = useCallback((ids: string[]) => {
    if (!ids.length) return
    setPending((cur) => {
      const next = { ...cur }
      for (const id of ids) delete next[id]
      return next
    })
  }, [])

  // Send queued taps in the order they were made. Stops at the first one that
  // still can't reach the server.
  const flush = useCallback(async () => {
    if (flushing.current || queue.current.length === 0) return
    flushing.current = true
    const done: string[] = []
    try {
      while (queue.current.length) {
        const item = queue.current[0]
        const res = await post({ action: item.action, participantId: item.participantId })
        if (!res) break
        queue.current.shift()
        if (res.status === 401 || res.status === 403) {
          setAuthProblem(res.status)
          break
        }
        if (!res.ok) setError(`Couldn’t update ${item.label}. Try again.`)
        if (!queue.current.some((q) => q.participantId === item.participantId)) done.push(item.participantId)
      }
    } finally {
      flushing.current = false
      setQueued(queue.current.length)
    }
    if (done.length) {
      minAccept.current = seq.current + 1
      await refresh()
      clearPending(done)
    }
  }, [post, refresh, clearPending])

  useEffect(() => {
    refresh()
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      flush()
      refresh({ poll: true })
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flush()
        refresh()
      }
    }
    const onOnline = () => {
      flush()
      refresh()
    }
    const onOffline = () => setOffline(true)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [refresh, flush])

  // Desk mode: on by default below the desktop layout (phones, a portrait
  // tablet), remembered per device once someone chooses.
  useEffect(() => {
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(DESK_PREF_KEY)
    } catch {
      /* storage blocked: fall back to the screen size */
    }
    setDesk(saved ? saved === '1' : window.matchMedia('(max-width: 1023px)').matches)
  }, [])

  function chooseDesk(on: boolean) {
    setDesk(on)
    setSettingsOpen(false)
    try {
      window.localStorage.setItem(DESK_PREF_KEY, on ? '1' : '0')
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  // A tablet on a stand shouldn't dim mid-queue. Wake Lock is released when the
  // tab is hidden, so take it again on return.
  useEffect(() => {
    if (!desk || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let active = true
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const next = await navigator.wakeLock.request('screen')
        if (active) lock = next
        else next.release().catch(() => {})
      } catch {
        /* low battery or not allowed: the screen may sleep, nothing else breaks */
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', acquire)
      lock?.release().catch(() => {})
    }
  }, [desk])

  // Desk mode covers the admin chrome; Escape returns to it.
  useEffect(() => {
    if (!desk) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !settingsOpen) chooseDesk(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desk, settingsOpen])

  useEffect(() => {
    if (!checkInUrl) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(checkInUrl, { width: 480, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(null))
  }, [checkInUrl])

  async function settingsAction(action: 'open' | 'close' | 'regenerate') {
    // One banner, one event: opening here closes the other in-person check-in.
    const others = state?.otherOpen ?? []
    if (action === 'open' && !isVirtual && others.length) {
      const names = others.map((o) => o.title).join(', ')
      if (!window.confirm(`Check-in is open for ${names}. Opening this one closes it and points the banner here.`)) return
    }
    setBusy(true)
    const res = await post({ action })
    setBusy(false)
    if (!res) setError('Couldn’t reach Stellr. Check the connection and try again.')
    else if (res.status === 401 || res.status === 403) setAuthProblem(res.status)
    refresh()
  }

  // Row actions show their result immediately and keep it until the server
  // agrees. If the server can't be reached, the tap waits in the queue and the
  // row keeps showing it.
  async function rowAction(action: string, p: LiveParticipant, patch: Partial<LiveParticipant>) {
    setError(null)
    const label = `${p.firstName} ${p.lastName}`
    minAccept.current = seq.current + 1
    setPending((cur) => ({ ...cur, [p.id]: { ...cur[p.id], ...patch } }))

    if (action === 'manual' && search) {
      setSearch('')
      searchRef.current?.focus()
    }

    // Keep taps in order: if earlier ones are still waiting, this one waits too.
    if (queue.current.length) {
      queue.current.push({ action, participantId: p.id, label })
      setQueued(queue.current.length)
      flush()
      return
    }

    const res = await post({ action, participantId: p.id })
    if (!res) {
      queue.current.push({ action, participantId: p.id, label })
      setQueued(queue.current.length)
      setOffline(true)
      return
    }
    if (res.status === 401 || res.status === 403) {
      setAuthProblem(res.status)
      clearPending([p.id])
      return
    }
    if (!res.ok) setError(`Couldn’t update ${label}. Try again.`)
    minAccept.current = seq.current + 1
    await refresh()
    clearPending([p.id])
  }

  async function saveResources() {
    setResourcesNote(null)
    const res = await post({ action: 'resources_url', url: resourcesDraft ?? '' })
    const body = await res?.json().catch(() => null)
    if (!res?.ok) {
      setResourcesNote(body?.error ?? 'Couldn’t save.')
      return
    }
    setResourcesDraft(null)
    setResourcesNote('Saved')
    refresh()
  }

  const participants = useMemo(
    () =>
      (state?.participants ?? [])
        .map((p) => ({ ...p, ...pending[p.id] }))
        // Fixed order: first name, then last name. Never by arrival time.
        .sort(
          (a, b) =>
            a.firstName.localeCompare(b.firstName, 'en', { sensitivity: 'base' }) ||
            a.lastName.localeCompare(b.lastName, 'en', { sensitivity: 'base' }) ||
            a.id.localeCompare(b.id)
        ),
    [state, pending]
  )

  const arrived = participants.filter((p) => p.checkedInAt).length
  const total = participants.length

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return participants.filter((p) => {
      if (filter === 'waiting' && p.checkedInAt) return false
      if (filter === 'arrived' && !p.checkedInAt) return false
      return !q || `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
    })
  }, [participants, search, filter])

  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(`/admin/competitions/${eventSlug}/check-in`)}`
  const authBanner = authProblem && (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-control border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink">
      <span className="min-w-0 flex-1">
        {authProblem === 401
          ? 'Your sign-in has expired, so the list isn’t updating.'
          : 'This account no longer has access to this event’s check-in.'}
      </span>
      {authProblem === 401 && (
        <Button href={signInHref} as={Link} className="min-h-11 px-4 py-2">
          Sign in again
        </Button>
      )}
    </div>
  )

  if (!state) {
    return (
      <div className="space-y-3">
        {authBanner}
        {!authProblem &&
          (offline ? (
            <div role="alert" className="space-y-3 rounded-ds-card border border-line bg-white p-5 text-sm text-content-body">
              <p>Couldn’t load the arrivals list. Check the connection.</p>
              <Button variant="secondary" onClick={() => refresh()} className="min-h-11 px-4 py-2">
                Try again
              </Button>
            </div>
          ) : (
            <p className="text-sm text-content-muted" role="status">
              Loading arrivals…
            </p>
          ))}
      </div>
    )
  }

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    { key: 'waiting', label: 'Not arrived', count: total - arrived },
    { key: 'arrived', label: 'Arrived', count: arrived },
  ]

  const syncChip = (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium',
        offline ? 'bg-pathway-amber-bg text-brand-gold-ink' : 'bg-enviro-green-bg text-enviro-green-text'
      )}
    >
      <span className={cn('h-2 w-2 rounded-full', offline ? 'bg-pathway-amber' : 'bg-enviro-green')} aria-hidden />
      {offline ? 'Offline' : 'Live'}
      {lastSynced && <span className="font-normal">· synced {timeLabel(lastSynced)}</span>}
      {queued > 0 && <span className="font-semibold">· {queued} waiting to send</span>}
    </span>
  )

  const settingsPanel = (
    <div className="space-y-4 rounded-ds-card border border-line bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-subheading text-sm font-semibold text-content-muted">Check-in</h2>
        <span
          className={cn(
            'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
            state.checkInOpen ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'
          )}
        >
          {state.checkInOpen ? 'Open' : 'Closed'}
        </span>
      </div>
      {state.bannerTarget && (
        <p className="rounded-control bg-primary/10 px-3 py-2 text-sm font-medium text-primary-deep">
          The check-in banner points here.
        </p>
      )}

      {state.checkInOpen && qrDataUrl ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the QR encoder; nothing to optimise */}
          <img src={qrDataUrl} alt="Event check-in QR code" className="mx-auto w-full max-w-xs rounded-control border border-line-light" />
          <p className="break-all text-xs text-content-muted">{checkInUrl}</p>
        </>
      ) : (
        <p className="text-sm text-content-muted">
          {state.checkInOpen ? 'Generating QR code…' : 'Open check-in to generate the QR code.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {state.checkInOpen ? (
          <Button variant="secondary" onClick={() => settingsAction('close')} disabled={busy} className="min-h-11 px-4 py-2">
            Close check-in
          </Button>
        ) : (
          <Button onClick={() => settingsAction('open')} disabled={busy} className="min-h-11 px-4 py-2">
            Open check-in
          </Button>
        )}
        {state.checkInOpen && checkInUrl && (
          <Button
            variant="softBlue"
            href={`/admin/competitions/${eventSlug}/check-in/poster`}
            as={Link}
            className="min-h-11 px-4 py-2"
          >
            <Printer className="h-4 w-4" aria-hidden /> Door poster
          </Button>
        )}
        {!isVirtual && (
          <Button variant="softBlue" href="/admin/competitions/check-in-banner" as={Link} className="min-h-11 px-4 py-2">
            <QrCode className="h-4 w-4" aria-hidden /> Banner
          </Button>
        )}
        <button
          onClick={() => {
            if (window.confirm('Regenerating invalidates the current QR code, any printed posters, and links. Continue?')) {
              settingsAction('regenerate')
            }
          }}
          disabled={busy || !state.checkInToken}
          className="min-h-11 px-2 text-sm text-content-muted hover:text-danger disabled:opacity-50"
        >
          Regenerate code
        </button>
      </div>
      <p className="text-xs text-content-muted">
        {isVirtual
          ? 'For a virtual event, email the link: people confirm their attendance with their name and date of birth.'
          : 'The check-in banner sends phones to whichever in-person event has check-in open, so opening this one closes any other. People check themselves in with their name and date of birth while they wait. The door poster works for this event only.'}
      </p>

      <div className="space-y-2 border-t border-line-light pt-4">
        <label htmlFor="resources-url" className="block font-subheading text-sm font-semibold text-content-body">
          Event documents (Google Drive folder)
        </label>
        <p className="text-xs text-content-muted">Shown to every participant on their check-in page.</p>
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <input
            id="resources-url"
            type="url"
            inputMode="url"
            value={resourcesDraft ?? state.resourcesUrl ?? ''}
            onChange={(e) => {
              setResourcesDraft(e.target.value)
              setResourcesNote(null)
            }}
            placeholder="https://drive.google.com/…"
            className="min-h-11 w-full min-w-0 flex-1 rounded-control border border-line-strong px-3 text-base lg:text-sm"
          />
          <Button variant="secondary" onClick={saveResources} disabled={resourcesDraft === null} className="min-h-11 self-start px-4 py-2">
            Save
          </Button>
        </div>
        {resourcesNote && <p className="text-xs text-content-muted">{resourcesNote}</p>}
      </div>
    </div>
  )

  const arrivals = (
    <div className={cn('self-start rounded-ds-card border border-line bg-white', !desk && 'lg:col-span-2')}>
      {/* Sticks under the admin top strip, or to the top of the screen in desk mode. */}
      <div
        className={cn(
          'sticky z-10 space-y-3 rounded-t-ds-card border-b border-line-light bg-white px-4 py-3 short:space-y-2 short:py-2',
          desk ? 'top-0' : 'top-14'
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-subheading text-sm font-semibold text-content-muted short:sr-only">Arrivals</h2>
          <span className="font-display text-2xl font-bold tabular-nums text-ink" aria-label={`${arrived} of ${total} arrived`}>
            {arrived}
            <span className="text-sm font-medium text-content-muted"> / {total}</span>
          </span>
          {syncChip}
          <label className="relative order-last w-full sm:order-none sm:ml-auto sm:w-auto sm:min-w-[16rem] sm:max-w-xs short:order-none short:w-auto short:min-w-0 short:flex-1">
            <span className="sr-only">Search by name</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              className="min-h-11 w-full rounded-control border border-line-strong pl-9 pr-3 text-base"
            />
          </label>
        </div>
        <div role="tablist" aria-label="Show" className="flex gap-1 rounded-control bg-surface p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={filter === t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                'min-h-11 flex-1 rounded-control px-3 text-sm font-medium short:min-h-9',
                filter === t.key ? 'bg-white text-ink shadow-xs' : 'text-content-muted'
              )}
            >
              {t.label} <span className="tabular-nums text-content-muted">{t.count}</span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <ul className="divide-y divide-line-light">
        {visible.map((p) => (
          <li key={p.id} className={cn('flex items-center gap-3 px-4 py-3 sm:gap-4', p.checkedInAt && 'bg-enviro-green-bg/40')}>
            <CompanyBadge company={p.company} />
            <div className="min-w-0 flex-1">
              <p className="break-words text-base font-semibold text-ink">
                {p.firstName} {p.lastName}
              </p>
              <p className="text-sm text-content-muted">
                <span className="capitalize">{(p.eventRole ?? '').replace(/_/g, ' ')}</span>
                {' · '}Shirt {p.shirtSize ?? '—'}
                {p.company?.name && <> · {p.company.name}</>}
                {p.merch.length > 0 && <> · {p.merch.map((m) => `${m.name}${m.qty > 1 ? ` ×${m.qty}` : ''}`).join(', ')}</>}
              </p>
              {p.merch.length > 0 && (
                <button
                  onClick={() =>
                    rowAction(p.merchCollected ? 'merch_uncollected' : 'merch_collected', p, {
                      merchCollected: !p.merchCollected,
                    })
                  }
                  className={cn('mt-1 min-h-11 text-sm font-medium', p.merchCollected ? 'text-enviro-green-text' : 'text-brand-gold-ink')}
                >
                  {p.merchCollected ? '✓ Merch collected' : 'Mark merch collected'}
                </button>
              )}
            </div>
            {p.checkedInAt ? (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="inline-flex rounded-full bg-enviro-green-bg px-3 py-1 text-sm font-medium text-enviro-green-text">
                  ✓ {new Date(p.checkedInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  {p.checkInMethod === 'manual' && ' · desk'}
                  {p.checkInMethod === 'qr' && ' · phone'}
                  {p.checkInMethod === 'virtual' && ' · virtual'}
                </span>
                <button
                  onClick={() => rowAction('undo', p, { checkedInAt: null, checkInMethod: null })}
                  className="min-h-11 px-3 text-sm text-content-muted hover:text-danger"
                >
                  Undo
                </button>
              </div>
            ) : (
              <Button
                onClick={() => rowAction('manual', p, { checkedInAt: new Date().toISOString(), checkInMethod: 'manual' })}
                className="min-h-12 shrink-0 px-4 py-2 text-base sm:px-5"
              >
                Check in
              </Button>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-content-muted">No one here.</li>}
      </ul>
    </div>
  )

  if (desk) {
    // Covers the admin top strip, sidebar and tab bar so the list has the whole
    // screen. The QR code and check-in settings sit behind one button.
    return (
      <div
        role="region"
        aria-label={`Check-in desk: ${eventTitle}`}
        // !mt-0: the page wraps this in a space-y stack, whose margin would
        // otherwise push a fixed overlay 16px down and let the header show.
        className="fixed inset-0 z-50 !mt-0 overflow-y-auto overscroll-contain bg-surface"
      >
        <div className="mx-auto max-w-3xl space-y-3 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate font-display text-base font-bold text-ink">{eventTitle}</p>
            <Button
              variant="secondary"
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-controls="checkin-settings"
              className="min-h-11 px-3 py-2"
            >
              {settingsOpen ? <X className="h-4 w-4" aria-hidden /> : <Settings2 className="h-4 w-4" aria-hidden />}
              <span className="hidden sm:inline">{settingsOpen ? 'Close' : 'QR & settings'}</span>
              <span className="sr-only sm:hidden">{settingsOpen ? 'Close settings' : 'QR code and settings'}</span>
            </Button>
            <Button variant="secondary" onClick={() => chooseDesk(false)} className="min-h-11 px-3 py-2">
              <Minimize2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Exit desk mode</span>
              <span className="sr-only sm:hidden">Exit desk mode</span>
            </Button>
          </div>
          {authBanner}
          {settingsOpen && <div id="checkin-settings">{settingsPanel}</div>}
          {arrivals}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {authBanner}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => chooseDesk(true)} className="min-h-11 px-4 py-2">
          <Maximize2 className="h-4 w-4" aria-hidden /> Desk mode
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {/* QR, door poster, event documents. Below the arrivals on a portrait
            tablet, so the list the desk works from is what's on screen. */}
        <div className="order-last self-start lg:sticky lg:top-20 lg:order-none">{settingsPanel}</div>
        {arrivals}
      </div>
    </div>
  )
}

// The number is what the desk tells each person; the name is shown in the row.
function CompanyBadge({ company }: { company: LiveParticipant['company'] }) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control',
        company ? 'bg-midnight text-white' : 'border border-dashed border-line text-content-muted'
      )}
      aria-label={company ? `Company ${company.number}` : 'No company'}
      role="img"
    >
      <span className="text-xs uppercase leading-none tracking-wide opacity-80" aria-hidden>
        Co.
      </span>
      <span className="font-display text-xl font-bold leading-tight tabular-nums" aria-hidden>
        {company?.number ?? '–'}
      </span>
    </div>
  )
}
