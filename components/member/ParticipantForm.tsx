'use client'

import { useId, useState } from 'react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'
import { MemberIdLookup, type MemberMatch } from '@/components/forms/MemberIdLookup'

const labelCls = 'mb-1 block text-sm font-medium text-content-body'
const subLabelCls = 'mb-1 block text-xs text-content-muted'

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

interface Props {
  registrationId: string
  initial?: ParticipantData
  onSaved: () => void
  onCancel: () => void
}

export function ParticipantForm({ registrationId, initial, onSaved, onCancel }: Props) {
  // Roles are the members enum values; legacy rows may still hold 'student'.
  const [form, setForm] = useState<ParticipantData>(() =>
    initial
      ? { ...initial, membership_id: initial.membership_id ?? '', event_role: initial.event_role === 'adult' ? 'adult' : 'participant' }
      : EMPTY
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = `${useId()}-participant`

  const isStudent = form.event_role === 'participant'

  function set(field: keyof ParticipantData, value: string | string[]) {
    setForm(prev => ({ ...prev, [field]: value }))
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
  }
  function unlinkMatch() {
    setForm(prev => ({ ...prev, linked: false }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // A member linked by ID is built from their on-file record — skip field checks.
    // Otherwise students sign the minor participation agreement, with their
    // emergency contact as the guardian signer — so it's required for every student.
    if (!form.linked && isStudent && (
      !form.emergency_contact_first_name.trim() ||
      !form.emergency_contact_last_name.trim() ||
      !form.emergency_contact_email.trim() ||
      !form.emergency_contact_phone.trim() ||
      !form.emergency_contact_relationship.trim()
    )) {
      setError('Emergency contact details are required for student participants.')
      return
    }

    setSaving(true)
    setError(null)

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
      <form id={formId} onSubmit={handleSubmit} className="space-y-5">
        {/* Member ID lookup — accept a match to reuse an existing member's record */}
        <MemberIdLookup value={form.membership_id ?? ''} linked={!!form.linked}
          linkedName={`${form.first_name} ${form.last_name}`.trim()}
          onChange={v => set('membership_id', v)} onAccept={acceptMatch} onUnlink={unlinkMatch} label="Member ID (optional)" />

        {!form.linked && (
        <>
        {/* Role */}
        <div>
          <label className={labelCls}>Participant type</label>
          <div className="flex gap-4">
            {([['participant', 'Student'], ['adult', 'Adult']] as const).map(([role, label]) => (
              <label key={role} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="event_role"
                  value={role}
                  checked={form.event_role === role}
                  onChange={() => set('event_role', role)}
                />
                <span className="text-sm">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Name */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>First name <span className="text-danger">*</span></label>
            <input
              required
              className={fieldControlClass}
              value={form.first_name}
              onChange={e => set('first_name', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Last name <span className="text-danger">*</span></label>
            <input
              required
              className={fieldControlClass}
              value={form.last_name}
              onChange={e => set('last_name', e.target.value)}
            />
          </div>
        </div>

        {/* Preferred name */}
        <div>
          <label className={labelCls}>Preferred name / nickname</label>
          <input
            className={fieldControlClass}
            value={form.nickname}
            onChange={e => set('nickname', e.target.value)}
            placeholder="Optional"
          />
        </div>

        {/* Email & Phone */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Email <span className="text-danger">*</span></label>
            <input
              required
              type="email"
              className={fieldControlClass}
              value={form.email}
              onChange={e => set('email', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <input
              className={fieldControlClass}
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
            />
          </div>
        </div>

        {/* DOB, Gender, T-Shirt */}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Date of birth</label>
            <input
              type="date"
              className={fieldControlClass}
              value={form.date_of_birth}
              onChange={e => set('date_of_birth', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Gender</label>
            <select
              className={fieldControlClass}
              value={form.gender}
              onChange={e => set('gender', e.target.value)}
            >
              <option value="">Select…</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>T-shirt size</label>
            <select
              className={fieldControlClass}
              value={form.t_shirt_size}
              onChange={e => set('t_shirt_size', e.target.value)}
            >
              <option value="">Select…</option>
              {T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Grade — students only */}
        {isStudent && (
          <div>
            <label className={labelCls}>Grade</label>
            <select
              className={fieldControlClass}
              value={form.grade}
              onChange={e => set('grade', e.target.value)}
            >
              <option value="">Select…</option>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        )}

        {/* Ethnicity */}
        <div>
          <label className="mb-2 block text-sm font-medium text-content-body">Ethnicity</label>
          <div className="flex flex-wrap gap-2">
            {ETHNICITIES.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.ethnicity.includes(opt)}
                  onChange={() => toggleEthnicity(opt)}
                  className="rounded"
                />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Dietary */}
        <div>
          <label className="mb-2 block text-sm font-medium text-content-body">Dietary requirements</label>
          <div className="flex flex-wrap gap-2">
            {DIETARY_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.dietary_requirements.includes(opt)}
                  onChange={() => toggleDietary(opt)}
                  className="rounded"
                />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Health conditions */}
        <div>
          <label className={labelCls}>Health conditions / allergies</label>
          <textarea
            rows={2}
            className={`${fieldControlClass} resize-none`}
            value={form.health_conditions}
            onChange={e => set('health_conditions', e.target.value)}
          />
        </div>

        {/* Emergency contact — required for students (guardian for their agreement) */}
        {isStudent && (
          <div className="border-t border-line-light pt-4">
            <p className="mb-1 text-sm font-medium text-content-body">Emergency contact <span className="text-danger">*</span></p>
            <p className="mb-3 text-xs text-content-muted">Acts as the guardian for the student&apos;s participation agreement.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={subLabelCls}>First name</label>
                <input
                  className={fieldControlClass}
                  value={form.emergency_contact_first_name}
                  onChange={e => set('emergency_contact_first_name', e.target.value)}
                />
              </div>
              <div>
                <label className={subLabelCls}>Last name</label>
                <input
                  className={fieldControlClass}
                  value={form.emergency_contact_last_name}
                  onChange={e => set('emergency_contact_last_name', e.target.value)}
                />
              </div>
              <div>
                <label className={subLabelCls}>Email</label>
                <input
                  type="email"
                  className={fieldControlClass}
                  value={form.emergency_contact_email}
                  onChange={e => set('emergency_contact_email', e.target.value)}
                />
              </div>
              <div>
                <label className={subLabelCls}>Phone</label>
                <input
                  className={fieldControlClass}
                  value={form.emergency_contact_phone}
                  onChange={e => set('emergency_contact_phone', e.target.value)}
                />
              </div>
              <div>
                <label className={subLabelCls}>Relationship to participant</label>
                <select
                  className={fieldControlClass}
                  value={form.emergency_contact_relationship}
                  onChange={e => set('emergency_contact_relationship', e.target.value)}
                >
                  <option value="">Select…</option>
                  {EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
        )}
        </>
        )}
      </form>
    </Dialog>
  )
}
