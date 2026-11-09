'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@stellr/web-ui'
import { X } from 'lucide-react'

// "Fix email" in Your group: a group organiser fixes a consent-form address that
// bounced, and approves or rejects a student's suggested parent/guardian
// address. Same form, signatures kept. Server:
// /api/members/teams/[id]/participants/[pid]/correct-email and
// /api/members/teams/[id]/email-changes/[changeId] (lib/esign/email-changes.ts).

interface Bounced {
  recipientId: string
  roleName: string | null
  roleLabel: string
  name: string | null
  email: string | null
}

interface Pending {
  id: string
  recipientId: string
  roleLabel: string
  oldEmail: string
  newEmail: string
  suggestedBy: string
  sameAsSuggester: boolean
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function FixSignerEmailButton({
  registrationId,
  participantId,
  participantName,
  label = 'Fix email',
  onChanged,
}: {
  registrationId: string
  participantId: string
  participantName: string
  label?: string
  onChanged?: (message: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [bounced, setBounced] = useState<Bounced[] | null>(null)
  const [pending, setPending] = useState<Pending[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const base = `/api/members/teams/${registrationId}`

  async function load() {
    const res = await fetch(`${base}/participants/${participantId}/correct-email`, { cache: 'no-store' })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not load the form.')
      return
    }
    setBounced(data.bounced as Bounced[])
    setPending(data.pending as Pending[])
    setDrafts(Object.fromEntries((data.bounced as Bounced[]).map((b) => [b.recipientId, ''])))
  }

  async function open() {
    setError(null)
    setDone(null)
    setBounced(null)
    dialog.current?.showModal()
    await load()
  }

  async function save(b: Bounced) {
    const email = (drafts[b.recipientId] ?? '').trim()
    setBusy(b.recipientId)
    setError(null)
    setDone(null)
    const res = await fetch(`${base}/participants/${participantId}/correct-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: b.recipientId, email }),
    })
    const data = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) {
      setError(data?.error ?? 'The change did not go through.')
      return
    }
    const message = `The ${b.roleLabel}'s form was sent again to ${data.email}.`
    setDone(message)
    onChanged?.(message)
    await load()
  }

  async function decide(p: Pending, decision: 'approve' | 'reject') {
    setBusy(p.id)
    setError(null)
    setDone(null)
    const res = await fetch(`${base}/email-changes/${p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    const data = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) {
      setError(data?.error ?? 'That did not go through.')
      return
    }
    const message = decision === 'approve' ? `Approved: the form was sent to ${p.newEmail}.` : 'Suggestion rejected.'
    setDone(message)
    onChanged?.(message)
    await load()
  }

  return (
    <>
      <button type="button" onClick={open} className="text-xs font-medium text-danger hover:text-primary-deep">
        {label}
      </button>
      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-lg rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
          onClose={() => setBounced(null)}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Fix an email on {participantName}&apos;s form</h2>
              <p className="mt-1 text-sm text-content-secondary">
                Give the right address and the form is sent to it again. Signatures already given are kept. Stellr
                and the other signer on the form are told about the change.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            {!bounced && !error && <p className="text-sm text-content-secondary">Loading…</p>}

            {pending.map((p) => (
              <div key={p.id} className="rounded-control border border-line p-3">
                <p className="text-sm font-semibold">Suggested {p.roleLabel} email</p>
                <p className="mt-1 text-sm text-content-body">
                  The {p.suggestedBy} suggested <strong>{p.newEmail}</strong> in place of {p.oldEmail}, which bounced.
                  Check it with the family before you approve.
                </p>
                {p.sameAsSuggester && (
                  <p className="mt-2 text-xs text-gold-ink">
                    This is the {p.suggestedBy}&apos;s own address. A parent or guardian needs their own, so this can&apos;t
                    be approved here.
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="secondaryStrong" className="!px-4 !py-2" disabled={busy !== null} onClick={() => decide(p, 'reject')}>
                    Reject
                  </Button>
                  <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy !== null || p.sameAsSuggester} onClick={() => decide(p, 'approve')}>
                    {busy === p.id ? 'Saving…' : 'Approve and send'}
                  </Button>
                </div>
              </div>
            ))}

            {bounced && bounced.length === 0 && pending.length === 0 && (
              <p className="text-sm text-content-secondary">No address on this form needs fixing.</p>
            )}

            {(bounced ?? []).map((b) => {
              const draft = (drafts[b.recipientId] ?? '').trim()
              return (
                <div key={b.recipientId} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{capitalise(b.roleLabel)}: {b.name}</p>
                    <span className="text-xs text-danger">Email bounced</span>
                  </div>
                  <p className="mt-1 text-xs text-content-secondary">Bounced: {b.email}</p>
                  <label className="mt-2 block text-xs text-content-secondary">
                    New email
                    <input
                      type="email"
                      autoComplete="off"
                      value={drafts[b.recipientId] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [b.recipientId]: e.target.value }))}
                      className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-input mouse:text-sm text-ink"
                    />
                  </label>
                  <div className="mt-3 flex justify-end">
                    <Button variant="primaryStrong" className="!px-4 !py-2" disabled={!draft || busy !== null} onClick={() => save(b)}>
                      {busy === b.recipientId ? 'Saving…' : 'Save and send'}
                    </Button>
                  </div>
                </div>
              )
            })}
            {done && <p role="status" className="text-sm text-enviro-green-text">{done}</p>}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  )
}
