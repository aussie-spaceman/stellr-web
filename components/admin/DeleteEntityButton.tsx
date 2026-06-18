'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Blocker {
  table: string
  label: string
  count: number
  adminHref?: string
}

interface RefundOption {
  pct: number
  cents: number
  validityDays?: number | null
}

interface RefundPreview {
  paid: boolean
  paidCents: number
  currency: string
  daysOut: number | null
  options: { cash?: RefundOption; credit?: RefundOption }
  hasPaymentRef: boolean
  alreadyRefunded: boolean
}

function money(cents: number, currency: string) {
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
}

interface Props {
  /** Registry entity type, e.g. 'member', 'school', 'event'. */
  entity: string
  /** Row id (uuid) or slug for slug-keyed entities. */
  id: string
  /** Human name shown in the confirm dialog. */
  name: string
  /** Where to send the admin after a successful delete. */
  redirectTo?: string
  /** Hide the permanent-delete option for entities that should only soft-delete. */
  allowHardDelete?: boolean
  /** Set false for entities with no soft-delete (e.g. participants) — forces hard purge. */
  softDeletable?: boolean
  /** Require typing DELETE before a hard purge. Default true. */
  requireTypedConfirm?: boolean
  /** Optional custom button label (default "Delete"). */
  label?: string
  /** Enable the refund step for paid registrations/participants. */
  refundable?: boolean
  className?: string
}

// Reusable admin delete affordance. On open it runs a preflight; if the item is
// blocked by linked records it lists exactly what must be deleted first instead
// of offering a delete. Otherwise it offers Soft-delete (default, recoverable)
// and Permanently delete (typed confirmation).
export function DeleteEntityButton({
  entity,
  id,
  name,
  redirectTo,
  allowHardDelete = true,
  softDeletable = true,
  requireTypedConfirm = true,
  label,
  refundable = false,
  className,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [blockers, setBlockers] = useState<Blocker[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'soft' | 'hard'>(softDeletable ? 'soft' : 'hard')
  const [confirmText, setConfirmText] = useState('')
  const [refund, setRefund] = useState<RefundPreview | null>(null)
  const [refundChoice, setRefundChoice] = useState<'cash' | 'credit' | null>(null)

  async function openDialog() {
    setOpen(true)
    setError(null)
    setBlockers(null)
    setMode(softDeletable ? 'soft' : 'hard')
    setConfirmText('')
    setRefund(null)
    // Group deletions refund every paid participant; default to credit (issued
    // wherever the tier offers it). Per-participant deletions resolve below.
    setRefundChoice(refundable && entity === 'registration' ? 'credit' : null)
    setLoading(true)
    try {
      const calls: Promise<unknown>[] = [
        fetch(`/api/admin/deletion/preflight?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`)
          .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
          .then((res) => {
            if (!(res as { ok: boolean }).ok) throw new Error(((res as { d: { error?: string } }).d).error || 'Preflight failed')
            setBlockers(((res as { d: { blockers: Blocker[] } }).d).blockers)
          }),
      ]
      if (refundable && entity === 'participant') {
        calls.push(
          fetch(`/api/admin/refunds/preview?participant=${encodeURIComponent(id)}`)
            .then((r) => r.json())
            .then((preview: RefundPreview) => {
              setRefund(preview)
              // Pre-select the single offered option; leave null when both exist.
              const opts = preview.options || {}
              if (opts.cash && !opts.credit) setRefundChoice('cash')
              else if (opts.credit && !opts.cash) setRefundChoice('credit')
            })
            .catch(() => setRefund(null))
        )
      }
      await Promise.all(calls)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check dependencies')
    } finally {
      setLoading(false)
    }
  }

  async function doDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/deletion', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, mode, refundChoice: refundChoice ?? undefined }),
      })
      const data = await res.json()
      if (res.status === 409 && data.blockers) {
        setBlockers(data.blockers as Blocker[])
        return
      }
      if (!res.ok) throw new Error(data.error || 'Delete failed')

      const failures = (data.externalResults ?? []).filter((r: { ok: boolean }) => !r.ok)
      if (failures.length > 0) {
        setError(`Deleted, but external cleanup had issues: ${failures.map((f: { detail: string }) => f.detail).join('; ')}`)
        setTimeout(() => finish(), 2500)
        return
      }
      finish()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setLoading(false)
    }
  }

  function finish() {
    setOpen(false)
    if (redirectTo) router.push(redirectTo)
    else router.refresh()
  }

  const hasBlockers = blockers !== null && blockers.length > 0
  const typedOk = !requireTypedConfirm || confirmText.trim().toUpperCase() === 'DELETE'
  const hardConfirmed = mode === 'soft' || typedOk
  const showModeChoice = softDeletable && allowHardDelete

  // When a participant's tier offers BOTH cash and credit, the admin must pick.
  const needsRefundChoice =
    refundable &&
    entity === 'participant' &&
    !!refund?.paid &&
    !refund.alreadyRefunded &&
    !!refund.options.cash &&
    !!refund.options.credit
  const refundReady = !needsRefundChoice || refundChoice !== null

  return (
    <>
      <button
        onClick={openDialog}
        className={className ?? 'text-sm font-medium text-red-600 hover:text-red-800 border border-red-200 px-3 py-1.5 rounded-lg'}
      >
        {label ?? 'Delete'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !loading && setOpen(false)}>
          <div className="bg-white rounded-xl border border-brand-border shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-brand-blue-dark">Delete {name}?</h2>

            {loading && !blockers && <p className="text-sm text-brand-muted-soft">Checking dependencies…</p>}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{error}</div>
            )}

            {hasBlockers ? (
              <div className="space-y-2">
                <p className="text-sm text-brand-muted">
                  This can&apos;t be deleted yet. Remove the following linked items first:
                </p>
                <ul className="text-sm text-brand-muted space-y-1 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {blockers!.map((b) => (
                    <li key={b.table} className="flex justify-between gap-3">
                      <span>{b.label}</span>
                      <span className="font-medium">
                        {b.count}
                        {b.adminHref && (
                          <a href={b.adminHref} className="ml-2 text-brand-blue hover:text-brand-blue">view</a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex justify-end pt-2">
                  <button onClick={() => setOpen(false)} className="text-sm text-brand-muted-soft hover:text-brand-muted px-3 py-1.5">Close</button>
                </div>
              </div>
            ) : (
              blockers !== null && (
                <div className="space-y-4">
                  {showModeChoice ? (
                    <div className="space-y-2">
                      <label className="flex items-start gap-2 text-sm text-brand-muted">
                        <input type="radio" checked={mode === 'soft'} onChange={() => setMode('soft')} className="mt-0.5" />
                        <span><span className="font-medium">Soft-delete</span> — hide it but keep the data (recoverable).</span>
                      </label>
                      <label className="flex items-start gap-2 text-sm text-brand-muted">
                        <input type="radio" checked={mode === 'hard'} onChange={() => setMode('hard')} className="mt-0.5" />
                        <span><span className="font-medium">Permanently delete</span> — purge from the database. An archive snapshot is kept for support.</span>
                      </label>
                    </div>
                  ) : (
                    <p className="text-sm text-brand-muted">
                      This permanently removes <span className="font-medium">{name}</span> from the database. An archive snapshot is kept for support.
                    </p>
                  )}

                  {mode === 'hard' && requireTypedConfirm && (
                    <div>
                      <label className="block text-xs text-brand-muted-soft mb-1">Type DELETE to confirm</label>
                      <input
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                    </div>
                  )}

                  {/* Refund step */}
                  {refundable && entity === 'registration' && (
                    <div className="rounded-lg border border-brand-border bg-brand-canvas p-3 space-y-2 text-sm">
                      <p className="text-brand-muted">Paid participants will be refunded per the event&apos;s refund policy. Where a tier offers a choice:</p>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 text-brand-muted">
                          <input type="radio" checked={refundChoice === 'cash'} onChange={() => setRefundChoice('cash')} /> Cash
                        </label>
                        <label className="flex items-center gap-1.5 text-brand-muted">
                          <input type="radio" checked={refundChoice === 'credit'} onChange={() => setRefundChoice('credit')} /> Credit
                        </label>
                      </div>
                    </div>
                  )}

                  {refundable && entity === 'participant' && refund && (
                    <div className="rounded-lg border border-brand-border bg-brand-canvas p-3 space-y-2 text-sm">
                      {refund.alreadyRefunded ? (
                        <p className="text-brand-muted">Already refunded — no further refund will be issued.</p>
                      ) : !refund.paid ? (
                        <p className="text-brand-muted">No payment on record — nothing to refund.</p>
                      ) : Object.keys(refund.options).length === 0 ? (
                        <p className="text-brand-muted">No refund is due at this point ({refund.daysOut} days out).</p>
                      ) : (
                        <>
                          <p className="text-brand-muted">
                            Paid {money(refund.paidCents, refund.currency)} · {refund.daysOut} days out. Refund:
                          </p>
                          {refund.options.cash && (
                            <label className="flex items-center justify-between gap-2 text-brand-muted">
                              <span className="flex items-center gap-1.5">
                                <input type="radio" checked={refundChoice === 'cash'} onChange={() => setRefundChoice('cash')} />
                                Cash ({refund.options.cash.pct}%)
                              </span>
                              <span className="font-medium">{money(refund.options.cash.cents, refund.currency)}</span>
                            </label>
                          )}
                          {refund.options.credit && (
                            <label className="flex items-center justify-between gap-2 text-brand-muted">
                              <span className="flex items-center gap-1.5">
                                <input type="radio" checked={refundChoice === 'credit'} onChange={() => setRefundChoice('credit')} />
                                Credit ({refund.options.credit.pct}%{refund.options.credit.validityDays ? `, ${Math.round(refund.options.credit.validityDays / 365)}yr` : ''})
                              </span>
                              <span className="font-medium">{money(refund.options.credit.cents, refund.currency)}</span>
                            </label>
                          )}
                          {refundChoice === 'cash' && !refund.hasPaymentRef && (
                            <p className="text-amber-700 text-xs">No Stripe payment reference on file — this will be flagged for a manual refund.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-3 pt-1">
                    <button onClick={() => setOpen(false)} className="text-sm text-brand-muted-soft hover:text-brand-muted px-3 py-1.5">Cancel</button>
                    <button
                      onClick={doDelete}
                      disabled={loading || !hardConfirmed || !refundReady}
                      className="bg-red-600 text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
                    >
                      {loading ? 'Deleting…' : mode === 'hard' ? 'Permanently delete' : 'Soft-delete'}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </>
  )
}
