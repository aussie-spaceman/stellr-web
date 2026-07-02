'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'

interface Props {
  slug: string
  campaignTitle: string
  recipientCount: number
}

// Admin "Email everyone" composer — subject + message sent to all teachers /
// student managers registered in the campaign.
export function CampaignEmailComposer({ slug, campaignTitle, recipientCount }: Props) {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/campaigns/${slug}/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not send.')
        return
      }
      setOpen(false)
      setSubject('')
      setMessage('')
      toast(`Email sent to ${data.sent ?? recipientCount} recipients`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const canSend = subject.trim() && message.trim() && !sending

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Mail className="mr-1.5 inline h-4 w-4" /> Email everyone
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={560}
        title="Email everyone"
        subtitle={`To: ${recipientCount} recipient${recipientCount === 1 ? '' : 's'} — all teachers & student managers registered in ${campaignTitle}`}
        footer={
          <>
            <Button variant="softBlue" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={send}
              className={!canSend ? 'pointer-events-none opacity-50' : ''}
            >
              {sending ? 'Sending…' : `Send to ${recipientCount} people`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-content">Subject</span>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-content">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={7}
              className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </Modal>
    </>
  )
}
