'use client'

import { useState } from 'react'

// Account settings: quote and photo/media permissions (V2.3 §1.7).
export function PrivacyPrefsForm({
  initial,
  readOnly = false,
}: {
  initial: { allowQuotes: boolean; allowMedia: boolean; quotesDefault: boolean }
  readOnly?: boolean
}) {
  const [quotes, setQuotes] = useState(initial.allowQuotes)
  const [media, setMedia] = useState(initial.allowMedia)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: { allow_quotes?: boolean; allow_media?: boolean }) => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/members/privacy-prefs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      if (!res.ok) setError('Failed to save — please try again.')
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const Switch = ({ on, label, help, onChange }: { on: boolean; label: string; help: string; onChange: (v: boolean) => void }) => (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-brand-blue-dark">{label}</p>
        <p className="text-xs text-brand-muted-soft">{help}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => !readOnly && onChange(!on)}
        disabled={saving || readOnly}
        className={['relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors', on ? 'bg-brand-blue-dark' : 'bg-brand-border'].join(' ')}
      >
        <span className={['inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : ''].join(' ')} />
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
      <Switch
        on={quotes}
        label="Allow Stellr to quote my survey responses"
        help="Only answers marked “may be quoted”, as your first name, last initial, grade and school or state."
        onChange={(v) => {
          setQuotes(v)
          void save({ allow_quotes: v })
        }}
      />
      <Switch
        on={media}
        label="Allow photo and media use"
        help="Photos and video of you at Stellr events in Stellr materials."
        onChange={(v) => {
          setMedia(v)
          void save({ allow_media: v })
        }}
      />
      <p className="text-xs text-brand-muted-soft">If your parent or guardian opted out on your agreement, that still applies whatever these say.</p>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}
