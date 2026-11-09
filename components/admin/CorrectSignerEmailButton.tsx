'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'
import { X } from 'lucide-react'

// "Correct email" on a live agreement: fixes a signer's address (a typo, a
// bounce) on the SAME envelope. Unlike Reissue it keeps any signature already
// given and uses none of DocuSign's 40 monthly envelopes. The participant
// record is corrected with it. Server: /api/admin/agreements/[id]/correct-recipient.

interface Signer {
  recipientId: string
  roleName: string | null
  name: string
  email: string
  status: string
  routingOrder: number | null
}

const ROLE_LABEL: Record<string, string> = {
  Guardian: 'Parent / guardian',
  Minor: 'Student',
  Adult: 'Participant',
  Mentor: 'Mentor',
  Volunteer: 'Volunteer',
  Member: 'Member',
  StellrRepresentative: 'Stellr Education',
}

const STATUS_LABEL: Record<string, string> = {
  autoresponded: 'Email bounced',
  created: 'Queued (sent after the earlier signer)',
  sent: 'Sent, not opened',
  delivered: 'Opened, not signed',
}

// Signers whose address can still change.
const OPEN = new Set(['created', 'sent', 'delivered', 'autoresponded'])

/** A student's suggested parent/guardian address for a bounced one (lib/esign/email-changes.ts). */
interface Suggestion {
  id: string
  roleLabel: string
  oldEmail: string
  newEmail: string
  suggestedBy: string
  sameAsSuggester: boolean
}

export function CorrectSignerEmailButton({
  agreementId,
  emphasise = false,
  className,
}: {
  agreementId: string
  /** Shown as the main action (a bounced address) rather than a quiet link. */
  emphasise?: boolean
  className?: string
}) {
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const [signers, setSigners] = useState<Signer[] | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // The dialog renders into <body>: inside a table cell it inherits the cell's
  // nowrap and spacing, which pushed it off-centre and clipped its text.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  async function open() {
    setError(null)
    setDone(null)
    dialog.current?.showModal()
    await load()
  }

  async function load() {
    const res = await fetch(`/api/admin/agreements/${agreementId}/correct-recipient`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(data?.error ?? 'Could not load the signers.')
      return
    }
    setSigners(data.recipients as Signer[])
    setSuggestions((data.pending ?? []) as Suggestion[])
    setDrafts(Object.fromEntries((data.recipients as Signer[]).map((s) => [s.recipientId, s.email])))
  }

  async function decide(s: Suggestion, decision: 'approve' | 'reject') {
    setBusy(s.id)
    setError(null)
    setDone(null)
    const res = await fetch(`/api/admin/agreements/${agreementId}/email-changes/${s.id}`, {
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
    setDone(decision === 'approve' ? `Approved: the form was sent to ${s.newEmail}.` : 'Suggestion rejected.')
    await load()
    router.refresh()
  }

  async function save(s: Signer) {
    const email = (drafts[s.recipientId] ?? '').trim()
    setBusy(s.recipientId)
    setError(null)
    setDone(null)
    const res = await fetch(`/api/admin/agreements/${agreementId}/correct-recipient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: s.recipientId, email }),
    })
    const data = await res.json().catch(() => null)
    setBusy(null)
    if (!res.ok) {
      setError(data?.error ?? 'The correction did not go through.')
      return
    }
    const updated = data.recipient as Signer
    setSigners((prev) => prev?.map((x) => (x.recipientId === s.recipientId ? { ...x, ...updated } : x)) ?? null)
    setDone(
      `${ROLE_LABEL[s.roleName ?? ''] ?? 'Signer'} now ${updated.email}.` +
        (updated.status === 'created' ? ' It is sent when their turn comes.' : ' The signing email has been sent.') +
        (data.participantSkipped ? ` Note: ${data.participantSkipped}.` : '') +
        (data.previouslyBounced ? ' Warning: this address has bounced before, so the form may not arrive.' : ''),
    )
    router.refresh()
  }

  const editable = (signers ?? []).filter((s) => OPEN.has(s.status) && s.roleName !== 'StellrRepresentative')
  const others = (s: Signer) => (signers ?? []).filter((x) => x.recipientId !== s.recipientId)

  return (
    <>
      <button
        type="button"
        onClick={open}
        className={`text-xs font-medium ${emphasise ? 'text-danger' : 'text-primary'} hover:text-primary-deep ${className ?? ''}`}
      >
        Correct email
      </button>
      {mounted && createPortal(
        <dialog
          ref={dialog}
          className="w-[calc(100%-2rem)] max-w-lg rounded-ds-card border border-line p-0 text-left text-ink shadow-featured backdrop:bg-ink/40"
          onClose={() => setSigners(null)}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-heading text-lg font-semibold">Correct a signer&apos;s email</h2>
              <p className="mt-1 text-sm text-content-secondary">
                Fixes the address on the same envelope. Signatures already collected are kept, and no new
                envelope is used. The participant record is updated too.
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={() => dialog.current?.close()} className="text-content-muted hover:text-ink">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4 px-5 py-4">
            {!signers && !error && <p className="text-sm text-content-secondary">Loading signers…</p>}
            {suggestions.map((s) => (
              <div key={s.id} className="rounded-control border border-line bg-surface p-3">
                <p className="text-sm font-semibold">Suggested {s.roleLabel} email</p>
                <p className="mt-1 text-sm text-content-body">
                  The {s.suggestedBy} suggested <strong>{s.newEmail}</strong> in place of {s.oldEmail}, which bounced.
                </p>
                {s.sameAsSuggester && (
                  <p className="mt-2 text-xs text-gold-ink">
                    This is the {s.suggestedBy}&apos;s own address. Approve only if you have confirmed the family shares one inbox.
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="secondaryStrong" className="!px-4 !py-2" disabled={busy !== null} onClick={() => decide(s, 'reject')}>
                    Reject
                  </Button>
                  <Button variant="primaryStrong" className="!px-4 !py-2" disabled={busy !== null} onClick={() => decide(s, 'approve')}>
                    {busy === s.id ? 'Saving…' : 'Approve and send'}
                  </Button>
                </div>
              </div>
            ))}
            {signers && editable.length === 0 && (
              <p className="text-sm text-content-secondary">Nobody on this agreement is left to sign, so there is nothing to correct.</p>
            )}
            {editable.map((s) => {
              const draft = (drafts[s.recipientId] ?? '').trim()
              const changed = draft.toLowerCase() !== s.email.toLowerCase()
              const shared = changed && others(s).some((o) => o.email.toLowerCase() === draft.toLowerCase())
              return (
                <div key={s.recipientId} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {ROLE_LABEL[s.roleName ?? ''] ?? s.roleName ?? 'Signer'}: {s.name}
                    </p>
                    <span className={`text-xs ${s.status === 'autoresponded' ? 'text-danger' : 'text-content-muted'}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </span>
                  </div>
                  <label className="mt-2 block text-xs text-content-secondary">
                    Email
                    <input
                      type="email"
                      value={drafts[s.recipientId] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.recipientId]: e.target.value }))}
                      className="mt-1 w-full rounded-control border border-line-strong px-3 py-2 text-input mouse:text-sm text-ink"
                    />
                  </label>
                  {shared && (
                    <p className="mt-2 text-xs text-gold-ink">
                      Another signer on this agreement uses this address. Both forms will go to one inbox; make sure
                      the family knows to sign both.
                    </p>
                  )}
                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="primaryStrong"
                      className="!px-4 !py-2"
                      disabled={!changed || !draft || busy !== null}
                      onClick={() => save(s)}
                    >
                      {busy === s.recipientId ? 'Saving…' : 'Save and send'}
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
