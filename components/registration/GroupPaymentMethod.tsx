'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { X } from 'lucide-react'

// How a group pays, and the way to change it. Shared by the event roster (a link
// in the group's header) and Account → Teams (a section in the open group). Both
// show exactly what a change would do before anything happens: nothing moves until
// the confirm button. Server: lib/group-payment-change.ts, through
// /api/admin/registrations/[id]/payment-method and
// /api/members/teams/[id]/payment-method.

interface Option { method: string; label: string; effects: string[]; unavailable: string | null }

interface View {
  current: string
  currentLabel: string
  blockedReason: string | null
  options: Option[]
  /** Only the member route sends this; on the roster, reaching the route is the permission. */
  canChange?: boolean
  readOnlyNote?: string | null
}

export function GroupPaymentMethod({
  endpoint,
  groupLabel,
  variant,
  onChanged,
}: {
  endpoint: string
  groupLabel: string
  /** 'link' for the roster header, 'section' for Account → Teams. */
  variant: 'link' | 'section'
  onChanged?: () => void
}) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [view, setView] = useState<View | null>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ message: string; payUrl: string | null } | null>(null)
  // Rendered into <body> so the roster header's styles don't leak in.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const load = useCallback(async () => {
    const res = await fetch(endpoint)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not load this group’s payment details.')
      return
    }
    setView(data as View)
  }, [endpoint])

  // The section shows the current method straight away; the link loads on open.
  useEffect(() => {
    if (variant === 'section') void load()
  }, [variant, load])

  async function open() {
    setChoice(null)
    setError(null)
    setDone(null)
    dialog.current?.showModal()
    await load()
  }

  async function confirm() {
    // A double-click must not move the group twice.
    if (busy || !choice) return
    setBusy(true)
    setError(null)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: choice }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'That didn’t work. Nothing was changed.')
      return
    }
    setDone({ message: data.message as string, payUrl: (data.payUrl as string | null) ?? null })
    setChoice(null)
    await load()
    onChanged?.()
    router.refresh()
  }

  const selected = view?.options.find((o) => o.method === choice) ?? null
  const canChange = view?.canChange !== false

  return (
    <>
      {variant === 'link' ? (
        <button type="button" onClick={open} className="text-xs font-medium normal-case text-primary hover:text-primary-deep">
          Payment method…
        </button>
      ) : (
        <section className="rounded-control border border-line bg-white px-4 py-3" aria-label="How this group pays">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="text-xs font-medium text-content-secondary">How this group pays</p>
              <p className="font-medium text-ink">{view ? view.currentLabel : error ? 'Unavailable' : 'Loading…'}</p>
            </div>
            {view && canChange && !view.blockedReason && (
              <Button variant="secondary" className="!px-4 !py-2" onClick={open}>Change</Button>
            )}
          </div>
          {view && view.current !== 'free' && !view.blockedReason && !canChange && (
            <p className="mt-2 text-xs text-content-secondary">{view.readOnlyNote}</p>
          )}
          {view?.blockedReason && view.current !== 'free' && (
            <p className="mt-2 text-xs text-content-secondary">{view.blockedReason}</p>
          )}
          {done && !dialog.current?.open && <p role="status" className="mt-2 text-xs text-enviro-green-text">{done.message}</p>}
          {error && !dialog.current?.open && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        </section>
      )}

      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-xl rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Change how the group pays</h2>
              <p className="mt-1 text-sm text-content-secondary">{groupLabel}</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4 text-sm">
            {!view && !error && <p className="text-content-secondary">Loading payment details…</p>}
            {view && <p>Now: <strong>{view.currentLabel}</strong></p>}
            {view?.blockedReason && !done && <p className="text-content-secondary">{view.blockedReason}</p>}

            {view && !view.blockedReason && !done && (
              <fieldset className="space-y-2">
                <legend className="mb-2 font-semibold">Change to</legend>
                {view.options.map((o) => (
                  <label
                    key={o.method}
                    className={`flex items-start gap-3 rounded-control border p-3 ${
                      o.unavailable ? 'border-line text-content-muted' : choice === o.method ? 'cursor-pointer border-primary' : 'cursor-pointer border-line'
                    }`}
                  >
                    <input
                      type="radio"
                      name="group-payment-method"
                      value={o.method}
                      className="mt-0.5"
                      disabled={!!o.unavailable || busy}
                      checked={choice === o.method}
                      onChange={() => { setChoice(o.method); setError(null) }}
                    />
                    <span>
                      <span className="font-medium">{o.label}</span>
                      {o.unavailable && <span className="mt-1 block text-xs">{o.unavailable}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {selected && (
              <div className="space-y-3 rounded-control bg-surface p-3">
                <p className="font-semibold">What happens</p>
                <ul className="list-disc space-y-1 pl-5">
                  {selected.effects.map((effect) => <li key={effect}>{effect}</li>)}
                </ul>
                <div className="flex justify-end">
                  <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy} onClick={confirm}>
                    {busy ? 'Changing…' : 'Confirm change'}
                  </Button>
                </div>
              </div>
            )}

            {done && (
              <div className="space-y-3">
                <p role="status" className="text-enviro-green-text">{done.message}</p>
                {done.payUrl && variant === 'section' && (
                  <Button href={done.payUrl} variant="primaryStrong" className="!px-4 !py-2">Pay now</Button>
                )}
              </div>
            )}
            {error && <p role="alert" className="text-danger">{error}</p>}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
