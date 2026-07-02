'use client'

import { useState } from 'react'
import { Orbit, Environment } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'

// Serializable view of a campaign passed from server components.
export interface CampaignOption {
  slug: string
  title: string
  theme: 'space' | 'enviro'
  themeLabel: string
  seasonLabel: string
  deadlineLabel: string
}

// Where the modal was opened from. 'signup' skips the "recognised membership"
// banner (the account was just created in the same flow).
export type RegContext = 'member' | 'signup' | 'events'

interface Props {
  open: boolean
  onClose: () => void
  campaign: CampaignOption | null
  regContext: RegContext
  /** Recognised membership shown as a green banner (all contexts except signup). */
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
  defaultGroupName?: string
  defaultStudentCount?: number | null
  defaultRole?: string
  /** Fired after a successful registration (e.g. to mark the card registered). */
  onRegistered?: (slug: string) => void
}

const ThemeIcon = ({ theme, className }: { theme: 'space' | 'enviro'; className?: string }) =>
  theme === 'enviro' ? <Environment className={className} /> : <Orbit className={className} />

export function CampaignRegistrationModal({
  open,
  onClose,
  campaign,
  regContext,
  membership,
  defaultGroupName = '',
  defaultStudentCount = null,
  defaultRole = 'Teacher',
  onRegistered,
}: Props) {
  const [step, setStep] = useState(0) // 0 details · 1 review · 2 success
  const [groupName, setGroupName] = useState(defaultGroupName)
  const [studentCount, setStudentCount] = useState<string>(
    defaultStudentCount != null ? String(defaultStudentCount) : '',
  )
  const [role, setRole] = useState(defaultRole)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!campaign) return null

  const close = () => {
    onClose()
    // Reset a beat later so the closing animation isn't jarring.
    setTimeout(() => {
      setStep(0)
      setError(null)
      setSubmitting(false)
    }, 200)
  }

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/campaigns/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignSlug: campaign.slug,
          groupName: groupName.trim(),
          studentCount: studentCount ? Number(studentCount) : null,
          role: role.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not complete registration.')
        return
      }
      onRegistered?.(campaign.slug)
      setStep(2)
      toast('Registration confirmed — email sent')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const canContinue = groupName.trim().length > 0

  const header = (
    <span className="inline-flex items-center gap-1.5 rounded-pill bg-pathway-amber-bg px-3 py-1 text-xs font-bold uppercase tracking-[0.05em] text-pathway-amber">
      ✦ Campaign · Async
    </span>
  )

  return (
    <Modal
      open={open}
      onClose={close}
      maxWidth={560}
      title={
        <span className="flex flex-col gap-2">
          {header}
          <span className="font-heading text-[20px] text-ink">
            {step === 2 ? "You're registered" : 'Register a group for a Campaign'}
          </span>
        </span>
      }
      footer={
        step === 2 ? (
          <Button href={`/campaigns/${campaign.slug}`} variant="primary">
            Go to my campaigns
          </Button>
        ) : (
          <>
            {step === 1 && (
              <Button variant="softBlue" onClick={() => setStep(0)}>
                Back
              </Button>
            )}
            <Button
              variant="primary"
              onClick={step === 0 ? () => canContinue && setStep(1) : submit}
              className={
                (step === 0 && !canContinue) || submitting ? 'pointer-events-none opacity-50' : ''
              }
            >
              {step === 0 ? 'Continue' : submitting ? 'Confirming…' : 'Confirm registration'}
            </Button>
          </>
        )
      }
    >
      {/* Progress bar — amber active / grey idle */}
      <div className="mb-5 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-pill ${i <= step ? 'bg-pathway-amber' : 'bg-line'}`}
          />
        ))}
      </div>

      {/* ── Step 0: details ─────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-4">
          {regContext !== 'signup' && membership?.schoolName && (
            <div className="rounded-ds-card bg-enviro-green-bg px-4 py-3 text-sm text-enviro-green-text">
              We recognised your membership — <strong>{membership.schoolName}</strong>
              {membership.roleLabel ? ` · ${membership.roleLabel}` : ''} (free). No account needed.
            </div>
          )}

          <CampaignSummary campaign={campaign} />

          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-content">Group / class name</span>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Yr 11 Engineering"
              className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-content">Approx. students</span>
              <input
                inputMode="numeric"
                value={studentCount}
                onChange={(e) => setStudentCount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="12"
                className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-content">Your role</span>
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Teacher"
                className="w-full rounded-control border border-line px-3 py-2.5 text-sm text-content outline-none focus:border-primary"
              />
            </label>
          </div>
        </div>
      )}

      {/* ── Step 1: review & confirm ────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <dl className="overflow-hidden rounded-ds-card border border-line text-sm">
            <ReviewRow label="Campaign" value={campaign.title} />
            <ReviewRow label="Group" value={groupName} shaded />
            <ReviewRow label="Proposal deadline" value={campaign.deadlineLabel} />
            <ReviewRow label="Format" value="Asynchronous · submit online" shaded />
          </dl>
          <div className="rounded-ds-card border border-pathway-amber-bg bg-pathway-amber-bg px-4 py-3 text-sm text-pathway-amber">
            <strong>No payment required.</strong> Campaigns are included with your membership — unlike
            ticketed Events.
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}

      {/* ── Step 2: success ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="py-2 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-enviro-green-bg">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-enviro-green" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h3 className="font-heading text-lg text-ink">You&apos;re registered</h3>
          <p className="mt-1 text-sm text-content-secondary">
            Proposals are due {campaign.deadlineLabel}. We&apos;ve emailed your confirmation.
          </p>
        </div>
      )}
    </Modal>
  )
}

function CampaignSummary({ campaign }: { campaign: CampaignOption }) {
  return (
    <div className="flex items-center gap-3 rounded-ds-card border border-line px-3 py-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-white ${
          campaign.theme === 'enviro' ? 'bg-enviro-green' : 'bg-space-violet'
        }`}
      >
        <ThemeIcon theme={campaign.theme} className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate font-heading text-sm text-ink">{campaign.title}</p>
        <p className="text-xs text-content-muted">
          ✦ {campaign.themeLabel} · {campaign.seasonLabel} · Deadline {campaign.deadlineLabel}
        </p>
      </div>
    </div>
  )
}

function ReviewRow({ label, value, shaded }: { label: string; value: string; shaded?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 px-4 py-2.5 ${shaded ? 'bg-surface' : ''}`}>
      <dt className="font-semibold text-content-secondary">{label}</dt>
      <dd className="text-right text-content">{value}</dd>
    </div>
  )
}
