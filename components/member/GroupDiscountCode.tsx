'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Field, Input } from '@stellr/web-ui'

// The discount code on an invoiced group's invoice, in Account → Teams. A card
// checkout has Stripe's own code box; an invoice has none, so this is that box.
// Check a code, see the new total, then send the revised invoice. Server:
// app/api/members/teams/[id]/discount.

interface View {
  applies: boolean
  code?: string | null
  invoice?: { totalCents: number; currency: string; status: string; hostedUrl: string | null } | null
  lockedReason?: string | null
  canChange?: boolean
  readOnlyNote?: string | null
}

interface Preview { label: string; summary: string }

const money = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

export function GroupDiscountCode({ registrationId, onChanged }: { registrationId: string; onChanged?: () => void }) {
  const endpoint = `/api/members/teams/${registrationId}/discount`
  const [view, setView] = useState<View | null>(null)
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(endpoint)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'We couldn’t load your invoice.')
      return
    }
    setView(data as View)
  }, [endpoint])

  useEffect(() => { void load() }, [load])

  async function send(body: Record<string, string>) {
    // A double-click must not send two revised invoices.
    if (busy) return null
    setBusy(true)
    setError(null)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'That didn’t work. Nothing was changed.')
      return null
    }
    return data
  }

  async function check() {
    setDone(null)
    const data = await send({ action: 'preview', code: code.trim() })
    if (data) setPreview({ label: data.label as string, summary: data.summary as string })
  }

  async function change(action: 'apply' | 'remove') {
    const data = await send(action === 'apply' ? { action, code: code.trim() } : { action })
    if (!data) return
    setDone(data.message as string)
    setPreview(null)
    setCode('')
    await load()
    onChanged?.()
  }

  // Groups paying by card or individually enter codes at their own checkout.
  if (!view?.applies && !error) return null

  const editable = !!view && view.canChange !== false && !view.lockedReason

  return (
    <section className="rounded-control border border-line bg-white px-4 py-3 text-sm" aria-label="Discount code">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-content-secondary">Discount code</p>
          <p className="font-medium text-ink">
            {view?.code ?? 'None on your invoice'}
            {view?.invoice && (
              <span className="font-normal text-content-secondary"> · invoice total {money(view.invoice.totalCents, view.invoice.currency)}</span>
            )}
          </p>
        </div>
        {editable && view?.code && (
          <Button variant="secondary" className="!px-4 !py-2" disabled={busy} onClick={() => change('remove')}>
            {busy && !preview ? 'Removing…' : 'Remove code'}
          </Button>
        )}
      </div>

      {editable && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label={view?.code ? 'Use a different code' : 'Have a discount code?'} className="min-w-48 flex-1">
              <Input
                id={`discount-code-${registrationId}`}
                value={code}
                onChange={(e) => { setCode(e.target.value); setPreview(null); setError(null) }}
                placeholder="e.g. STEMCAREERS"
                autoComplete="off"
                disabled={busy}
              />
            </Field>
            <Button variant="secondary" className="!px-4 !py-2" disabled={!code.trim() || busy} onClick={check}>
              Check code
            </Button>
          </div>
          {preview && (
            <div className="space-y-2 rounded-control bg-surface p-3">
              <p><strong>{preview.label}</strong>: {preview.summary}</p>
              <p className="text-xs text-content-secondary">
                We’ll email you a revised invoice with the discount. The invoice you have now is cancelled, so send the new one to your school.
              </p>
              <div className="flex justify-end">
                <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy} onClick={() => change('apply')}>
                  {busy ? 'Sending…' : 'Apply and send revised invoice'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {view && !editable && (view.readOnlyNote ?? view.lockedReason) && (
        <p className="mt-2 text-xs text-content-secondary">{view.readOnlyNote ?? view.lockedReason}</p>
      )}
      {done && <p role="status" className="mt-2 text-xs text-enviro-green-text">{done}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  )
}
