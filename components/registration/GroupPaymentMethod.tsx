'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button, Input } from '@stellr/web-ui'
import { X } from 'lucide-react'

// How a group pays, and the way to change it. Shared by the event roster (a link
// in the group's header) and Account → Teams (a section in the open group). Both
// show exactly what a change would do before anything happens: nothing moves until
// the confirm button. Server: lib/group-payment-change.ts, through
// /api/admin/registrations/[id]/payment-method and
// /api/members/teams/[id]/payment-method.

interface Option { method: string; label: string; effects: string[]; unavailable: string | null }

interface SplitPerson { id: string; name: string; bucket: 'adult' | 'student'; onInvoice: boolean; locked: string | null }

/** "Invoice for some": who can go on the invoice, and what it costs per place. */
interface Split {
  people: SplitPerson[]
  lateJoinerPayer: 'group' | 'self'
  unfilledSeats: number
  perSeatCents: number
  currency: string
  coupon: { percentOff: number | null; amountOffCents: number | null } | null
}

/** "Students share the teacher's cost": the inputs, and where a sharing group stands. */
interface Share {
  unitCents: number
  currency: string
  unpaidAdults: number
  students: number
  current: {
    estimate: number
    shareCents: number
    poolCents: number
    students: number
    collectedCents: number
    /** Staff only: the member route leaves it out. */
    projectedShortfallCents?: number
    firstPaid: boolean
    settled: boolean
  } | null
}

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/** The invoice total for the ticked places, the way the server prices it (lib/group-billing invoiceTotals). */
function splitTotal(split: Split, ticked: Set<string>, late: 'group' | 'self') {
  const seats = split.people.filter((p) => !p.locked && ticked.has(p.id)).length + (late === 'group' ? split.unfilledSeats : 0)
  const subtotal = seats * split.perSeatCents
  const discount = split.coupon?.percentOff
    ? Math.round((subtotal * split.coupon.percentOff) / 100)
    : split.coupon?.amountOffCents ? Math.min(subtotal, split.coupon.amountOffCents) : 0
  return { seats, total: subtotal - discount }
}

interface View {
  current: string
  currentLabel: string
  blockedReason: string | null
  options: Option[]
  split?: Split | null
  share?: Share | null
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
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [late, setLate] = useState<'group' | 'self'>('self')
  const [estimate, setEstimate] = useState('')
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
    const next = data as View
    setView(next)
    if (next.share) setEstimate(String(next.share.current?.estimate ?? Math.max(1, next.share.students)))
    if (next.split) {
      setTicked(new Set(next.split.people.filter((p) => p.onInvoice).map((p) => p.id)))
      setLate(next.split.lateJoinerPayer)
    }
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
      body: JSON.stringify(choice === 'invoice_some'
        ? { method: choice, invoiceParticipantIds: [...ticked], lateJoinerPayer: late }
        : choice === 'teacher_share'
          ? { method: choice, shareEstimate: Number(estimate) }
          : { method: choice }),
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
  const split = choice === 'invoice_some' ? view?.split ?? null : null
  const splitSum = split ? splitTotal(split, ticked, late) : null
  const share = choice === 'teacher_share' ? view?.share ?? null : null
  const estimateNumber = Number(estimate)
  const estimateOk = Number.isInteger(estimateNumber) && estimateNumber >= 1 && estimateNumber <= 200
  const sharePreview = share && estimateOk
    ? Math.floor((share.current?.poolCents ?? share.unpaidAdults * share.unitCents) / Math.max(1, estimateNumber, share.current?.students ?? 0))
    : null
  const shareNow = view?.share?.current ?? null
  const toggle = (id: string) => setTicked((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

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
          {shareNow && view && <ShareSummaryLine share={shareNow} currency={view.share?.currency ?? 'usd'} />}
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
            {shareNow && view && <ShareSummaryLine share={shareNow} currency={view.share?.currency ?? 'usd'} />}
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
                      <span className="font-medium">
                        {o.method === 'invoice_some' && view.current === 'invoice_some' ? 'Change who is on the invoice'
                          : o.method === 'teacher_share' && view.current === 'teacher_share' ? 'Change the estimate of students'
                            : o.label}
                      </span>
                      {o.unavailable && <span className="mt-1 block text-xs">{o.unavailable}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {split && splitSum && (
              <fieldset className="space-y-3">
                <legend className="mb-1 font-semibold">Who goes on the invoice</legend>
                <p className="text-xs text-content-secondary">Everyone not ticked pays for their own place by link.</p>
                <ul className="divide-y divide-line rounded-control border border-line">
                  {split.people.map((p) => (
                    <li key={p.id}>
                      <label className={`flex items-center gap-3 px-3 py-2 ${p.locked ? 'text-content-muted' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={!p.locked && ticked.has(p.id)}
                          disabled={!!p.locked || busy}
                          onChange={() => toggle(p.id)}
                        />
                        <span className="flex-1">{p.name}</span>
                        <span className="text-xs text-content-secondary">{p.locked ?? (p.bucket === 'adult' ? 'Adult' : 'Student')}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="space-y-1">
                  <p className="font-medium">People who join later</p>
                  {(['self', 'group'] as const).map((value) => (
                    <label key={value} className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="late-joiner-payer" value={value} checked={late === value} disabled={busy} onChange={() => setLate(value)} />
                      {value === 'self' ? 'Pay for their own place by link' : 'Go on the invoice'}
                    </label>
                  ))}
                  {split.unfilledSeats > 0 && (
                    <p className="text-xs text-content-secondary">
                      {split.unfilledSeats} declared {split.unfilledSeats === 1 ? 'place hasn’t' : 'places haven’t'} been filled yet{late === 'group' ? ', and the invoice covers them.' : '.'}
                    </p>
                  )}
                </div>
                <p className="font-medium">
                  {splitSum.seats > 0
                    ? `Invoice: ${splitSum.seats} ${splitSum.seats === 1 ? 'place' : 'places'}, ${money(splitSum.total, split.currency)}`
                    : 'Tick at least one person for the invoice.'}
                </p>
              </fieldset>
            )}

            {share && (
              <div className="space-y-2">
                <label className="block font-semibold" htmlFor="share-estimate">How many students do you expect to bring?</label>
                <Input
                  id="share-estimate"
                  type="number"
                  min={share.current?.firstPaid ? share.current.estimate : 1}
                  max={200}
                  inputMode="numeric"
                  value={estimate}
                  disabled={busy}
                  onChange={(e) => setEstimate(e.target.value)}
                  className="max-w-[8rem]"
                />
                <p className="text-xs text-content-secondary">
                  {share.current?.firstPaid
                    ? `A student has already paid, so the estimate can only go up from ${share.current.estimate}.`
                    : 'The share is split across this number, or across the students who actually join if that is more.'}
                </p>
                {sharePreview != null && (
                  <p className="font-medium">About {money(sharePreview, share.currency)} per student toward the teacher’s cost.</p>
                )}
              </div>
            )}

            {selected && (
              <div className="space-y-3 rounded-control bg-surface p-3">
                <p className="font-semibold">What happens</p>
                <ul className="list-disc space-y-1 pl-5">
                  {selected.effects.map((effect) => <li key={effect}>{effect}</li>)}
                </ul>
                <div className="flex justify-end">
                  <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy || (!!splitSum && splitSum.seats <= 0) || (!!share && !estimateOk)} onClick={confirm}>
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

/** Where a group sharing the teacher's cost stands, in one line. */
function ShareSummaryLine({ share, currency }: { share: NonNullable<Share['current']>; currency: string }) {
  return (
    <p className="mt-2 text-xs text-content-secondary">
      {share.settled ? 'Settled after the event: ' : ''}
      {money(share.shareCents, currency)} per student toward the teacher’s cost · {share.students} of an estimated {share.estimate} {share.estimate === 1 ? 'student' : 'students'} · {money(share.collectedCents, currency)} collected
      {share.projectedShortfallCents != null && share.projectedShortfallCents > 0
        ? ` · ${money(share.projectedShortfallCents, currency)} not covered by students (Stellr covers it)`
        : ''}
    </p>
  )
}
