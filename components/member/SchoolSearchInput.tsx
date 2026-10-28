'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { X } from 'lucide-react'
import { Field, Input, Select, cn } from '@stellr/web-ui'

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
  | { type: 'existing'; id: string; name: string; state?: string | null }
  | { type: 'new'; data: NewSchoolData }

/** US State (full name) of a school selection, if known — used to pick the
 *  correct Kindergarten entry cutoff when inferring a student's grade. */
export function schoolSelectionState(sel: SchoolSelection | null): string | null {
  if (!sel) return null
  return sel.type === 'existing' ? sel.state ?? null : sel.data.state || null
}

interface Props {
  onChange: (selection: SchoolSelection | null) => void
  /** Seed the input with the member's existing school so they don't re-pick it. */
  initialSchool?: { id: string; name: string } | null
  /**
   * The id a `<label htmlFor>` points at, so the component can sit inside a
   * `<Field>` like any input. It lands on whichever control is showing: the
   * search box, the chosen school, or the new school's name.
   */
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  /** Announced, not enforced: what counts is the school picked, not the text typed. */
  required?: boolean
}

export function SchoolSearchInput({
  onChange,
  initialSchool,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  required,
}: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DbSchool[]>([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [searching, setSearching] = useState(false)
  const [mode, setMode] = useState<'search' | 'selected' | 'adding'>('search')
  const [selectedName, setSelectedName] = useState('')
  const [newSchool, setNewSchool] = useState<NewSchoolData>({
    name: '', address_line1: '', address_line2: '', city: '', state: '', postcode: '',
  })
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupError, setLookupError] = useState('')

  const baseId = useId()
  const controlId = id ?? `${baseId}-school`
  const listboxId = `${baseId}-listbox`
  const optionId = (i: number) => `${baseId}-option-${i}`
  // The "add as a new school" row is always the last option.
  const optionCount = results.length + 1
  const controlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    'aria-required': required || undefined,
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Seed the member's existing school once, on mount, into the "selected" state.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || !initialSchool?.id || !initialSchool.name) return
    seededRef.current = true
    setMode('selected')
    setSelectedName(initialSchool.name)
    onChange({ type: 'existing', id: initialSchool.id, name: initialSchool.name })
  }, [initialSchool, onChange])

  // Each mode shows a different control. When the member's own action swaps
  // one for another, focus follows to the new one rather than dropping to the
  // top of the page.
  const refocus = useRef(false)
  useEffect(() => {
    if (!refocus.current) return
    refocus.current = false
    document.getElementById(controlId)?.focus()
  }, [mode, controlId])

  function closeList() {
    setDropdownOpen(false)
    setActiveIndex(-1)
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setActiveIndex(-1)
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
      setActiveIndex(-1)
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/schools/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.schools ?? [])
        setActiveIndex(-1)
        setDropdownOpen(true)
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  function handleQueryChange(value: string) {
    setQuery(value)
    setActiveIndex(-1)
    onChange(null)
    runSearch(value)
  }

  function handleSelectExisting(school: DbSchool) {
    refocus.current = true
    setMode('selected')
    setSelectedName(school.name)
    closeList()
    setResults([])
    onChange({ type: 'existing', id: school.id, name: school.name, state: school.state })
  }

  function handleClearSelection() {
    refocus.current = true
    setMode('search')
    setSelectedName('')
    setQuery('')
    setResults([])
    onChange(null)
  }

  function handleAddNew() {
    refocus.current = true
    closeList()
    setMode('adding')
    setNewSchool({ name: query, address_line1: '', address_line2: '', city: '', state: '', postcode: '' })
    // Emit with just the name so far — address fields empty
    onChange({ type: 'new', data: { name: query, address_line1: '', address_line2: '', city: '', state: '', postcode: '' } })
  }

  function chooseOption(i: number) {
    if (i < results.length) handleSelectExisting(results[i])
    else handleAddNew()
  }

  // The combobox keys: arrows move through the list, Enter picks, Escape closes.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!dropdownOpen) {
        if (query.length >= 2) {
          e.preventDefault()
          setDropdownOpen(true)
        }
        return
      }
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((i) => (i < 0 ? (step > 0 ? 0 : optionCount - 1) : (i + step + optionCount) % optionCount))
    } else if (e.key === 'Enter' && dropdownOpen && activeIndex >= 0) {
      e.preventDefault()
      chooseOption(activeIndex)
    } else if (e.key === 'Escape' && dropdownOpen) {
      e.preventDefault()
      closeList()
    }
  }

  function handleNewSchoolFieldChange(field: keyof NewSchoolData, value: string) {
    setNewSchool((prev) => {
      const updated = { ...prev, [field]: value }
      onChange({ type: 'new', data: updated })
      return updated
    })
  }

  function handleCancelAdd() {
    refocus.current = true
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

  if (mode === 'selected') {
    return (
      <div className="flex items-center gap-2 rounded-control border border-brand-blue bg-brand-blue/5 pl-3 focus-within:ring-2 focus-within:ring-primary-deep/30">
        {/* Read-only, so a label can name it and a screen reader reads the
            school back; the button beside it starts the search again. */}
        <input
          {...controlProps}
          type="text"
          readOnly
          value={selectedName}
          className="min-h-11 min-w-0 flex-1 bg-transparent text-input font-medium text-brand-blue-dark focus:outline-hidden mouse:text-sm"
        />
        <button
          type="button"
          onClick={handleClearSelection}
          className="inline-flex min-h-11 min-w-11 items-center justify-center text-brand-blue/50 hover:text-brand-blue"
          aria-label="Clear school selection"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    )
  }

  if (mode === 'adding') {
    // A school's address, not the member's: autofill would offer their home.
    return (
      <div
        role="group"
        aria-labelledby={`${baseId}-new-title`}
        className="space-y-3 rounded-control border border-brand-border bg-brand-canvas p-4"
      >
        <div className="flex items-center justify-between">
          <span id={`${baseId}-new-title`} className="text-xs font-medium text-brand-muted">New school details</span>
          <button
            type="button"
            onClick={handleCancelAdd}
            className="min-h-11 px-2 text-xs text-brand-muted-soft hover:text-brand-muted"
          >
            Cancel
          </button>
        </div>

        <Field label="School name" labelSize="small">
          <Input
            {...controlProps}
            type="text"
            autoComplete="off"
            value={newSchool.name}
            onChange={(e) => handleNewSchoolFieldChange('name', e.target.value)}
            placeholder="Full school name"
          />
        </Field>

        <button
          type="button"
          onClick={handleLookupAddress}
          disabled={lookingUp || !newSchool.name.trim()}
          className="min-h-11 w-full rounded-control border border-brand-blue/30 px-3 text-xs text-brand-blue transition-colors hover:bg-brand-blue/5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {lookingUp ? 'Searching…' : '🔍 Find address automatically'}
        </button>
        <p aria-live="polite" className="text-xs text-brand-gold-ink empty:hidden">{lookupError}</p>

        <Field label="Address line 1" labelSize="small">
          <Input
            type="text"
            autoComplete="off"
            value={newSchool.address_line1}
            onChange={(e) => handleNewSchoolFieldChange('address_line1', e.target.value)}
            placeholder="Street address"
          />
        </Field>

        <Field label="Address line 2 (optional)" labelSize="small">
          <Input
            type="text"
            autoComplete="off"
            value={newSchool.address_line2}
            onChange={(e) => handleNewSchoolFieldChange('address_line2', e.target.value)}
            placeholder="Suite, building, etc."
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="City" labelSize="small">
            <Input
              type="text"
              autoComplete="off"
              value={newSchool.city}
              onChange={(e) => handleNewSchoolFieldChange('city', e.target.value)}
            />
          </Field>
          <Field label="State" labelSize="small">
            <Select
              autoComplete="off"
              value={newSchool.state}
              onChange={(e) => handleNewSchoolFieldChange('state', e.target.value)}
            >
              <option value="">Select…</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Postcode" labelSize="small">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={newSchool.postcode}
            onChange={(e) => handleNewSchoolFieldChange('postcode', e.target.value)}
            placeholder="ZIP code"
          />
        </Field>
      </div>
    )
  }

  // Default: search mode — a combobox (ARIA 1.2 list autocomplete). Focus stays
  // in the box; aria-activedescendant tells a screen reader which row the
  // arrow keys are on.
  const listStatus = searching || !dropdownOpen
    ? ''
    : results.length === 0
      ? 'No schools found'
      : `${results.length} ${results.length === 1 ? 'school' : 'schools'} found`

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          {...controlProps}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
          aria-controls={listboxId}
          aria-activedescendant={dropdownOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => query.length >= 2 && setDropdownOpen(true)}
          onKeyDown={handleKeyDown}
          className={searching ? 'pr-24' : undefined}
          placeholder="Type school name to search…"
          autoComplete="off"
        />
        {searching && (
          <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted-soft text-xs">
            Searching…
          </span>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{listStatus}</p>

      <div
        hidden={!dropdownOpen}
        className="absolute z-20 mt-1 w-full bg-white border border-brand-border rounded-control shadow-lg overflow-hidden"
      >
        {results.length === 0 && !searching && (
          <p className="px-4 py-2.5 text-sm text-brand-muted-soft">No schools found matching "{query}"</p>
        )}
        <ul id={listboxId} role="listbox" aria-label="Schools">
          {results.map((school, i) => (
            <li
              key={school.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              tabIndex={-1}
              // mousedown, not click: keeps focus in the box until the pick lands.
              onMouseDown={(e) => { e.preventDefault(); handleSelectExisting(school) }}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'flex min-h-11 cursor-pointer flex-col justify-center px-4 py-2.5 text-sm',
                i === activeIndex && 'bg-surface'
              )}
            >
              <span className="font-medium text-brand-blue-dark">{school.name}</span>
              {(school.city || school.state) && (
                <span className="text-xs text-brand-muted-soft">
                  {[school.city, school.state].filter(Boolean).join(', ')}
                </span>
              )}
            </li>
          ))}
          <li
            id={optionId(results.length)}
            role="option"
            aria-selected={activeIndex === results.length}
            tabIndex={-1}
            onMouseDown={(e) => { e.preventDefault(); handleAddNew() }}
            onMouseEnter={() => setActiveIndex(results.length)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center border-t border-brand-hairline px-4 py-2.5 text-sm font-medium text-brand-blue',
              activeIndex === results.length && 'bg-surface'
            )}
          >
            + Add "{query}" as a new school
          </li>
        </ul>
      </div>
    </div>
  )
}
