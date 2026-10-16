'use client'

import { useId, useState } from 'react'
import { Choice, Dialog, Field, Fieldset, Input, Select, Textarea } from '@stellr/web-ui'
import { MemberIdLookup, type MemberMatch } from '@/components/forms/MemberIdLookup'

interface ParticipantData {
  id?: string
  membership_id?: string
  // True when an existing member was linked via Member ID — the route builds the
  // participant from their on-file record and the other fields are skipped.
  linked?: boolean
  first_name: string
  last_name: string
  nickname: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  t_shirt_size: string
  grade: string
  event_role: string
  ethnicity: string[]
  dietary_requirements: string[]
  health_conditions: string
  emergency_contact_first_name: string
  emergency_contact_last_name: string
  emergency_contact_email: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
}

type FieldErrors = Partial<Record<keyof ParticipantData, string>>

const EMPTY: ParticipantData = {
  membership_id: '', linked: false,
  first_name: '', last_name: '', nickname: '', email: '', phone: '',
  date_of_birth: '', gender: '', t_shirt_size: '', grade: '',
  event_role: 'participant', ethnicity: [], dietary_requirements: [],
  health_conditions: '', emergency_contact_first_name: '',
  emergency_contact_last_name: '', emergency_contact_email: '',
  emergency_contact_phone: '', emergency_contact_relationship: '',
}

const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
// School grades run from 6 because some events open below high school
// (Colorado 2027 runs grades 7–12). Mirrors GRADES in lib/registration-constants.
const GRADES = ['6', '7', '8', '9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GENDERS = ['Male', 'Female', 'Other']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * What a save needs, keyed in the order the fields appear so the first key is
 * the first field to fix. A member linked by ID is built from their on-file
 * record, so nothing is checked. Students sign the minor participation
 * agreement with their emergency contact as the guardian signer, so every
 * student needs one.
 */
function validate(form: ParticipantData, isStudent: boolean): FieldErrors {
  if (form.linked) return {}
  const errors: FieldErrors = {}
  if (!form.first_name.trim()) errors.first_name = 'Enter a first name.'
  if (!form.last_name.trim()) errors.last_name = 'Enter a last name.'
  if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Enter an email address.'
  if (isStudent) {
    if (!form.emergency_contact_first_name.trim()) errors.emergency_contact_first_name = 'Enter their first name.'
    if (!form.emergency_contact_last_name.trim()) errors.emergency_contact_last_name = 'Enter their last name.'
    if (!EMAIL_RE.test(form.emergency_contact_email.trim())) errors.emergency_contact_email = 'Enter their email address.'
    if (!form.emergency_contact_phone.trim()) errors.emergency_contact_phone = 'Enter their phone number.'
    if (!form.emergency_contact_relationship) errors.emergency_contact_relationship = 'Choose how they are related.'
  }
  return errors
}

interface Props {
  registrationId: string
  initial?: ParticipantData
  onSaved: () => void
  onCancel: () => void
}

// An adult is entering someone else's details here, so every field opts out of
// autofill: the browser would otherwise offer the adult's own name and email.
export function ParticipantForm({ registrationId, initial, onSaved, onCancel }: Props) {
  // Roles are the members enum values; legacy rows may still hold 'student'.
  const [form, setForm] = useState<ParticipantData>(() =>
    initial
      ? { ...initial, membership_id: initial.membership_id ?? '', event_role: initial.event_role === 'adult' ? 'adult' : 'participant' }
      : EMPTY
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const uid = useId()
  const formId = `${uid}-participant`
  const fid = (field: keyof ParticipantData) => `${uid}-${field}`

  const isStudent = form.event_role === 'participant'

  function set(field: keyof ParticipantData, value: string | string[]) {
    setForm(prev => ({ ...prev, [field]: value }))
    setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  function toggleDietary(opt: string) {
    const current = form.dietary_requirements
    set('dietary_requirements', current.includes(opt) ? current.filter(d => d !== opt) : [...current, opt])
  }

  function toggleEthnicity(opt: string) {
    const current = form.ethnicity
    set('ethnicity', current.includes(opt) ? current.filter(d => d !== opt) : [...current, opt])
  }

  function acceptMatch(m: MemberMatch) {
    setForm(prev => ({ ...prev, linked: true, first_name: m.first_name, last_name: m.last_name }))
    setFieldErrors({})
  }
  function unlinkMatch() {
    setForm(prev => ({ ...prev, linked: false }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Each problem shows under its own field; focus goes to the first of them.
    const errors = validate(form, isStudent)
    const first = Object.keys(errors)[0] as keyof ParticipantData | undefined
    if (first) {
      setFieldErrors(errors)
      setError(null)
      requestAnimationFrame(() => document.getElementById(fid(first))?.focus())
      return
    }

    setSaving(true)
    setError(null)
    setFieldErrors({})

    const isEdit = Boolean(initial?.id)
    const url = isEdit
      ? `/api/members/teams/${registrationId}/participants/${initial!.id}`
      : `/api/members/teams/${registrationId}/participants`

    const res = await fetch(url, {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Failed to save participant')
      setSaving(false)
      return
    }

    onSaved()
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title={initial?.id ? 'Edit Participant' : 'Add Participant'}
      size="2xl"
      // A long form: closed with Cancel only, so a stray tap on the scrim or
      // Escape can't throw away what was typed.
      dismissible={false}
      footer={
        <>
          {error && (
            <p role="alert" className="w-full rounded-control bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-11 rounded-control border border-line-strong px-4 text-sm font-semibold text-content-secondary hover:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={saving}
            className="min-h-11 rounded-control bg-primary-deep px-4 text-sm font-semibold text-white hover:bg-ink disabled:opacity-50"
          >
            {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Add participant')}
          </button>
        </>
      }
    >
      {/* noValidate: the checks above put each message under its field, where
          the browser's own bubbles would stack in a corner of the dialog. */}
      <form id={formId} onSubmit={handleSubmit} noValidate autoComplete="off" className="space-y-5">
        {/* Member ID lookup — accept a match to reuse an existing member's record */}
        <MemberIdLookup value={form.membership_id ?? ''} linked={!!form.linked}
          linkedName={`${form.first_name} ${form.last_name}`.trim()}
          onChange={v => set('membership_id', v)} onAccept={acceptMatch} onUnlink={unlinkMatch} label="Member ID (optional)" />

        {!form.linked && (
        <>
        {/* Role */}
        <Fieldset legend="Participant type">
          <div className="flex flex-wrap gap-x-6">
            {([['participant', 'Student'], ['adult', 'Adult']] as const).map(([role, label]) => (
              <Choice
                key={role}
                type="radio"
                name="event_role"
                value={role}
                checked={form.event_role === role}
                onChange={() => set('event_role', role)}
                label={label}
              />
            ))}
          </div>
        </Fieldset>

        {/* Name */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.first_name}>
            <Input
              id={fid('first_name')}
              autoComplete="off"
              value={form.first_name}
              onChange={e => set('first_name', e.target.value)}
            />
          </Field>
          <Field label="Last name" required error={fieldErrors.last_name}>
            <Input
              id={fid('last_name')}
              autoComplete="off"
              value={form.last_name}
              onChange={e => set('last_name', e.target.value)}
            />
          </Field>
        </div>

        {/* Preferred name */}
        <Field label="Preferred name / nickname">
          <Input
            autoComplete="off"
            value={form.nickname}
            onChange={e => set('nickname', e.target.value)}
            placeholder="Optional"
          />
        </Field>

        {/* Email & Phone */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Email" required error={fieldErrors.email}>
            <Input
              id={fid('email')}
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={e => set('email', e.target.value)}
            />
          </Field>
          <Field label="Phone">
            <Input
              type="tel"
              autoComplete="off"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
            />
          </Field>
        </div>

        {/* DOB, Gender, T-Shirt */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date of birth">
            <Input
              type="date"
              autoComplete="off"
              value={form.date_of_birth}
              onChange={e => set('date_of_birth', e.target.value)}
            />
          </Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">Select…</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
          <Field label="T-shirt size">
            <Select value={form.t_shirt_size} onChange={e => set('t_shirt_size', e.target.value)}>
              <option value="">Select…</option>
              {T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
        </div>

        {/* Grade — students only */}
        {isStudent && (
          <Field label="Grade">
            <Select value={form.grade} onChange={e => set('grade', e.target.value)}>
              <option value="">Select…</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </Select>
          </Field>
        )}

        {/* Ethnicity */}
        <Fieldset legend="Ethnicity">
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {ETHNICITIES.map(opt => (
              <Choice
                key={opt}
                checked={form.ethnicity.includes(opt)}
                onChange={() => toggleEthnicity(opt)}
                label={opt}
              />
            ))}
          </div>
        </Fieldset>

        {/* Dietary */}
        <Fieldset legend="Dietary requirements">
          <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
            {DIETARY_OPTIONS.map(opt => (
              <Choice
                key={opt}
                checked={form.dietary_requirements.includes(opt)}
                onChange={() => toggleDietary(opt)}
                label={opt}
              />
            ))}
          </div>
        </Fieldset>

        {/* Health conditions */}
        <Field label="Health conditions / allergies">
          <Textarea
            rows={2}
            className="resize-none"
            value={form.health_conditions}
            onChange={e => set('health_conditions', e.target.value)}
          />
        </Field>

        {/* Emergency contact — required for students (guardian for their agreement) */}
        {isStudent && (
          <div className="border-t border-line-light pt-4">
          <Fieldset legend="Emergency contact" hint="Acts as the guardian for the student's participation agreement.">
            <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2">
              <Field label="First name" labelSize="small" required error={fieldErrors.emergency_contact_first_name}>
                <Input
                  id={fid('emergency_contact_first_name')}
                  autoComplete="off"
                  value={form.emergency_contact_first_name}
                  onChange={e => set('emergency_contact_first_name', e.target.value)}
                />
              </Field>
              <Field label="Last name" labelSize="small" required error={fieldErrors.emergency_contact_last_name}>
                <Input
                  id={fid('emergency_contact_last_name')}
                  autoComplete="off"
                  value={form.emergency_contact_last_name}
                  onChange={e => set('emergency_contact_last_name', e.target.value)}
                />
              </Field>
              <Field label="Email" labelSize="small" required error={fieldErrors.emergency_contact_email}>
                <Input
                  id={fid('emergency_contact_email')}
                  type="email"
                  autoComplete="off"
                  value={form.emergency_contact_email}
                  onChange={e => set('emergency_contact_email', e.target.value)}
                />
              </Field>
              <Field label="Phone" labelSize="small" required error={fieldErrors.emergency_contact_phone}>
                <Input
                  id={fid('emergency_contact_phone')}
                  type="tel"
                  autoComplete="off"
                  value={form.emergency_contact_phone}
                  onChange={e => set('emergency_contact_phone', e.target.value)}
                />
              </Field>
              <Field
                label="Relationship to participant"
                labelSize="small"
                required
                error={fieldErrors.emergency_contact_relationship}
              >
                <Select
                  id={fid('emergency_contact_relationship')}
                  value={form.emergency_contact_relationship}
                  onChange={e => set('emergency_contact_relationship', e.target.value)}
                >
                  <option value="">Select…</option>
                  {EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            </div>
          </Fieldset>
          </div>
        )}
        </>
        )}
      </form>
    </Dialog>
  )
}
