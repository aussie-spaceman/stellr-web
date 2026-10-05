'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDateShort } from '@/lib/utils'
import {
  describeEnvelope,
  describeMissingEnvelope,
  roleLabel,
  PILL_CLASSES,
  type RecipientLike,
} from '@/lib/docusign-status'
import type { VolunteerAgreementRecord } from '@/lib/volunteer'
import { CorrectSignerEmailButton } from '@/components/admin/CorrectSignerEmailButton'

export interface MemberAgreement {
  /** Null when no Volunteer / Mentor agreement has ever been issued. */
  envelope: VolunteerAgreementRecord | null
  recipients: RecipientLike[]
}

const OPEN = new Set(['created', 'sent', 'delivered'])

// Volunteer Agreement status for mentors and volunteers (the mentor document —
// see lib/docusign.ts createVolunteerAgreementEnvelope). Sits beside the
// Background Check panel. Issued automatically when the member is assigned to an
// event; the button here covers a declined, voided or expired agreement.
export function MemberAgreementPanel({
  memberId,
  agreement,
}: {
  memberId: string
  /** Null when the member is not a mentor or volunteer (panel hidden). */
  agreement: MemberAgreement | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!agreement) return null

  const { envelope, recipients } = agreement
  const desc = envelope ? describeEnvelope(envelope, recipients) : describeMissingEnvelope(true)
  const inFlight = !!envelope && OPEN.has(envelope.status)
  const signed = !!envelope && envelope.status === 'completed'
  const expired = signed && !!envelope.expires_at && new Date(envelope.expires_at) <= new Date()
  const pill = expired ? { label: 'Expired', cls: PILL_CLASSES.declined } : { label: desc.label, cls: PILL_CLASSES[desc.pill] }

  async function post(url: string) {
    setBusy(true)
    setError('')
    const res = await fetch(url, { method: 'POST' })
    setBusy(false)
    if (!res.ok) {
      const d = await res.json().catch(() => null)
      setError(d?.error ?? 'Action failed.')
      return
    }
    router.refresh()
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide">Volunteer Agreement</h2>
        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${pill.cls}`}>{pill.label}</span>
      </div>

      {envelope ? (
        <div className="text-sm space-y-1">
          {envelope.sent_at && (
            <div className="flex justify-between">
              <span className="text-brand-muted-soft">Sent</span>
              <span className="text-brand-blue-dark">{formatDateShort(envelope.sent_at)}</span>
            </div>
          )}
          {envelope.completed_at && (
            <div className="flex justify-between">
              <span className="text-brand-muted-soft">Signed</span>
              <span className="text-brand-blue-dark">{formatDateShort(envelope.completed_at)}</span>
            </div>
          )}
          {envelope.expires_at && (
            <div className="flex justify-between">
              <span className="text-brand-muted-soft">Valid until</span>
              <span className="text-brand-blue-dark">{formatDateShort(envelope.expires_at)}</span>
            </div>
          )}
          {recipients.length > 0 && (
            <ul className="pt-2 space-y-0.5">
              {recipients.map((r) => (
                <li key={`${r.email}-${r.role_name}`} className="flex justify-between text-xs">
                  <span className="text-brand-muted-soft capitalize">{roleLabel(r.role_name)}</span>
                  <span className={r.status === 'completed' ? 'text-green-600 font-medium' : 'text-brand-muted'}>
                    {r.status === 'completed' ? 'Signed' : r.status === 'autoresponded' ? 'Email bounced' : r.status === 'declined' ? 'Declined' : 'Waiting'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {desc.detail && !expired && <p className="text-xs text-brand-muted-soft pt-1">{desc.detail}.</p>}
        </div>
      ) : (
        <p className="text-xs text-brand-muted-soft">
          Not issued yet. It goes out automatically when this member is assigned to an event.
        </p>
      )}

      <div className="pt-3 flex gap-3">
        {inFlight && !envelope.reused_from && (
          <button
            onClick={() => post(`/api/admin/docusigns/${envelope.id}/resend`)}
            disabled={busy}
            className="text-xs font-medium text-brand-blue hover:text-brand-blue-dark disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Resend'}
          </button>
        )}
        {envelope && (envelope.status === 'sent' || envelope.status === 'delivered') && !envelope.reused_from && (
          <CorrectSignerEmailButton agreementId={envelope.id} />
        )}
        {(!envelope || (!inFlight && (!signed || expired))) && (
          <button
            onClick={() => {
              if (confirm('Send the Volunteer Agreement to this member by DocuSign?'))
                post(`/api/admin/members/${memberId}/volunteer-agreement`)
            }}
            disabled={busy}
            className="text-xs font-medium text-white bg-brand-blue hover:bg-brand-blue-dark disabled:opacity-50 rounded-lg px-3 py-1.5"
          >
            {busy ? 'Sending…' : envelope ? 'Re-issue agreement' : 'Issue agreement'}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
    </div>
  )
}
