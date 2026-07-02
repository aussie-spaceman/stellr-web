'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Upload, FileText } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { toast } from '@/components/ui/Toast'

interface Props {
  slug: string
  title: string
  deadlineLabel: string
  groupName: string
  initialFileName?: string | null
}

export function SubmitProposalForm({ slug, title, deadlineLabel, groupName, initialFileName }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ fileName: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (!file) return
    setSubmitting(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      if (notes.trim()) body.append('notes', notes.trim())
      const res = await fetch(`/api/campaigns/${slug}/submit`, { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not submit your proposal.')
        return
      }
      setDone({ fileName: data.fileName ?? file.name })
      toast('Confirmation email sent to your inbox')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="space-y-6">
        <div className="rounded-panel border border-line bg-white p-8 text-center shadow-card-lift">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-enviro-green-bg">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-enviro-green" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h1 className="font-heading text-ds-h2 font-bold text-ink">Proposal submitted</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-content-secondary">
            Your proposal for the {title} is in. A confirmation has been emailed to you.
          </p>
        </div>

        {/* Rendered confirmation-email preview */}
        <div className="rounded-panel border border-line bg-white p-5">
          <div className="flex items-start gap-3 border-b border-line-light pb-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-control bg-ink text-white">
              <FileText className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs text-content-muted">From Stellr Education</p>
              <p className="font-heading font-bold text-ink">Proposal received — {title}</p>
            </div>
          </div>
          <div className="pt-4 text-sm leading-relaxed text-content-secondary">
            <p>Hi {groupName},</p>
            <p className="mt-3">
              We&apos;ve received your team&apos;s proposal ({done.fileName}). Judging opens after the{' '}
              {deadlineLabel} deadline and results follow within three weeks. You can replace your
              submission any time before then from the app.
            </p>
            <p className="mt-3">— The Stellr team</p>
          </div>
        </div>

        <Button href={`/campaigns/${slug}`} variant="softBlue">
          ← Back to campaign
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href={`/campaigns/${slug}`} className="text-sm text-content-muted hover:text-content">
        ← Campaign
      </Link>

      <div className="overflow-hidden rounded-panel border border-line border-t-4 border-t-pathway-amber bg-white p-6 shadow-card-lift">
        <span className="inline-flex items-center rounded-pill bg-pathway-amber-bg px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] text-pathway-amber">
          ✦ Campaign proposal
        </span>
        <h1 className="mt-4 font-heading text-ds-h2 font-bold text-ink">Submit your proposal</h1>
        <p className="mt-1 text-sm text-content-secondary">
          {title} · due {deadlineLabel}
        </p>

        {/* Dropzone */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-6 flex w-full flex-col items-center justify-center rounded-ds-card border-2 border-dashed border-line bg-surface px-6 py-10 text-center transition-colors hover:border-primary"
        >
          {file ? (
            <>
              <FileText className="h-7 w-7 text-primary" />
              <p className="mt-2 font-heading font-bold text-ink">{file.name}</p>
              <p className="text-xs text-content-muted">Ready to submit · click to replace</p>
            </>
          ) : (
            <>
              <Upload className="h-7 w-7 text-content-muted" />
              <p className="mt-2 font-heading font-bold text-ink">Drop your file or click to upload</p>
              <p className="text-xs text-content-muted">PDF, slides or doc · up to 25 MB</p>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.ppt,.pptx,.doc,.docx,.key,.odp,.odt"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {initialFileName && !file && (
          <p className="mt-2 text-xs text-content-muted">
            Current submission: {initialFileName}. Uploading a new file replaces it.
          </p>
        )}

        {/* Notes */}
        <label className="mt-6 block">
          <span className="mb-1 block text-sm font-semibold text-content">Notes for the judges (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Anything you want the judges to know — assumptions, what you'd do with more time…"
            className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
          />
        </label>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex items-center gap-4">
          <Button
            variant="primary"
            onClick={submit}
            className={!file || submitting ? 'pointer-events-none opacity-50' : ''}
          >
            {submitting ? 'Submitting…' : 'Submit proposal'}
          </Button>
          <p className="text-xs text-content-muted">You&apos;ll get a confirmation email once it&apos;s in.</p>
        </div>
      </div>
    </div>
  )
}
