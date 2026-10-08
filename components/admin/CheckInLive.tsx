'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { Printer, Search } from 'lucide-react'
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
}

type Filter = 'all' | 'waiting' | 'arrived'

const POLL_MS = 5000

// The registration desk's console (PRD 6.7), built for a tablet: big touch
// targets, and a list in a fixed first-name order so a row never moves under
// the admin's finger when someone checks in (CO, Oct 2026). Taps update the row
// at once; the 5-second poll picks up phones checking themselves in.
export default function CheckInLive({ eventSlug, siteUrl }: { eventSlug: string; siteUrl: string }) {
  const [state, setState] = useState<LiveState | null>(null)
  const [pending, setPending] = useState<Record<string, Partial<LiveParticipant>>>({})
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resourcesDraft, setResourcesDraft] = useState<string | null>(null)
  const [resourcesNote, setResourcesNote] = useState<string | null>(null)

  const api = `/api/admin/events/${eventSlug}/check-in`
  const checkInUrl = state?.checkInToken ? `${siteUrl}/check-in/${eventSlug}?t=${state.checkInToken}` : null

  const refresh = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' }).catch(() => null)
    if (res?.ok) setState(await res.json())
  }, [api])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    if (!checkInUrl) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(checkInUrl, { width: 480, margin: 1 }).then(setQrDataUrl).catch(() => setQrDataUrl(null))
  }, [checkInUrl])

  async function post(body: Record<string, unknown>) {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null)
    return res
  }

  async function settingsAction(action: 'open' | 'close' | 'regenerate') {
    setBusy(true)
    await post({ action })
    setBusy(false)
    refresh()
  }

  // Row actions show their result immediately and keep it until the server
  // agrees, so a poll landing mid-request can't flicker the row back.
  async function rowAction(action: string, p: LiveParticipant, patch: Partial<LiveParticipant>) {
    setError(null)
    setPending((cur) => ({ ...cur, [p.id]: { ...cur[p.id], ...patch } }))
    const res = await post({ action, participantId: p.id })
    if (!res?.ok) setError(`Couldn’t update ${p.firstName} ${p.lastName}. Try again.`)
    await refresh()
    setPending((cur) => {
      const next = { ...cur }
      delete next[p.id]
      return next
    })
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

  if (!state) return <p className="text-sm text-content-muted">Loading…</p>

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    { key: 'waiting', label: 'Not arrived', count: total - arrived },
    { key: 'arrived', label: 'Arrived', count: arrived },
  ]

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* QR, door poster, event documents. Below the arrivals on a portrait
          tablet, so the list the desk works from is what's on screen. */}
      <div className="order-last space-y-4 self-start rounded-ds-card border border-line bg-white p-5 lg:sticky lg:top-20 lg:order-none">
        <div className="flex items-center justify-between">
          <h2 className="font-subheading text-sm font-semibold uppercase tracking-wide text-content-muted">Check-in</h2>
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
              state.checkInOpen ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'
            )}
          >
            {state.checkInOpen ? 'Open' : 'Closed'}
          </span>
        </div>

        {state.checkInOpen && qrDataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from the QR encoder; nothing to optimise */}
            <img src={qrDataUrl} alt="Event check-in QR code" className="mx-auto w-full max-w-xs rounded-control border border-line-light" />
            <p className="break-all text-xs text-content-faint">{checkInUrl}</p>
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
          Print the door poster for the start of the line: people check themselves in on their phones with their name
          and date of birth while they wait. For virtual events, email the link instead.
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
              className="min-h-11 w-full min-w-0 flex-1 rounded-control border border-line px-3 text-sm"
            />
            <Button
              variant="secondary"
              onClick={saveResources}
              disabled={resourcesDraft === null}
              className="min-h-11 self-start px-4 py-2"
            >
              Save
            </Button>
          </div>
          {resourcesNote && <p className="text-xs text-content-muted">{resourcesNote}</p>}
        </div>
      </div>

      {/* Arrivals */}
      <div className="self-start rounded-ds-card border border-line bg-white lg:col-span-2">
        {/* Sits just under the admin layout's sticky top strip. */}
        <div className="sticky top-14 z-10 space-y-3 rounded-t-ds-card border-b border-line-light bg-white px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 className="font-subheading text-sm font-semibold uppercase tracking-wide text-content-muted">Arrivals</h2>
            <span className="font-display text-2xl font-bold tabular-nums text-ink">
              {arrived}
              <span className="text-sm font-medium text-content-muted"> / {total}</span>
            </span>
            <label className="relative ml-auto w-full max-w-xs">
              <span className="sr-only">Search by name</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-faint" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name…"
                className="min-h-11 w-full rounded-control border border-line pl-9 pr-3 text-base"
              />
            </label>
          </div>
          <div role="tablist" className="flex gap-1 rounded-control bg-surface p-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={filter === t.key}
                onClick={() => setFilter(t.key)}
                className={cn(
                  'min-h-11 flex-1 rounded-control px-3 text-sm font-medium',
                  filter === t.key ? 'bg-white text-ink shadow-sm' : 'text-content-muted'
                )}
              >
                {t.label} <span className="tabular-nums text-content-faint">{t.count}</span>
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
            <li key={p.id} className={cn('flex items-center gap-4 px-4 py-3', p.checkedInAt && 'bg-enviro-green-bg/40')}>
              <CompanyBadge company={p.company} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-ink">
                  {p.firstName} {p.lastName}
                </p>
                <p className="text-sm text-content-muted">
                  <span className="capitalize">{(p.eventRole ?? '').replace(/_/g, ' ')}</span>
                  {' · '}Shirt {p.shirtSize ?? '—'}
                  {p.merch.length > 0 && (
                    <> · {p.merch.map((m) => `${m.name}${m.qty > 1 ? ` ×${m.qty}` : ''}`).join(', ')}</>
                  )}
                </p>
                {p.merch.length > 0 && (
                  <button
                    onClick={() =>
                      rowAction(p.merchCollected ? 'merch_uncollected' : 'merch_collected', p, {
                        merchCollected: !p.merchCollected,
                      })
                    }
                    className={cn(
                      'mt-1 min-h-9 text-sm font-medium',
                      p.merchCollected ? 'text-enviro-green-text' : 'text-pathway-amber-deep'
                    )}
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
                    className="min-h-9 px-2 text-sm text-content-muted hover:text-danger"
                  >
                    Undo
                  </button>
                </div>
              ) : (
                <Button
                  onClick={() =>
                    rowAction('manual', p, { checkedInAt: new Date().toISOString(), checkInMethod: 'manual' })
                  }
                  className="min-h-12 shrink-0 px-5 py-2 text-base"
                >
                  Check in
                </Button>
              )}
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-8 text-center text-sm text-content-muted">No one here.</li>}
        </ul>
      </div>
    </div>
  )
}

// The number is what the desk tells each person; the name is admin-only context.
function CompanyBadge({ company }: { company: LiveParticipant['company'] }) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-control',
        company ? 'bg-midnight text-white' : 'border border-dashed border-line text-content-faint'
      )}
      title={company ? (company.name ? `Company ${company.number} — ${company.name}` : `Company ${company.number}`) : 'No company'}
    >
      <span className="text-xs uppercase leading-none tracking-wide opacity-70">Co.</span>
      <span className="font-display text-xl font-bold leading-tight tabular-nums">{company?.number ?? '–'}</span>
    </div>
  )
}
