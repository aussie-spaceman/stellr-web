'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'

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
  participants: LiveParticipant[]
}

const POLL_MS = 5000

// Live check-in console: QR code + auto-refreshing arrivals list for the
// laptop at the registration desk (PRD 6.7).
export default function CheckInLive({ eventSlug, siteUrl }: { eventSlug: string; siteUrl: string }) {
  const [state, setState] = useState<LiveState | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)

  const api = `/api/admin/events/${eventSlug}/check-in`
  const checkInUrl = state?.checkInToken ? `${siteUrl}/check-in/${eventSlug}?t=${state.checkInToken}` : null

  const refresh = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store' })
    if (res.ok) setState(await res.json())
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

  async function act(action: string, participantId?: string) {
    setBusy(true)
    await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, participantId }),
    })
    setBusy(false)
    refresh()
  }

  const filtered = useMemo(() => {
    const all = state?.participants ?? []
    const q = search.trim().toLowerCase()
    const list = q
      ? all.filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q))
      : all
    // Most recent arrivals first, then alphabetical for the not-yet-arrived
    return [...list].sort((a, b) => {
      if (a.checkedInAt && b.checkedInAt) return b.checkedInAt.localeCompare(a.checkedInAt)
      if (a.checkedInAt) return -1
      if (b.checkedInAt) return 1
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    })
  }, [state, search])

  if (!state) return <p className="text-sm text-gray-400">Loading…</p>

  const arrived = state.participants.filter((p) => p.checkedInAt).length
  const total = state.participants.length

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* QR + controls */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Check-In</h2>
          <span
            className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${
              state.checkInOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {state.checkInOpen ? 'Open' : 'Closed'}
          </span>
        </div>

        {state.checkInOpen && qrDataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt="Event check-in QR code" className="w-full rounded-lg border border-gray-100" />
            <p className="text-xs text-gray-400 break-all">{checkInUrl}</p>
          </>
        ) : (
          <p className="text-sm text-gray-400">
            {state.checkInOpen ? 'Generating QR code…' : 'Open check-in to generate the QR code.'}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {state.checkInOpen ? (
            <button
              onClick={() => act('close')}
              disabled={busy}
              className="text-sm font-medium border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Close Check-In
            </button>
          ) : (
            <button
              onClick={() => act('open')}
              disabled={busy}
              className="text-sm font-medium bg-indigo-600 text-white rounded-lg px-3 py-1.5 disabled:opacity-50"
            >
              Open Check-In
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm('Regenerating invalidates the current QR code and links. Continue?')) {
                act('regenerate')
              }
            }}
            disabled={busy || !state.checkInToken}
            className="text-sm font-medium border border-gray-300 rounded-lg px-3 py-1.5 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Regenerate Code
          </button>
        </div>
        {checkInUrl && (
          <p className="text-xs text-gray-400">
            For virtual events, email this link to participants so they can confirm attendance.
          </p>
        )}
      </div>

      {/* Live arrivals list */}
      <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden self-start">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Arrivals</h2>
          <span className="text-2xl font-bold text-gray-900 tabular-nums">
            {arrived}
            <span className="text-sm font-medium text-gray-400"> / {total}</span>
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name…"
            className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56"
          />
        </div>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-50">
            {filtered.map((p) => (
              <tr key={p.id} className={p.checkedInAt ? 'bg-green-50/40' : ''}>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-gray-900">
                    {p.firstName} {p.lastName}
                  </span>
                  <p className="text-xs text-gray-400 capitalize">{(p.eventRole ?? '').replace(/_/g, ' ')}</p>
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {p.company
                    ? p.company.name
                      ? `${p.company.number} — ${p.company.name}`
                      : `Company ${p.company.number}`
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-gray-600">
                  {p.shirtSize ?? '—'}
                  {p.merch.length > 0 && (
                    <div className="mt-0.5 text-xs text-gray-400">
                      {p.merch.map((m) => `${m.name}${m.qty > 1 ? ` ×${m.qty}` : ''}`).join(', ')}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {p.checkedInAt ? (
                    <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
                      {new Date(p.checkedInAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      {p.checkInMethod === 'manual' && ' · manual'}
                      {p.checkInMethod === 'virtual' && ' · virtual'}
                    </span>
                  ) : (
                    <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">
                      Not arrived
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-col items-end gap-1">
                    {p.checkedInAt ? (
                      <button
                        onClick={() => act('undo', p.id)}
                        disabled={busy}
                        className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-50"
                      >
                        Undo
                      </button>
                    ) : (
                      <button
                        onClick={() => act('manual', p.id)}
                        disabled={busy}
                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                      >
                        Check In
                      </button>
                    )}
                    {p.merch.length > 0 &&
                      (p.merchCollected ? (
                        <button
                          onClick={() => act('merch_uncollected', p.id)}
                          disabled={busy}
                          className="inline-flex items-center gap-0.5 text-[11px] text-green-700 hover:text-gray-500 disabled:opacity-50"
                        >
                          ✓ Merch collected
                        </button>
                      ) : (
                        <button
                          onClick={() => act('merch_collected', p.id)}
                          disabled={busy}
                          className="text-[11px] font-medium text-amber-700 hover:text-amber-900 disabled:opacity-50"
                        >
                          Mark merch collected
                        </button>
                      ))}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-gray-400" colSpan={5}>
                  No participants found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
