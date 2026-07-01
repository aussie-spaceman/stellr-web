'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Clock, UserCheck, XCircle } from 'lucide-react'
import type { CoachingRequest, CoachingEligibility, CoachOption } from '@/lib/coaching-requests'

const STATUS_META: Record<CoachingRequest['status'], { label: string; className: string; Icon: typeof Clock }> = {
  pending: { label: 'Pending', className: 'bg-[#FDEFD6] text-brand-gold-ink', Icon: Clock },
  matched: { label: 'Matched', className: 'bg-primary-soft text-primary', Icon: UserCheck },
  scheduled: { label: 'Scheduled', className: 'bg-enviro-green-bg text-enviro-green-text', Icon: Check },
  declined: { label: 'Declined', className: 'bg-[#F6EDED] text-[#B4443B]', Icon: XCircle },
}

const ELIGIBILITY_OPTIONS: { value: CoachingEligibility; label: string }[] = [
  { value: 'included', label: 'Included (tier allowance)' },
  { value: 'award', label: 'Award (grant a free session)' },
  { value: 'paid', label: 'Paid (pay per session)' },
]

const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export function CoachingRequestQueue({ requests, coaches }: { requests: CoachingRequest[]; coaches: CoachOption[] }) {
  if (requests.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-white py-14 text-center text-sm text-content-muted">
        No coaching requests yet. Member requests from the Academy will appear here.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {requests.map((r) => (
        <RequestRow key={r.id} req={r} coaches={coaches} />
      ))}
    </div>
  )
}

function RequestRow({ req, coaches }: { req: CoachingRequest; coaches: CoachOption[] }) {
  const router = useRouter()
  const [coachId, setCoachId] = useState('')
  const [eligibility, setEligibility] = useState<CoachingEligibility | ''>('')
  const [busy, setBusy] = useState<null | 'match' | 'decline'>(null)
  const [error, setError] = useState<string | null>(null)
  const meta = STATUS_META[req.status]

  const match = async () => {
    if (!coachId) return setError('Select a coach.')
    if (!eligibility) return setError('Select an eligibility.')
    setBusy('match')
    setError(null)
    try {
      const res = await fetch(`/api/admin/coaching/requests/${req.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, eligibility }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not match.')
        setBusy(null)
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong.')
      setBusy(null)
    }
  }

  const decline = async () => {
    const reason = window.prompt('Reason for declining (shown to the member):') ?? ''
    setBusy('decline')
    setError(null)
    try {
      const res = await fetch(`/api/admin/coaching/requests/${req.id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not decline.')
        setBusy(null)
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong.')
      setBusy(null)
    }
  }

  return (
    <div className="rounded-card border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-[16px] font-bold text-ink">{req.memberName ?? 'Member'}</p>
            <span className={`inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 text-[11px] font-bold ${meta.className}`}>
              <meta.Icon className="h-3 w-3" /> {meta.label}
            </span>
            {req.eligibility && (
              <span className="inline-flex items-center rounded-pill bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-content-secondary">
                {req.eligibility}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-content-muted">
            {req.memberEmail ?? '—'} · requested {fmtDate(req.createdAt)}
          </p>
        </div>
        {req.coachName && <p className="text-[13px] text-content-secondary">Coach: <span className="font-semibold text-ink">{req.coachName}</span></p>}
      </div>

      <div className="mt-3 rounded-panel bg-surface p-3.5">
        <p className="text-[14.5px] text-ink">{req.topic}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-content-muted">
          {req.stage && <span>Stage: {req.stage}</span>}
          {req.focusArea && <span>Focus: {req.focusArea}</span>}
          {req.availability.length > 0 && <span>Free: {req.availability.join(', ')}</span>}
        </div>
        {req.note && <p className="mt-1.5 text-[13px] italic text-content-secondary">“{req.note}”</p>}
        {req.status === 'scheduled' && req.session && (
          <p className="mt-1.5 text-[12.5px] font-semibold text-enviro-green-text">Booked for {fmtDate(req.session.start)}</p>
        )}
      </div>

      {req.status === 'pending' && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-content-secondary">
            Coach
            <select
              value={coachId}
              onChange={(e) => setCoachId(e.target.value)}
              className="min-w-[160px] rounded-[8px] border border-line bg-white px-3 py-2 text-sm text-ink"
            >
              <option value="">Select a coach…</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? 'Coach'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-content-secondary">
            Eligibility
            <select
              value={eligibility}
              onChange={(e) => setEligibility(e.target.value as CoachingEligibility)}
              className="min-w-[200px] rounded-[8px] border border-line bg-white px-3 py-2 text-sm text-ink"
            >
              <option value="">Select…</option>
              {ELIGIBILITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={match}
            disabled={busy !== null}
            className="rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-50"
          >
            {busy === 'match' ? 'Matching…' : 'Confirm match'}
          </button>
          <button
            onClick={decline}
            disabled={busy !== null}
            className="rounded-[8px] border border-line px-4 py-2 text-sm font-semibold text-content-secondary hover:border-[#B4443B] hover:text-[#B4443B] disabled:opacity-50"
          >
            {busy === 'decline' ? 'Declining…' : 'Decline'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}
    </div>
  )
}
