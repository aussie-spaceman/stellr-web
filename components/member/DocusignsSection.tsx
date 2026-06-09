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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { label: string; cls: string }> = {
    sent:      { label: 'Awaiting signature', cls: 'bg-amber-100 text-amber-700'  },
    delivered: { label: 'Viewed',             cls: 'bg-blue-100 text-blue-700'    },
    completed: { label: 'Signed',             cls: 'bg-green-100 text-green-700'  },
    declined:  { label: 'Declined',           cls: 'bg-red-100 text-red-600'      },
    voided:    { label: 'Voided',             cls: 'bg-gray-100 text-gray-500'    },
  }
  const { label, cls } = styles[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500' }
  return <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span>
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function DocusignsSection() {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [loading, setLoading]     = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/members/docusigns')
      .then(r => r.json())
      .then(data => setEnvelopes(data.envelopes ?? []))
      .finally(() => setLoading(false))
  }, [])

  async function handleDownload(id: string) {
    setDownloading(id)
    try {
      const res = await fetch(`/api/members/docusigns/${id}/download`)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'consent-form.pdf'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setDownloading(null)
    }
  }

  if (loading || envelopes.length === 0) return null

  const hasPending = envelopes.some(e => e.status === 'sent' || e.status === 'delivered')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-base font-semibold text-gray-900 mb-1">Parental Consent Forms</h2>
      <p className="text-xs text-gray-500 mb-4">Sent to your parent or guardian via DocuSign.</p>

      <div className="space-y-0 divide-y divide-gray-100">
        {envelopes.map(env => (
          <div key={env.id} className="flex items-start justify-between gap-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-gray-900">{env.event_title}</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Sent to {env.signer_name} &middot; {env.signer_email}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">
                {fmt(env.sent_at)}
                {env.completed_at && <> · Signed {fmt(env.completed_at)}</>}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 mt-0.5">
              <StatusBadge status={env.status} />
              {env.status === 'completed' && (
                <button
                  onClick={() => handleDownload(env.id)}
                  disabled={downloading === env.id}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-50"
                >
                  {downloading === env.id ? 'Downloading…' : 'Download PDF'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {hasPending && (
        <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
          A reminder will be sent automatically if the form isn&apos;t signed within 7 days.
        </p>
      )}
    </div>
  )
}
