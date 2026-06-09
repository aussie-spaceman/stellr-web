'use client'

import { useState } from 'react'

interface ParticipantData {
  id?: string
  first_name: string
  last_name: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  t_shirt_size: string
  grade: string
  event_role: string
  dietary_requirements: string[]
  health_conditions: string
  emergency_contact_first_name: string
  emergency_contact_last_name: string
  emergency_contact_email: string
  emergency_contact_phone: string
}

const EMPTY: ParticipantData = {
  first_name: '', last_name: '', email: '', phone: '',
  date_of_birth: '', gender: '', t_shirt_size: '', grade: '',
  event_role: 'student', dietary_requirements: [],
  health_conditions: '', emergency_contact_first_name: '',
  emergency_contact_last_name: '', emergency_contact_email: '',
  emergency_contact_phone: '',
}

const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GENDERS = ['Male', 'Female', 'Other']

interface Props {
  registrationId: string
  initial?: ParticipantData
  onSaved: () => void
  onCancel: () => void
}

export function ParticipantForm({ registrationId, initial, onSaved, onCancel }: Props) {
  const [form, setForm] = useState<ParticipantData>(initial ?? EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isStudent = form.event_role === 'student'

  function set(field: keyof ParticipantData, value: string | string[]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleDietary(opt: string) {
    const current = form.dietary_requirements
    set('dietary_requirements', current.includes(opt) ? current.filter(d => d !== opt) : [...current, opt])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {initial?.id ? 'Edit Participant' : 'Add Participant'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Participant type</label>
            <div className="flex gap-4">
              {['student', 'adult'].map(role => (
                <label key={role} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="event_role"
                    value={role}
                    checked={form.event_role === role}
                    onChange={() => set('event_role', role)}
                  />
                  <span className="text-sm capitalize">{role}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First name <span className="text-red-500">*</span></label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.first_name}
                onChange={e => set('first_name', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last name <span className="text-red-500">*</span></label>
              <input
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.last_name}
                onChange={e => set('last_name', e.target.value)}
              />
            </div>
          </div>

          {/* Email & Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
              <input
                required
                type="email"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.email}
                onChange={e => set('email', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
              />
            </div>
          </div>

          {/* DOB, Gender, T-Shirt */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.gender}
                onChange={e => set('gender', e.target.value)}
              >
                <option value="">Select…</option>
                {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">T-shirt size</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={form.grade}
                onChange={e => set('grade', e.target.value)}
              >
                <option value="">Select…</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          )}

          {/* Dietary */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Dietary requirements</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Health conditions / allergies</label>
            <textarea
              rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              value={form.health_conditions}
              onChange={e => set('health_conditions', e.target.value)}
            />
          </div>

          {/* Emergency contact — students only */}
          {isStudent && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Emergency contact</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">First name</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.emergency_contact_first_name}
                    onChange={e => set('emergency_contact_first_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Last name</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.emergency_contact_last_name}
                    onChange={e => set('emergency_contact_last_name', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Email</label>
                  <input
                    type="email"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.emergency_contact_email}
                    onChange={e => set('emergency_contact_email', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Phone</label>
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    value={form.emergency_contact_phone}
                    onChange={e => set('emergency_contact_phone', e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : (initial?.id ? 'Save changes' : 'Add participant')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
