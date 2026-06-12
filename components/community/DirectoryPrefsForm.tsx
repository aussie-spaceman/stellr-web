'use client'

import { useState } from 'react'

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
      <label className="flex items-center justify-between gap-4 cursor-pointer">
        <div>
          <p className="text-sm font-medium text-gray-900">Show me in the member directory</p>
          <p className="text-xs text-gray-500">Other members can find you at /community/members</p>
        </div>
        <button
          role="switch"
          aria-checked={isVisible}
          onClick={() => toggle(setIsVisible, 'is_visible', !isVisible)}
          disabled={saving || readOnly}
          className={[
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none',
            isVisible ? 'bg-gray-900' : 'bg-gray-200',
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-4 w-4 translate-x-1 rounded-full bg-white shadow transition-transform',
              isVisible ? 'translate-x-6' : '',
            ].join(' ')}
          />
        </button>
      </label>

      {isVisible && (
        <div className="ml-1 space-y-2 border-l-2 border-gray-100 pl-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showSchool}
              onChange={(e) => toggle(setShowSchool, 'show_school', e.target.checked)}
              disabled={saving || readOnly}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Show my school</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showRegion}
              onChange={(e) => toggle(setShowRegion, 'show_region', e.target.checked)}
              disabled={saving || readOnly}
              className="rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">Show my region / state</span>
          </label>
        </div>
      )}

      {saved && <p className="text-xs text-green-600">Saved.</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
