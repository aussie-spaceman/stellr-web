'use client'

import { useEffect, useState } from 'react'

interface Envelope {
  id: string
  status: string
  signer_name: string
  signer_email: string
  minor_name: string
  event_title: string
  sent_at: string
  completed_at: string | null
  reminder_sent_at: string | null
}

interface Props {
  dateOfBirth?: string | null
  eventRole?: string | null
  initialEnvelopes?: Envelope[]
  adminDownload?: boolean
}

export const ENVELOPE_STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Awaiting signature', cls: 'bg-amber-100 text-amber-700' },
  delivered: { label: 'Viewed',             cls: 'bg-blue-100 text-blue-700'   },
  completed: { label: 'Signed',             cls: 'bg-green-100 text-green-700' },
  declined:  { label: 'Declined',           cls: 'bg-red-100 text-red-600'     },
  voided:    { label: 'Voided',             cls: 'bg-gray-100 text-gray-500'   },
}

export function EnvelopeStatusBadge({ status }: { status: string }) {
  const { label, cls } = ENVELOPE_STATUS_STYLES[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

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
  soon:    'text-amber-600 font-medium',
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

  async function handleDownload(id: string, minorName: string) {
    setDownloading(id)
    const downloadUrl = adminDownload
      ? `/api/admin/docusigns/${id}/download`
      : `/api/members/docusigns/${id}/download`
    try {
      const res = await fetch(downloadUrl)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `consent-${minorName.replace(/\s+/g, '-').toLowerCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setDownloading(null)
    }
  }

  if (loading || envelopes.length === 0) return null

  const graduated  = memberHasGraduated(dateOfBirth, eventRole)
  const hasPending = envelopes.some(e => e.status === 'sent' || e.status === 'delivered')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">Parental Consent Forms</h2>
      <p className="text-xs text-gray-500 mb-4">Sent to your parent or guardian via DocuSign.</p>

      {graduated && (
        <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
          You are no longer registered as a school student. Historical consent records are kept below
          for reference. Future registrations as a mentor or adult do not require parental consent.
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {envelopes.map(env => {
          const expiry    = env.completed_at ? getExpiryInfo(env.completed_at) : null
          const showExpiry = expiry && !graduated

          return (
            <div key={env.id} className="flex items-start justify-between gap-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{env.event_title}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sent to {env.signer_name} &middot; {env.signer_email}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {fmt(env.sent_at)}
                  {env.completed_at && <> &middot; Signed {fmt(env.completed_at)}</>}
                </p>
                {showExpiry && (
                  <p className={`text-xs mt-1 ${URGENCY_CLS[expiry.urgency]}`}>{expiry.label}</p>
                )}
                {graduated && (
                  <p className="text-xs text-gray-400 mt-1 italic">Historical record</p>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0 mt-0.5">
                <EnvelopeStatusBadge status={env.status} />
                {env.status === 'completed' && (
                  <button
                    onClick={() => handleDownload(env.id, env.minor_name)}
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

      {hasPending && !graduated && (
        <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
          A reminder will be sent automatically if the form isn&apos;t signed within 7 days.
        </p>
      )}
    </div>
  )
}
