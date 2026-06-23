'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'

const REASONS = [
  { value: 'spam', label: 'Spam or promotion' },
  { value: 'harassment', label: 'Harassment or abuse' },
  { value: 'off-topic', label: 'Off-topic' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'other', label: 'Other' },
] as const

interface Props {
  open: boolean
  onClose: () => void
  contentType: 'post' | 'comment' | 'resource'
  contentId: string
  /** Resource filename / post label, for the title. */
  label?: string
  /** Called after a successful submit so the caller can show a "Reported" chip. */
  onReported?: () => void
}

// Report/flag modal (screen 08) for posts and resources. Sends to the space's
// admin Moderation queue. Submit is disabled until a reason is chosen.
export function FlagModal({ open, onClose, contentType, contentId, label, onReported }: Props) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const title =
    contentType === 'resource' ? `Report ${label ?? 'this file'}` : 'Report this post'

  const submit = async () => {
    if (!reason) return
    setSubmitting(true)
    const reasonLabel = REASONS.find((r) => r.value === reason)?.label ?? reason
    const res = await fetch('/api/community/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contentType,
        contentId,
        reason: note.trim() ? `${reasonLabel} — ${note.trim()}` : reasonLabel,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      toast('Could not submit report')
      return
    }
    toast('Report sent to a moderator')
    onReported?.()
    reset()
    onClose()
  }

  const reset = () => {
    setReason('')
    setNote('')
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={title}
      subtitle="Your report is sent to a moderator. Reports are confidential."
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              reset()
              onClose()
            }}
            className="rounded-lg border border-brand-border px-4 py-2 text-sm font-subheading font-semibold text-brand-muted hover:bg-brand-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reason || submitting}
            className="rounded-lg px-4 py-2 text-sm font-subheading font-semibold text-white disabled:opacity-50"
            style={{ background: '#C0392B' }}
          >
            {submitting ? 'Sending…' : 'Submit report'}
          </button>
        </>
      }
    >
      <fieldset className="space-y-2">
        {REASONS.map((r) => (
          <label
            key={r.value}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
              reason === r.value
                ? 'border-brand-blue text-brand-blue-dark'
                : 'border-brand-border text-brand-muted hover:bg-brand-canvas'
            }`}
            style={reason === r.value ? { background: '#EAF0FE' } : undefined}
          >
            <input
              type="radio"
              name="flag-reason"
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="accent-brand-blue"
            />
            {r.label}
          </label>
        ))}
      </fieldset>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        maxLength={500}
        placeholder="Add a note (optional)"
        className="mt-3 w-full rounded-lg border border-brand-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
      />
    </Modal>
  )
}
