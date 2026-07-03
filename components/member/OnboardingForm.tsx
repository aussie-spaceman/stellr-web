'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SchoolSearchInput, SchoolSelection } from '@/components/member/SchoolSearchInput'

interface ExistingMember {
  id: string
  age_bracket: string
  event_role: string
}

export interface SelectedTier {
  slug: string
  name: string
  /** Audience bracket: 'school' | 'college' | 'adult'. */
  bracket: 'school' | 'college' | 'adult'
}

interface Props {
  existingMember: ExistingMember | null
  /** Where to send the member after completing onboarding (default /home). */
  next?: string
  /** The tier the member is signing up for, parsed from `next`. Drives the flow. */
  selectedTier?: SelectedTier | null
  /** Volunteer program signup (?role=volunteer): role is locked to 'volunteer',
   *  the member must be 18+, and the student-specific steps are skipped. */
  volunteerFlow?: boolean
}

const ROLES = [
  { value: 'participant', label: 'Student (High School)', bracket: 'high_school' },
  { value: 'school_student_manager', label: 'Student Manager (leads a group)', bracket: 'high_school' },
  { value: 'mentor', label: 'Mentor / Volunteer', bracket: 'college' },
  { value: 'teacher', label: 'Teacher / Educator', bracket: 'adult' },
  { value: 'parent', label: 'Parent / Guardian', bracket: 'adult' },
]

// When a teacher/adult tier is being purchased we only offer the adult roles, and
// force the bracket to 'adult' regardless of each role's default bracket.
const ADULT_ROLE_VALUES = ['teacher', 'mentor', 'parent']

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

// Volunteer signup asks the bracket question instead of the role question — the
// role is always 'volunteer'; the bracket decides which free tier the signup
// grant rules land them on (college → Alumni, adult → Educator).
const VOLUNTEER_BRACKETS = [
  { value: 'college', label: 'College / university student' },
  { value: 'adult', label: 'Working adult / professional' },
]

const GENDERS = ['male', 'female', 'other']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

type StepKey = 'role' | 'details' | 'emergency'

/** Map a tier audience bracket to the member age_bracket enum. */
function ageBracketFor(tierBracket: SelectedTier['bracket'] | null): string {
  if (tierBracket === 'school') return 'high_school'
  if (tierBracket === 'college') return 'college'
  if (tierBracket === 'adult') return 'adult'
  return ''
}

export function OnboardingForm({ existingMember, next, selectedTier, volunteerFlow }: Props) {
  const router = useRouter()

  const tierBracket = selectedTier?.bracket ?? null
  // School & college tiers don't need the "what describes you?" question — the
  // purchase already tells us. Teacher tiers (and tier-less free sign-ups) keep it.
  const skipRoleStep = tierBracket === 'school' || tierBracket === 'college'
  const showRoleStep = !skipRoleStep
  const adultOnlyRoles = tierBracket === 'adult'

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    event_role: volunteerFlow ? 'volunteer' : skipRoleStep ? 'participant' : existingMember?.event_role ?? '',
    age_bracket: volunteerFlow ? '' : ageBracketFor(tierBracket) || existingMember?.age_bracket || '',
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

  // Volunteers are never students for onboarding purposes — a college-bracket
  // volunteer still skips grade/t-shirt/school/emergency-contact requirements.
  const isStudent = !volunteerFlow && (form.age_bracket === 'high_school' || form.age_bracket === 'college')
  // Students always provide a school; teachers provide their school/district.
  // Adult mentors & parents may add one but it isn't required.
  const schoolRequired = isStudent || form.event_role === 'teacher'

  // The active step list is dynamic: role only when asked, emergency only for
  // students (it's an event-participation requirement for minors/students).
  const steps = useMemo<StepKey[]>(() => {
    const s: StepKey[] = []
    if (showRoleStep) s.push('role')
    s.push('details')
    if (isStudent) s.push('emergency')
    return s
  }, [showRoleStep, isStudent])

  const [stepKey, setStepKey] = useState<StepKey>(skipRoleStep ? 'details' : 'role')
  const stepIndex = Math.max(0, steps.indexOf(stepKey))

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleRoleSelect(role: typeof ROLES[0]) {
    setForm((f) => ({
      ...f,
      event_role: role.value,
      age_bracket: adultOnlyRoles ? 'adult' : role.bracket,
    }))
  }

  function schoolValid(sel: SchoolSelection | null): boolean {
    if (!sel) return false
    if (sel.type === 'existing') return true
    const d = sel.data
    return !!(d.name?.trim() && d.address_line1?.trim() && d.city?.trim() && d.state?.trim() && d.postcode?.trim())
  }

  function isAdultDob(dob: string): boolean {
    if (!dob) return false
    const d = new Date(dob)
    const eighteenth = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate())
    return new Date() >= eighteenth
  }

  const volunteerUnderage = !!volunteerFlow && !!form.date_of_birth && !isAdultDob(form.date_of_birth)

  function detailsValid(): boolean {
    if (!form.date_of_birth || !form.gender || !form.phone.trim()) return false
    if (volunteerFlow && !isAdultDob(form.date_of_birth)) return false
    if (isStudent && (!form.grade || !form.tshirt_size)) return false
    if (schoolRequired && !schoolValid(schoolSelection)) return false
    return true
  }

  function emergencyValid(): boolean {
    return !!(
      form.ec_first_name.trim() && form.ec_last_name.trim() && form.ec_email.trim() &&
      form.ec_phone.trim() && form.ec_relationship
    )
  }

  function goNext() {
    const next = steps[stepIndex + 1]
    if (next) setStepKey(next)
  }
  function goBack() {
    const prev = steps[stepIndex - 1]
    if (prev) setStepKey(prev)
  }

  const isLastStep = stepIndex === steps.length - 1

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

  const inputClass =
    'w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue'

  return (
    <div className="bg-white rounded-xl border border-brand-border p-8">
      {/* Step indicator — reflects the actual number of steps for this member */}
      <div className="flex gap-2 mb-8">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? 'bg-brand-blue' : 'bg-brand-border'}`}
          />
        ))}
      </div>

      {selectedTier && (
        <p className="-mt-4 mb-6 text-xs text-brand-muted-soft">
          Signing up for <span className="font-semibold text-brand-blue-dark">{selectedTier.name}</span>
        </p>
      )}

      {stepKey === 'role' && volunteerFlow && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">Which best describes you?</h2>
          <p className="text-xs text-brand-muted-soft">
            You&rsquo;re joining as a Stellr volunteer — this just helps us set up the right membership.
          </p>
          <div className="grid grid-cols-1 gap-3">
            {VOLUNTEER_BRACKETS.map((b) => (
              <button
                key={b.value}
                onClick={() => set('age_bracket', b.value)}
                className={`text-left px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  form.age_bracket === b.value
                    ? 'border-brand-blue bg-brand-blue/5 text-brand-blue'
                    : 'border-brand-border hover:border-brand-border text-brand-muted'
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <button
            onClick={goNext}
            disabled={!form.age_bracket}
            className="w-full mt-4 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {stepKey === 'role' && !volunteerFlow && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">What best describes you?</h2>
          <div className="grid grid-cols-1 gap-3">
            {ROLES.filter((r) => (adultOnlyRoles ? ADULT_ROLE_VALUES.includes(r.value) : true)).map((r) => (
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
            onClick={goNext}
            disabled={!form.event_role}
            className="w-full mt-4 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {stepKey === 'details' && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">Personal details</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Date of birth</label>
              <input
                type="date"
                value={form.date_of_birth}
                onChange={(e) => set('date_of_birth', e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Gender</label>
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)} className={inputClass}>
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
            <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />
          </div>

          {volunteerUnderage && (
            <p className="text-sm text-red-600">
              Stellr volunteers must be 18 or older. If you&rsquo;re a high-school student, join as a
              student member instead.
            </p>
          )}

          {isStudent && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">Grade / Year</label>
                <select value={form.grade} onChange={(e) => set('grade', e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  {GRADES.filter((g) =>
                    form.age_bracket === 'high_school' ? g.value.startsWith('grade_') : !g.value.startsWith('grade_')
                  ).map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">T-shirt size</label>
                <select value={form.tshirt_size} onChange={(e) => set('tshirt_size', e.target.value)} className={inputClass}>
                  <option value="">Select…</option>
                  {['S', 'M', 'L', 'XL', '2XL', '3XL_plus'].map((s) => (
                    <option key={s} value={s}>{s.replace('_plus', '+')}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* School / district — required for students & teachers, optional otherwise */}
          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">
              {form.event_role === 'teacher' ? 'School / district' : 'School'}
              {!schoolRequired && <span className="text-brand-muted-soft"> (optional)</span>}
            </label>
            <SchoolSearchInput onChange={setSchoolSelection} />
          </div>

          <div className="flex gap-3 pt-2">
            {steps[stepIndex - 1] && (
              <button onClick={goBack} className="flex-1 border border-brand-border rounded-lg py-2.5 text-sm font-medium text-brand-muted hover:bg-brand-canvas">
                Back
              </button>
            )}
            {isLastStep ? (
              <button
                onClick={handleSubmit}
                disabled={loading || !detailsValid()}
                className="flex-1 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
              >
                {loading ? 'Saving…' : 'Complete profile'}
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={!detailsValid()}
                className="flex-1 bg-brand-blue text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-40"
              >
                Continue
              </button>
            )}
          </div>
          {isLastStep && error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      {stepKey === 'emergency' && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-brand-blue-dark">Emergency contact</h2>
          <p className="text-xs text-brand-muted-soft">Required for event participation.</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">First name</label>
              <input type="text" value={form.ec_first_name} onChange={(e) => set('ec_first_name', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Last name</label>
              <input type="text" value={form.ec_last_name} onChange={(e) => set('ec_last_name', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Email</label>
              <input type="email" value={form.ec_email} onChange={(e) => set('ec_email', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-brand-muted-soft mb-1">Phone</label>
              <input type="tel" value={form.ec_phone} onChange={(e) => set('ec_phone', e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-brand-muted-soft mb-1">Relationship to participant</label>
            <select value={form.ec_relationship} onChange={(e) => set('ec_relationship', e.target.value)} className={inputClass}>
              <option value="">Select…</option>
              {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={goBack} className="flex-1 border border-brand-border rounded-lg py-2.5 text-sm font-medium text-brand-muted hover:bg-brand-canvas">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || !emergencyValid()}
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
