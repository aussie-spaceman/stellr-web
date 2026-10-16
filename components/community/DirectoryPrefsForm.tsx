'use client'

import { useId, useState } from 'react'
import { Choice } from '@stellr/web-ui'

interface Props {
  initial: {
    is_visible: boolean
    show_school: boolean
    show_region: boolean
  }
  // Admin "view as member": render the member's current prefs but disable the
  // controls so the admin can't mutate their own directory record.
  readOnly?: boolean
}

// Opt-in controls for the member directory (FR-COM-04).
// Rendered on the account profile page so members control their own visibility.
export function DirectoryPrefsForm({ initial, readOnly = false }: Props) {
  const [isVisible, setIsVisible] = useState(initial.is_visible)
  const [showSchool, setShowSchool] = useState(initial.show_school)
  const [showRegion, setShowRegion] = useState(initial.show_region)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uid = useId()

  const save = async (overrides?: Partial<typeof initial>) => {
    setSaving(true)
    setSaved(false)
    setError(null)
    const body = {
      is_visible: isVisible,
      show_school: showSchool,
      show_region: showRegion,
      ...overrides,
    }
    try {
      const res = await fetch('/api/members/directory-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) setError('Failed to save — please try again.')
      else setSaved(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const toggle = (
    setter: (v: boolean) => void,
    field: keyof typeof initial,
    value: boolean
  ) => {
    if (readOnly) return
    setter(value)
    save({ [field]: value })
  }

  return (
    <div className="space-y-3">
      {/* The label names the switch and tapping it flips the switch, as before;
          it no longer wraps the button, which left the switch unnamed. */}
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={`${uid}-switch`} className="min-w-0 cursor-pointer">
          <span id={`${uid}-title`} className="block text-sm font-medium text-brand-blue-dark">
            Show me in the member directory
          </span>
          <span id={`${uid}-hint`} className="block text-xs text-brand-muted-soft">
            Other members can find you at /community/members
          </span>
        </label>
        <button
          id={`${uid}-switch`}
          type="button"
          role="switch"
          aria-checked={isVisible}
          aria-labelledby={`${uid}-title`}
          aria-describedby={`${uid}-hint`}
          onClick={() => toggle(setIsVisible, 'is_visible', !isVisible)}
          disabled={saving || readOnly}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none',
            'focus-visible:ring-2 focus-visible:ring-primary-deep focus-visible:ring-offset-2',
            isVisible ? 'bg-brand-blue-dark' : 'bg-brand-border',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform',
              isVisible ? 'translate-x-6' : '',
            ].join(' ')}
          />
        </button>
      </div>

      {isVisible && (
        <div className="ml-1 border-l-2 border-brand-hairline pl-4">
          <Choice
            checked={showSchool}
            onChange={(e) => toggle(setShowSchool, 'show_school', e.target.checked)}
            disabled={saving || readOnly}
            label="Show my school"
          />
          <Choice
            checked={showRegion}
            onChange={(e) => toggle(setShowRegion, 'show_region', e.target.checked)}
            disabled={saving || readOnly}
            label="Show my region / state"
          />
        </div>
      )}

      <div aria-live="polite">
        {saved && <p className="text-xs text-green-600">Saved.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}
