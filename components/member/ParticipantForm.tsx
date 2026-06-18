'use client'

import { useState } from 'react'
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

const EMPTY: ParticipantData = {
  membership_id: '', linked: false,
  first_name: '', last_name: '', nickname: '', email: '', phone: '',
  date_of_birth: '', gender: '', t_shirt_size: '', grade: '',
  event_role: 'school_student', ethnicity: [], dietary_requirements: [],
  health_conditions: '', emergency_contact_first_name: '',
  emergency_contact_last_name: '', emergency_contact_email: '',
  emergency_contact_phone: '', emergency_contact_relationship: '',
}

const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
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
      ? { ...initial, membership_id: initial.membership_id ?? '', event_role: initial.event_role === 'adult' ? 'adult' : 'school_student' }
      : EMPTY
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isStudent = form.event_role === 'school_student'

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-brand-border">
          <h2 className="text-lg font-semibold text-brand-blue-dark">
            {initial?.id ? 'Edit Participant' : 'Add Participant'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Member ID lookup — accept a match to reuse an existing member's record */}
          <MemberIdLookup value={form.membership_id ?? ''} linked={!!form.linked}
            linkedName={`${form.first_name} ${form.last_name}`.trim()}
            onChange={v => set('membership_id', v)} onAccept={acceptMatch} onUnlink={unlinkMatch} label="Member ID (optional)" />

          {!form.linked && (
          <>
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-brand-muted mb-1">Participant type</label>
            <div className="flex gap-4">
              {([['school_student', 'Student'], ['adult', 'Adult']] as const).map(([role, label]) => (
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">First name <span className="text-red-500">*</span></label>
              <input
                required
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">Last name <span className="text-red-500">*</span></label>
              <input
                required
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
              />
            </div>
          </div>

          {/* Preferred name */}
          <div>
            <label className="block text-sm font-medium text-brand-muted mb-1">Preferred name / nickname</label>
            <input
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              value={form.nickname}
              onChange={e => set('nickname', e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">Email <span className="text-red-500">*</span></label>
              <input
                required
                type="email"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">Phone</label>
              <input
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
              />
            </div>
          </div>

          {/* DOB, Gender, T-Shirt */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">Date of birth</label>
              <input
                type="date"
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">Gender</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                value={form.gender}
                onChange={e => set('gender', e.target.value)}
              >
                <option value="">Select…</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-muted mb-1">T-shirt size</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
              <label className="block text-sm font-medium text-brand-muted mb-1">Grade</label>
              <select
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
            <label className="block text-sm font-medium text-brand-muted mb-2">Ethnicity</label>
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
            <label className="block text-sm font-medium text-brand-muted mb-2">Dietary requirements</label>
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
            <label className="block text-sm font-medium text-brand-muted mb-1">Health conditions / allergies</label>
            <textarea
              rows={2}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none"
              value={form.health_conditions}
              onChange={e => set('health_conditions', e.target.value)}
            />
          </div>

          {/* Emergency contact — required for students (guardian for their agreement) */}
          {isStudent && (
            <div className="border-t border-brand-hairline pt-4">
              <p className="text-sm font-medium text-brand-muted mb-1">Emergency contact <span className="text-red-500">*</span></p>
              <p className="text-xs text-brand-muted-soft mb-3">Acts as the guardian for the student&apos;s participation agreement.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">First name</label>
                  <input
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    value={form.emergency_contact_first_name}
                    onChange={e => set('emergency_contact_first_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">Last name</label>
                  <input
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    value={form.emergency_contact_last_name}
                    onChange={e => set('emergency_contact_last_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    value={form.emergency_contact_email}
                    onChange={e => set('emergency_contact_email', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">Phone</label>
                  <input
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                    value={form.emergency_contact_phone}
                    onChange={e => set('emergency_contact_phone', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">Relationship to participant</label>
                  <select
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
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

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-brand-muted border border-brand-border rounded-lg hover:bg-brand-canvas"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-blue rounded-lg hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Add participant')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
