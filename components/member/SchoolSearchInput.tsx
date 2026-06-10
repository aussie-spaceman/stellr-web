'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

const US_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado',
  'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho',
  'Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana',
  'Maine','Maryland','Massachusetts','Michigan','Minnesota',
  'Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New Hampshire','New Jersey','New Mexico','New York',
  'North Carolina','North Dakota','Ohio','Oklahoma','Oregon',
  'Pennsylvania','Rhode Island','South Carolina','South Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington',
  'West Virginia','Wisconsin','Wyoming',
]

interface DbSchool {
  id: string
  name: string
  city: string | null
  state: string | null
}

export interface NewSchoolData {
  name: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  postcode: string
}

export type SchoolSelection =
  | { type: 'existing'; id: string; name: string }
  | { type: 'new'; data: NewSchoolData }

interface Props {
  onChange: (selection: SchoolSelection | null) => void
}

export function SchoolSearchInput({ onChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DbSchool[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<'search' | 'selected' | 'adding'>('search')
  const [selectedName, setSelectedName] = useState('')
  const [newSchool, setNewSchool] = useState<NewSchoolData>({
    name: '', address_line1: '', address_line2: '', city: '', state: '', postcode: '',
  })
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const runSearch = useCallback((q: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (q.length < 2) {
      setResults([])
      setDropdownOpen(false)
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.schools ?? [])
        setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  function handleQueryChange(value: string) {
    setQuery(value)
    onChange(null)
    runSearch(value)
  }

  function handleSelectExisting(school: DbSchool) {
    setMode('selected')
    setSelectedName(school.name)
    setDropdownOpen(false)
    setResults([])
    onChange({ type: 'existing', id: school.id, name: school.name })
  }

  function handleClearSelection() {
    setMode('search')
    setSelectedName('')
    setQuery('')
    setResults([])
    onChange(null)
  }

  function handleAddNew() {
    setDropdownOpen(false)
    setMode('adding')
    setNewSchool({ name: query, address_line1: '', address_line2: '', city: '', state: '', postcode: '' })
    // Emit with just the name so far — address fields empty
    onChange({ type: 'new', data: { name: query, address_line1: '', address_line2: '', city: '', state: '', postcode: '' } })
  }

  function handleNewSchoolFieldChange(field: keyof NewSchoolData, value: string) {
    setNewSchool((prev) => {
      const updated = { ...prev, [field]: value }
      onChange({ type: 'new', data: updated })
      return updated
    })
  }

  function handleCancelAdd() {
    setMode('search')
    setNewSchool({ name: '', address_line1: '', address_line2: '', city: '', state: '', postcode: '' })
    onChange(null)
  }

  async function handleLookupAddress() {
    if (!newSchool.name.trim()) return
    setLookingUp(true)
    setLookupError('')
    try {
      const res = await fetch(`/api/schools/lookup?name=${encodeURIComponent(newSchool.name.trim())}`)
      const data = await res.json()
      if (data.address) {
        setNewSchool((prev) => {
          const updated = {
            ...prev,
            address_line1: data.address.address_line1 ?? prev.address_line1,
            city: data.address.city ?? prev.city,
            state: data.address.state ?? prev.state,
            postcode: data.address.postcode ?? prev.postcode,
          }
          onChange({ type: 'new', data: updated })
          return updated
        })
      } else {
        setLookupError('No address found — please fill in manually.')
      }
    } catch {
      setLookupError('Lookup failed — please fill in manually.')
    } finally {
      setLookingUp(false)
    }
  }

  const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue'

  if (mode === 'selected') {
    return (
      <div className="flex items-center gap-2 border border-brand-blue bg-blue-50 rounded-lg px-3 py-2">
        <span className="flex-1 text-sm text-brand-blue-dark font-medium">{selectedName}</span>
        <button
          type="button"
          onClick={handleClearSelection}
          className="text-brand-blue/50 hover:text-brand-blue text-xs"
          aria-label="Clear school selection"
        >
          ✕
        </button>
      </div>
    )
  }

  if (mode === 'adding') {
    return (
      <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-gray-50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-700">New school details</span>
          <button type="button" onClick={handleCancelAdd} className="text-xs text-gray-400 hover:text-gray-600">
            Cancel
          </button>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">School name</label>
          <input
            type="text"
            value={newSchool.name}
            onChange={(e) => handleNewSchoolFieldChange('name', e.target.value)}
            className={inputClass}
            placeholder="Full school name"
          />
        </div>

        <button
          type="button"
          onClick={handleLookupAddress}
          disabled={lookingUp || !newSchool.name.trim()}
          className="w-full text-xs text-brand-blue border border-blue-200 rounded-lg py-1.5 px-3 hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {lookingUp ? 'Searching…' : '🔍 Find address automatically'}
        </button>
        {lookupError && <p className="text-xs text-amber-600">{lookupError}</p>}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Address line 1</label>
          <input
            type="text"
            value={newSchool.address_line1}
            onChange={(e) => handleNewSchoolFieldChange('address_line1', e.target.value)}
            className={inputClass}
            placeholder="Street address"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Address line 2 <span className="text-gray-400">(optional)</span></label>
          <input
            type="text"
            value={newSchool.address_line2}
            onChange={(e) => handleNewSchoolFieldChange('address_line2', e.target.value)}
            className={inputClass}
            placeholder="Suite, building, etc."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">City</label>
            <input
              type="text"
              value={newSchool.city}
              onChange={(e) => handleNewSchoolFieldChange('city', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">State</label>
            <select
              value={newSchool.state}
              onChange={(e) => handleNewSchoolFieldChange('state', e.target.value)}
              className={inputClass}
            >
              <option value="">Select…</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Postcode</label>
          <input
            type="text"
            value={newSchool.postcode}
            onChange={(e) => handleNewSchoolFieldChange('postcode', e.target.value)}
            className={inputClass}
            placeholder="ZIP code"
          />
        </div>
      </div>
    )
  }

  // Default: search mode
  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => query.length >= 2 && setDropdownOpen(true)}
          className={inputClass}
          placeholder="Type school name to search…"
          autoComplete="off"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
            Searching…
          </span>
        )}
      </div>

      {dropdownOpen && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {results.length > 0 && (
            <ul>
              {results.map((school) => (
                <li key={school.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); handleSelectExisting(school) }}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 flex flex-col"
                  >
                    <span className="font-medium text-gray-800">{school.name}</span>
                    {(school.city || school.state) && (
                      <span className="text-xs text-gray-500">
                        {[school.city, school.state].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {results.length === 0 && !searching && (
            <p className="px-4 py-2.5 text-sm text-gray-500">No schools found matching "{query}"</p>
          )}

          <div className="border-t border-gray-100">
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleAddNew() }}
              className="w-full text-left px-4 py-2.5 text-sm text-brand-blue hover:bg-blue-50 font-medium"
            >
              + Add "{query}" as a new school
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
