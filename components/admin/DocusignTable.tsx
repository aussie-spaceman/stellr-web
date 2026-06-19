'use client'

import { useState } from 'react'
import { formatDateShort } from '@/lib/utils'

export interface EnvelopeRow {
  id: string
  envelope_id: string
  status: string
  envelope_type?: string
  signer_name: string
  signer_email: string
  minor_name: string
  event_title: string
  event_slug: string
  sent_at: string
  completed_at: string | null
  declined_at: string | null
  reminder_sent_at: string | null
  participant_id: string
  member_id: string | null
  reused_from?: string | null
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  sent:      { label: 'Awaiting signature', cls: 'bg-amber-100 text-amber-700'  },
  delivered: { label: 'Viewed',             cls: 'bg-brand-blue/10 text-brand-blue'    },
  completed: { label: 'Signed',             cls: 'bg-green-100 text-green-700'  },
  declined:  { label: 'Declined',           cls: 'bg-red-100 text-red-600'      },
  voided:    { label: 'Voided',             cls: 'bg-brand-hairline text-brand-muted-soft'    },
  // Coverage rows: participant covered by previously signed paperwork
  // (3-year validity) instead of receiving a new envelope.
  on_file:   { label: 'On file',            cls: 'bg-teal-100 text-teal-700'    },
}

function StatusBadge({ status }: { status: string }) {
  const { label, cls } = STATUS_STYLES[status] ?? { label: status, cls: 'bg-brand-hairline text-brand-muted-soft' }
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return formatDateShort(iso)
}

const FILTER_OPTIONS = ['all', 'sent', 'delivered', 'completed', 'declined', 'voided'] as const

function fmtExpiry(completedAt: string): { label: string; cls: string } {
  const expires = new Date(completedAt)
  expires.setFullYear(expires.getFullYear() + 3)
  const now = new Date()
  if (expires < now) return { label: 'Expired', cls: 'text-red-600 font-medium' }
  const months = Math.round((expires.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30))
  const years  = Math.floor(months / 12)
  const rem    = months % 12
  const label  = years > 0 ? (rem > 0 ? `${years}yr ${rem}mo` : `${years}yr`) : `${months}mo`
  const cls    = months < 6 ? 'text-amber-600 font-medium' : 'text-brand-muted-soft'
  return { label: `${label} (${formatDateShort(expires)})`, cls }
}

export function DocusignTable({ initial }: { initial: EnvelopeRow[] }) {
  const [envelopes, setEnvelopes]   = useState(initial)
  const [filter, setFilter]         = useState<string>('all')
  const [resending, setResending]   = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [msg, setMsg]               = useState<{ text: string; error: boolean } | null>(null)

  async function handleDownload(env: EnvelopeRow) {
    setDownloading(env.id)
    try {
      const res = await fetch(`/api/admin/docusigns/${env.id}/download`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      const prefix = env.envelope_type === 'adult' || env.envelope_type === 'mentor' ? 'agreement' : 'consent'
      a.download = `${prefix}-${env.minor_name.replace(/\s+/g, '-').toLowerCase()}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Download failed', error: true })
    } finally {
      setDownloading(null)
    }
  }

  async function handleResend(env: EnvelopeRow) {
    setResending(env.id)
    setMsg(null)
    try {
      const res  = await fetch(`/api/admin/docusigns/${env.id}/resend`, { method: 'POST' })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Resend failed')
      setEnvelopes(prev =>
        prev.map(e => e.id === env.id ? { ...e, reminder_sent_at: new Date().toISOString() } : e),
      )
      setMsg({ text: `Reminder re-sent for ${env.minor_name}.`, error: false })
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Failed to resend', error: true })
    } finally {
      setResending(null)
    }
  }

  const filtered = filter === 'all' ? envelopes : envelopes.filter(e => e.status === filter)
  const countFor = (s: string) => envelopes.filter(e => e.status === s).length

  return (
    <div className="space-y-4">
      {/* Status filter pills */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
              filter === s
                ? 'bg-brand-blue text-white border-brand-blue'
                : 'bg-white text-brand-muted border-brand-border hover:border-brand-border'
            }`}
          >
            {s === 'all' ? `All (${envelopes.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${countFor(s)})`}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`text-sm rounded-lg px-4 py-2 border ${
          msg.error
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-brand-blue/5 border-brand-blue/30 text-brand-blue'
        }`}>
          {msg.text}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-brand-border p-10 text-center text-sm text-brand-muted-soft">
          No consent forms{filter !== 'all' ? ` with status "${filter}"` : ''}.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-brand-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-hairline bg-brand-canvas text-left">
                {['Participant', 'Type', 'Event', 'Signer', 'Status', 'Sent', 'Signed', 'Expires', ''].map(h => (
                  <th key={h} className="px-4 py-3 font-medium text-brand-muted-soft text-xs uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {filtered.map(env => (
                <tr key={env.id} className="hover:bg-brand-canvas">
                  <td className="px-4 py-3 font-medium text-brand-blue-dark whitespace-nowrap">{env.minor_name}</td>
                  <td className="px-4 py-3 text-brand-muted-soft text-xs whitespace-nowrap capitalize">{env.envelope_type ?? 'minor'}</td>
                  <td className="px-4 py-3 text-brand-muted max-w-[200px]">
                    <span className="block truncate" title={env.event_title}>{env.event_title}</span>
                  </td>
                  <td className="px-4 py-3 text-brand-muted">
                    <div className="font-medium">{env.signer_name}</div>
                    <div className="text-xs text-brand-muted-soft">{env.signer_email}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={env.reused_from ? 'on_file' : env.status} /></td>
                  <td className="px-4 py-3 text-brand-muted-soft text-xs whitespace-nowrap">
                    {env.reused_from ? (
                      <div className="text-brand-muted-soft">Not sent — covered by prior signing</div>
                    ) : (
                      <>
                        <div>{fmt(env.sent_at)}</div>
                        {env.reminder_sent_at && (
                          <div className="text-brand-muted-soft mt-0.5">Reminded {fmt(env.reminder_sent_at)}</div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-brand-muted-soft text-xs whitespace-nowrap">{fmt(env.completed_at)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {env.completed_at
                      ? (() => { const { label, cls } = fmtExpiry(env.completed_at); return <span className={cls}>{label}</span> })()
                      : <span className="text-brand-muted-soft">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                    {env.status === 'completed' && (
                      <button
                        onClick={() => handleDownload(env)}
                        disabled={downloading === env.id}
                        className="text-xs text-brand-blue hover:text-brand-blue font-medium disabled:opacity-50"
                      >
                        {downloading === env.id ? 'Downloading…' : 'Download PDF'}
                      </button>
                    )}
                    {env.status !== 'completed' && env.status !== 'voided' && (
                      <button
                        onClick={() => handleResend(env)}
                        disabled={resending === env.id}
                        className="text-xs text-brand-blue hover:text-brand-blue font-medium disabled:opacity-50"
                      >
                        {resending === env.id ? 'Sending…' : 'Re-send'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
