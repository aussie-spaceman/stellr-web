'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button, Field, Input } from '@stellr/web-ui'
import { ExternalLink, X } from 'lucide-react'

// "Invoice & discount…" on an invoiced group in the event roster: the group's
// current invoice, every invoice issued for it and why, and a discount code an
// admin can apply. Applying revises the open invoice (Stripe voids the old one
// and emails the organiser the new one) and is kept for later revisions after
// roster changes. Nothing is sent until "Send revised invoice".
// Server: /api/admin/registrations/[id]/invoice.

interface HistoryRow {
  stripe_invoice_id: string
  stripe_invoice_number: string | null
  kind: 'seats' | 'additional'
  status: string
  seats: number
  total_cents: number
  currency: string
  reason: string | null
  created_at: string
}

interface Summary {
  mode: string
  seats: number
  roster: number
  perSeatCents: number | null
  currency: string
  discount: { code: string | null; couponId: string } | null
  current: { id: string; number: string | null; status: string; totalCents: number; hostedUrl: string | null } | null
  history: HistoryRow[]
}

interface Preview { label: string; summary: string }

const money = (cents: number, currency = 'usd') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-enviro-green-bg text-enviro-green-text',
  open: 'bg-pathway-amber-bg text-pathway-amber-deep',
  void: 'bg-surface text-content-muted',
}

export function GroupInvoiceButton({ registrationId, groupLabel }: { registrationId: string; groupLabel: string }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // Rendered into <body> so the roster header's styles don't leak in.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function load() {
    const res = await fetch(`/api/admin/registrations/${registrationId}/invoice`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not load this group’s invoices.')
      return
    }
    setSummary(data as Summary)
  }

  async function open() {
    setSummary(null)
    setPreview(null)
    setError(null)
    setDone(null)
    setCode('')
    dialog.current?.showModal()
    await load()
  }

  async function post(body: Record<string, string>) {
    // A double-click must not send two revisions.
    if (busy) return null
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/registrations/${registrationId}/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'That didn’t work.')
      return null
    }
    return data
  }

  async function previewCode() {
    setPreview(null)
    const data = await post({ action: 'preview', code })
    if (data) setPreview(data as Preview)
  }

  async function apply(action: 'apply' | 'remove') {
    const data = await post(action === 'apply' ? { action, code } : { action })
    if (!data) return
    setDone(data.message as string)
    setPreview(null)
    setCode('')
    await load()
    router.refresh()
  }

  const editable = summary?.current?.status === 'open'

  return (
    <>
      <button type="button" onClick={open} className="text-xs font-medium normal-case text-primary hover:text-primary-deep">
        Invoice &amp; discount…
      </button>
      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-xl rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Group invoice</h2>
              <p className="mt-1 text-sm text-content-secondary">{groupLabel}</p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-5 px-5 py-4">
            {!summary && !error && <p className="text-sm text-content-secondary">Loading invoices…</p>}

            {summary && (
              <section className="space-y-1 text-sm">
                <p>
                  <strong>{summary.seats}</strong> {summary.seats === 1 ? 'place' : 'places'}, {summary.roster} on the roster
                  {summary.perSeatCents != null && <> · {money(summary.perSeatCents, summary.currency)} each</>}
                </p>
                {summary.current ? (
                  <p className="flex flex-wrap items-center gap-2">
                    Current invoice {summary.current.number ?? summary.current.id}:
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[summary.current.status] ?? 'bg-surface text-content-muted'}`}>
                      {summary.current.status}
                    </span>
                    <strong>{money(summary.current.totalCents, summary.currency)}</strong>
                    {summary.current.hostedUrl && (
                      <a href={summary.current.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:text-primary-deep">
                        View <ExternalLink size={14} aria-hidden />
                      </a>
                    )}
                  </p>
                ) : (
                  <p className="text-content-secondary">No invoice has been sent yet. Use “Finish setup…” to send it.</p>
                )}
              </section>
            )}

            {summary?.current && (
              <section className="space-y-3 rounded-control border border-line p-3">
                <h3 className="text-sm font-semibold">Discount</h3>
                {summary.discount && (
                  <p className="flex flex-wrap items-center gap-3 text-sm">
                    Applied: <strong>{summary.discount.code ?? summary.discount.couponId}</strong>
                    {editable && (
                      <button type="button" disabled={busy} onClick={() => apply('remove')} className="text-xs font-medium text-danger hover:underline disabled:opacity-50">
                        Remove discount
                      </button>
                    )}
                  </p>
                )}
                {editable ? (
                  <>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Discount code" className="min-w-48 flex-1">
                        <Input
                          id={`discount-${registrationId}`}
                          value={code}
                          // As typed: promotion codes match in any case, coupon ids only exactly.
                          onChange={(e) => { setCode(e.target.value); setPreview(null) }}
                          placeholder="e.g. STEMCAREERS"
                          autoComplete="off"
                        />
                      </Field>
                      <Button variant="secondary" className="!px-4 !py-2" disabled={!code.trim() || busy} onClick={previewCode}>
                        Preview
                      </Button>
                    </div>
                    {preview && (
                      <div className="space-y-3 text-sm">
                        <p><strong>{preview.label}</strong>: {preview.summary}</p>
                        <div className="flex justify-end">
                          <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy} onClick={() => apply('apply')}>
                            {busy ? 'Sending…' : 'Send revised invoice'}
                          </Button>
                        </div>
                        <p className="text-xs text-content-secondary">
                          The organiser is emailed the revised invoice and the current one is cancelled.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-content-secondary">
                    The invoice is {summary.current.status}, so it can’t be changed here.
                  </p>
                )}
              </section>
            )}

            {done && <p role="status" className="text-sm text-enviro-green-text">{done}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            {summary && summary.history.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold">History</h3>
                <ul className="divide-y divide-line text-sm">
                  {[...summary.history].reverse().map((h) => (
                    <li key={h.stripe_invoice_id} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-content-secondary">{new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        <span>{h.stripe_invoice_number ?? h.stripe_invoice_id}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[h.status] ?? 'bg-surface text-content-muted'}`}>{h.status}</span>
                        <span className="ml-auto font-medium">{money(h.total_cents, h.currency)}</span>
                      </div>
                      <p className="text-xs text-content-secondary">
                        {h.kind === 'additional' ? 'Additional places' : 'Group invoice'} · {h.seats} {h.seats === 1 ? 'place' : 'places'}
                        {h.reason ? ` · ${h.reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
