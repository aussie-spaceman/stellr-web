'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { X } from 'lucide-react'

// "Finish setup…" on a group in the event roster: shows what a cut-off group
// registration is still missing (sheet, join link, invoice, confirmation email,
// agreements and logins), lets the admin choose, then runs only those steps.
// Nothing is sent until "Run selected". Server:
// /api/admin/registrations/[id]/finish-setup.

type Step = 'sheet' | 'join_link' | 'invoice' | 'confirmation' | 'follow_up'
interface Item { step: Step; needed: boolean; summary: string }

const LABEL: Record<Step, string> = {
  sheet: 'Google Sheet',
  join_link: 'Join link',
  invoice: 'Stripe invoice',
  confirmation: 'Confirmation email',
  follow_up: 'Agreements, accounts and clearance notice',
}

export function FinishSetupButton({ registrationId, groupLabel }: { registrationId: string; groupLabel: string }) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [items, setItems] = useState<Item[] | null>(null)
  const [chosen, setChosen] = useState<Set<Step>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string> | null>(null)
  // Rendered into <body> so the roster header's styles don't leak in.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function open() {
    setItems(null)
    setResults(null)
    setError(null)
    dialog.current?.showModal()
    const res = await fetch(`/api/admin/registrations/${registrationId}/finish-setup`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not check this registration.')
      return
    }
    const list = data.items as Item[]
    setItems(list)
    setChosen(new Set(list.filter((i) => i.needed).map((i) => i.step)))
  }

  async function run() {
    // A double-click must not run anything twice.
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/admin/registrations/${registrationId}/finish-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: [...chosen] }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setError(data?.error ?? 'Setup did not run.')
      return
    }
    setResults(data.results as Record<string, string>)
    router.refresh()
  }

  const toggle = (step: Step) =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(step)) next.delete(step)
      else next.add(step)
      return next
    })

  return (
    <>
      <button type="button" onClick={open} className="text-xs font-medium normal-case text-primary hover:text-primary-deep">
        Finish setup…
      </button>
      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-lg rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Finish registration setup</h2>
              <p className="mt-1 text-sm text-content-secondary">
                {groupLabel}. For a registration that was cut off before everything went out. Steps already done are
                skipped, so nothing is sent twice.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>
          <div className="space-y-3 px-5 py-4">
            {!items && !error && <p className="text-sm text-content-secondary">Checking what&rsquo;s missing…</p>}
            {items && !results && items.map((i) => (
              <label key={i.step} className="flex items-start gap-3 rounded-control border border-line p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={chosen.has(i.step)}
                  onChange={() => toggle(i.step)}
                />
                <span>
                  <span className="block text-sm font-semibold">{LABEL[i.step]}</span>
                  <span className="block text-xs text-content-secondary">{i.summary}</span>
                </span>
              </label>
            ))}
            {items && !results && (
              <div className="flex justify-end">
                <Button variant="primaryStrong" className="!px-4 !py-2" disabled={chosen.size === 0 || busy} onClick={run}>
                  {busy ? 'Running…' : 'Run selected'}
                </Button>
              </div>
            )}
            {results && (
              <ul role="status" className="space-y-1 text-sm">
                {Object.entries(results).map(([step, outcome]) => (
                  <li key={step}><strong>{LABEL[step as Step] ?? step}:</strong> {outcome}</li>
                ))}
              </ul>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
