'use client'

import { useEffect, useState } from 'react'
import { formatDateShort } from '@/lib/utils'

interface Envelope {
  id: string
  status: string
  envelope_type?: string
  signer_name: string
  signer_email: string
  minor_name: string
  event_title: string
  sent_at: string
  completed_at: string | null
  reminder_sent_at: string | null
  reused_from?: string | null
  signers_total?: number | null
  signers_completed?: number | null
}

const TYPE_LABEL: Record<string, string> = {
  minor:  'Parental Consent',
  adult:  'Participation Agreement',
  mentor: 'Mentor Participation Agreement',
}

interface Props {
  dateOfBirth?: string | null
  eventRole?: string | null
  initialEnvelopes?: Envelope[]
  adminDownload?: boolean
}

export const ENVELOPE_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Awaiting signature', cls: 'bg-brand-orange/10 text-brand-gold-ink' },
  delivered: { label: 'Viewed',             cls: 'bg-brand-blue/10 text-brand-blue'   },
  completed: { label: 'Signed',             cls: 'bg-green-100 text-green-700' },
  declined:  { label: 'Declined',           cls: 'bg-red-100 text-red-600'     },
  voided:    { label: 'Voided',             cls: 'bg-brand-hairline text-brand-muted-soft'   },
  // Coverage rows: the participant was covered by previously signed paperwork
  // (3-year validity) instead of receiving a new envelope.
  on_file:   { label: 'On file',            cls: 'bg-teal-100 text-teal-700'   },
}

export function EnvelopeStatusBadge({ status }: { status: string }) {
  const { label, cls } = ENVELOPE_STATUS_STYLES[status] ?? { label: status, cls: 'bg-brand-hairline text-brand-muted-soft' }
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

// Signer-progress pill — mirrors the Event Management roster logic so the portal
// and admin event views agree: issued (red), partially complete (orange, some
// but not all signers done), complete (green); plus declined (red), voided
// (gray), on-file (teal). Needs signers_total / signers_completed (migration
// 032) to surface the partial state; falls back to the flat status otherwise.
function EnvelopeProgressBadge({ env }: { env: Envelope }) {
  const total = env.signers_total ?? 1
  const completed = env.signers_completed ?? 0

  let label: string
  let cls: string
  if (env.reused_from) {
    label = 'On file'; cls = 'bg-teal-100 text-teal-700'
  } else if (env.status === 'completed') {
    label = 'Complete'; cls = 'bg-green-100 text-green-700'
  } else if (env.status === 'declined') {
    label = 'Declined'; cls = 'bg-red-100 text-red-600'
  } else if (env.status === 'voided') {
    label = 'Voided'; cls = 'bg-brand-hairline text-brand-muted-soft'
  } else if (completed > 0 && completed < total) {
    label = `Partially complete · ${completed} of ${total} signed`; cls = 'bg-orange-100 text-orange-700'
  } else {
    label = 'Issued'; cls = 'bg-red-100 text-red-600'
  }
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

const fmt = formatDateShort

function isStillMinor(dob: string | null | undefined): boolean {
  if (!dob) return false
  const d = new Date(dob)
  const eighteenth = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate())
  return new Date() < eighteenth
}

function memberHasGraduated(dob: string | null | undefined, role: string | null | undefined): boolean {
  if (!isStillMinor(dob)) return true
  if (role && role !== 'school_student') return true
  return false
}

function getExpiryInfo(completedAt: string): { label: string; urgency: 'ok' | 'soon' | 'expired' } {
  const expires = new Date(completedAt)
  expires.setFullYear(expires.getFullYear() + 3)
  const now = new Date()
  if (expires <= now) return { label: 'Expired', urgency: 'expired' }
  const totalDays   = Math.round((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const totalMonths = Math.round(totalDays / 30)
  const years       = Math.floor(totalMonths / 12)
  const rem         = totalMonths % 12
  const countdown   = years > 0 ? (rem > 0 ? `${years}yr ${rem}mo` : `${years}yr`) : `${totalMonths}mo`
  return {
    label:   `Expires in ${countdown} · ${fmt(expires.toISOString())}`,
    urgency: totalMonths < 6 ? 'soon' : 'ok',
  }
}

const URGENCY_CLS: Record<string, string> = {
  ok:      'text-green-600',
  soon:    'text-brand-gold-ink font-medium',
  expired: 'text-red-600 font-medium',
}

export function DocusignsSection({ dateOfBirth, eventRole, initialEnvelopes, adminDownload }: Props = {}) {
  const [envelopes, setEnvelopes]     = useState<Envelope[]>(initialEnvelopes ?? [])
  const [loading, setLoading]         = useState(!initialEnvelopes)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    if (initialEnvelopes) return
    fetch('/api/members/docusigns')
      .then(r => r.json())
      .then(data => setEnvelopes(data.envelopes ?? []))
      .finally(() => setLoading(false))
  }, [initialEnvelopes])

  async function handleDownload(id: string, subjectName: string, type?: string) {
    setDownloading(id)
    const downloadUrl = adminDownload
      ? `/api/admin/docusigns/${id}/download`
      : `/api/members/docusigns/${id}/download`
    const prefix = type === 'adult' || type === 'mentor' ? 'agreement' : 'consent'
    try {
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${prefix}-${subjectName.replace(/\s+/g, '-').toLowerCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setDownloading(null)
    }
  }

  if (loading || envelopes.length === 0) return null

  const graduated      = memberHasGraduated(dateOfBirth, eventRole)
  const hasMinorForms  = envelopes.some(e => (e.envelope_type ?? 'minor') === 'minor')
  const hasPending     = envelopes.some(e => e.status === 'sent' || e.status === 'delivered')

  return (
    <div className="bg-white rounded-xl border border-brand-border p-6">
      <h2 className="text-base font-semibold text-brand-blue-dark mb-1">Agreements &amp; Consent Forms</h2>
      <p className="text-xs text-brand-muted-soft mb-4">Your DocuSign participation agreements and parental consent forms.</p>

      {graduated && hasMinorForms && (
        <div className="mb-4 rounded-lg bg-brand-blue/5 border border-brand-blue/30 px-4 py-3 text-xs text-brand-blue">
          You are no longer registered as a school student. Historical consent records are kept below
          for reference. Future registrations as a mentor or adult do not require parental consent.
        </div>
      )}

      <div className="divide-y divide-brand-hairline">
        {envelopes.map(env => {
          const type       = env.envelope_type ?? 'minor'
          const isMinorEnv = type === 'minor'
          const expiry     = env.completed_at ? getExpiryInfo(env.completed_at) : null
          // Hide expiry only on historical minor consent (the member has aged out);
          // adult/mentor agreements always show their current expiry.
          const showExpiry = expiry && !(isMinorEnv && graduated)

          return (
            <div key={env.id} className="flex items-start justify-between gap-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-blue-dark">{env.event_title}</p>
                <p className="text-xs text-brand-muted-soft mt-0.5">{TYPE_LABEL[type] ?? 'Agreement'}</p>
                {isMinorEnv && (
                  <div className="text-xs text-brand-muted-soft mt-0.5 space-y-0.5">
                    <p>Parent / guardian: {env.signer_name} &middot; {env.signer_email}</p>
                    {env.minor_name && <p>Participant: {env.minor_name}</p>}
                  </div>
                )}
                <p className="text-xs text-brand-muted-soft mt-0.5">
                  {env.reused_from ? (
                    <>Covered by paperwork signed {env.completed_at ? fmt(env.completed_at) : '—'} &middot; no new signature was needed</>
                  ) : (
                    <>
                      {fmt(env.sent_at)}
                      {env.completed_at && <> &middot; Signed {fmt(env.completed_at)}</>}
                    </>
                  )}
                </p>
                {showExpiry && (
                  <p className={`text-xs mt-1 ${URGENCY_CLS[expiry.urgency]}`}>{expiry.label}</p>
                )}
                {isMinorEnv && graduated && (
                  <p className="text-xs text-brand-muted-soft mt-1 italic">Historical record</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 mt-0.5">
                <EnvelopeProgressBadge env={env} />
                {env.status === 'completed' && (
                  <button
                    onClick={() => handleDownload(env.id, env.minor_name, type)}
                    disabled={downloading === env.id}
                    className="text-xs text-brand-blue hover:text-brand-blue-dark font-medium disabled:opacity-50"
                  >
                    {downloading === env.id ? 'Downloading…' : 'Download PDF'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {hasPending && (
        <p className="text-xs text-brand-muted-soft mt-4 pt-3 border-t border-brand-hairline">
          A reminder will be sent automatically if the form isn&apos;t signed within 7 days.
        </p>
      )}
    </div>
  )
}
