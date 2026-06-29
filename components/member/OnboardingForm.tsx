'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SchoolSearchInput, SchoolSelection } from '@/components/member/SchoolSearchInput'

interface Tier {
  id: string
  name: string
  grouping_title: string | null
  annual_cost_cents: number
  is_free: boolean
  age_bracket: string | null
}

interface ExistingMember {
  id: string
  age_bracket: string
  event_role: string
}

interface Props {
  tiers: Tier[]
  existingMember: ExistingMember | null
  /** Where to send the member after completing onboarding (default /home). */
  next?: string
}

const ROLES = [
  { value: 'participant', label: 'Student (High School)', bracket: 'high_school' },
  { value: 'school_student_manager', label: 'Student Manager (leads a group)', bracket: 'high_school' },
  { value: 'mentor', label: 'Mentor / Volunteer', bracket: 'college' },
  { value: 'teacher', label: 'Teacher / Educator', bracket: 'adult' },
  { value: 'parent', label: 'Parent / Guardian', bracket: 'adult' },
]

const GRADES = [
  { value: 'grade_9', label: 'Grade 9' },
  { value: 'grade_10', label: 'Grade 10' },
  { value: 'grade_11', label: 'Grade 11' },
  { value: 'grade_12', label: 'Grade 12' },
  { value: 'college_freshman', label: 'College Freshman' },
  { value: 'college_sophomore', label: 'College Sophomore' },
  { value: 'college_junior', label: 'College Junior' },
  { value: 'college_senior', label: 'College Senior' },
  { value: 'grad_phd', label: 'Grad / PhD' },
]

const GENDERS = ['male', 'female', 'other']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

export function OnboardingForm({ tiers, existingMember, next }: Props) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    event_role: existingMember?.event_role ?? '',
    age_bracket: existingMember?.age_bracket ?? '',
    date_of_birth: '',
    gender: '',
    phone: '',
    grade: '',
    tshirt_size: '',
    ec_first_name: '',
    ec_last_name: '',
    ec_email: '',
    ec_phone: '',
    ec_relationship: '',
  })

  const [schoolSelection, setSchoolSelection] = useState<SchoolSelection | null>(null)

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleRoleSelect(role: typeof ROLES[0]) {
    setForm((f) => ({ ...f, event_role: role.value, age_bracket: role.bracket }))
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')
    try {
      const schoolPayload =
        schoolSelection?.type === 'existing'
          ? { school_id: schoolSelection.id }
          : schoolSelection?.type === 'new'
          ? {
              school_id: 'new',
              new_school_name: schoolSelection.data.name,
              new_school_address_line1: schoolSelection.data.address_line1,
              new_school_address_line2: schoolSelection.data.address_line2,
              new_school_city: schoolSelection.data.city,
              new_school_state: schoolSelection.data.state,
              new_school_postcode: schoolSelection.data.postcode,
            }
          : {}

      const res = await fetch('/api/members/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ...schoolPayload }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Something went wrong')
        return
      }
      router.push(next ?? '/home')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-8">
      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-brand-blue' : 'bg-brand-border'}`}
          />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">What best describes you?</h2>
          <div className="grid grid-cols-1 gap-3">
            {ROLES.map((r) => (
              <button
                key={r.value}
                onClick={() => handleRoleSelect(r)}
                className={`text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  form.event_role === r.value
                    ? 'border-brand-blue bg-brand-blue/5 text-brand-blue'
                    : 'border-brand-border hover:border-brand-border text-brand-muted'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!form.event_role}
            className="w-full mt-4 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">Personal details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Date of birth</label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Gender</label>
              <select
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              >
                <option value="">Select…</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>

          {(form.age_bracket === 'high_school' || form.age_bracket === 'college') && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">Grade / Year</label>
                <select
                  value={form.grade}
                  onChange={(e) => set('grade', e.target.value)}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  <option value="">Select…</option>
                  {GRADES.filter((g) =>
                    form.age_bracket === 'high_school'
                      ? g.value.startsWith('grade_')
                      : !g.value.startsWith('grade_')
                  ).map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">T-shirt size</label>
                <select
                  value={form.tshirt_size}
                  onChange={(e) => set('tshirt_size', e.target.value)}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  <option value="">Select…</option>
                  {['S','M','L','XL','2XL','3XL_plus'].map((s) => (
                    <option key={s} value={s}>{s.replace('_plus', '+')}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* School — only shown for non-adults */}
          {form.age_bracket !== 'adult' && (
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">School</label>
              <SchoolSearchInput onChange={setSchoolSelection} />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(1)} className="flex-1 border border-brand-border rounded-lg py-2.5 text-sm font-medium text-brand-muted hover:bg-brand-canvas">
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              disabled={!form.date_of_birth || !form.gender}
              className="flex-1 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">Emergency contact</h2>
          <p className="text-xs text-brand-muted-soft">Required for event participation.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">First name</label>
              <input
                type="text"
                value={form.ec_first_name}
                onChange={(e) => set('ec_first_name', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Last name</label>
              <input
                type="text"
                value={form.ec_last_name}
                onChange={(e) => set('ec_last_name', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Email</label>
              <input
                type="email"
                value={form.ec_email}
                onChange={(e) => set('ec_email', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Phone</label>
              <input
                type="tel"
                value={form.ec_phone}
                onChange={(e) => set('ec_phone', e.target.value)}
                className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">Relationship to participant</label>
            <select
              value={form.ec_relationship}
              onChange={(e) => set('ec_relationship', e.target.value)}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              <option value="">Select…</option>
              {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="flex-1 border border-brand-border rounded-lg py-2.5 text-sm font-medium text-brand-muted hover:bg-brand-canvas">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Complete profile'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
