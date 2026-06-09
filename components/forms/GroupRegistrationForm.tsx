'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from 'lucide-react'
import FieldError from '@/components/forms/FieldError'

// ── Constants ─────────────────────────────────────────────────────────────────
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GENDERS = ['Male', 'Female', 'Other']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const DIETARY = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Vegetarian', 'Vegan', 'Other']
const HS_GRADES = ['9', '10', '11', '12']
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
]

// ── Types ─────────────────────────────────────────────────────────────────────
type RegistrantRole = 'teacher' | 'student_manager'
type DetailsMethod = 'add_now' | 'spreadsheet' | 'email_link'
type PaymentMethod = 'invoice' | 'card' | 'individual'

interface AdultData {
  first_name: string; last_name: string; email: string; phone: string
  date_of_birth: string; gender: string; t_shirt_size: string
  dietary_requirements: string[]; health_conditions: string
  existing_membership_id: string
}

interface StudentData {
  first_name: string; last_name: string; email: string; phone: string
  date_of_birth: string; grade: string; gender: string; t_shirt_size: string
  health_conditions: string
  emergency_contact_first_name: string; emergency_contact_last_name: string
  emergency_contact_email: string; emergency_contact_phone: string
  existing_membership_id: string
}

function emptyAdult(): AdultData {
  return { first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', gender: '', t_shirt_size: '', dietary_requirements: [], health_conditions: '', existing_membership_id: '' }
}

function emptyStudent(): StudentData {
  return { first_name: '', last_name: '', email: '', phone: '', date_of_birth: '', grade: '', gender: '', t_shirt_size: '', health_conditions: '', emergency_contact_first_name: '', emergency_contact_last_name: '', emergency_contact_email: '', emergency_contact_phone: '', existing_membership_id: '' }
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const schoolFields = {
  school_name: z.string().min(1, 'Required'),
  school_address_street: z.string().min(1, 'Required'),
  school_address_city: z.string().min(1, 'Required'),
  school_address_state: z.string().min(1, 'Required'),
  school_address_zip: z.string().min(1, 'Required'),
}

const teacherSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Valid phone required'),
  date_of_birth: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  ...schoolFields,
  ethnicity: z.array(z.string()).min(1, 'Select at least one'),
  dietary_requirements: z.array(z.string()).min(1, 'Select at least one'),
  health_conditions: z.string().optional(),
})
type TeacherFormData = z.infer<typeof teacherSchema>

const studentManagerSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Valid phone required'),
  date_of_birth: z.string().min(1, 'Required'),
  grade: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  ...schoolFields,
  ethnicity: z.array(z.string()).min(1, 'Select at least one'),
  dietary_requirements: z.array(z.string()).min(1, 'Select at least one'),
  health_conditions: z.string().optional(),
  emergency_contact_first_name: z.string().min(1, 'Required'),
  emergency_contact_last_name: z.string().min(1, 'Required'),
  emergency_contact_email: z.string().email('Valid email required'),
  emergency_contact_phone: z.string().min(7, 'Valid phone required'),
  teacher_poc_first_name: z.string().min(1, 'Required'),
  teacher_poc_last_name: z.string().min(1, 'Required'),
  teacher_poc_email: z.string().email('Valid email required'),
})
type StudentManagerFormData = z.infer<typeof studentManagerSchema>

// ── Step bar ──────────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 }) {
  const steps = [
    { n: 1, label: 'Registration Type', done: true },
    { n: 2, label: 'Your Details', done: step > 1, current: step === 1 },
    { n: 3, label: 'Group Details', done: false, current: step === 2 },
    { n: 4, label: 'Confirmation', done: false, current: false },
  ]
  return (
    <div className="bg-white border-b border-gray-200 -mx-4 px-4 py-4 mb-6 sm:-mx-0">
      <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-wrap">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1 sm:gap-2">
            {i > 0 && <span className="text-gray-300">›</span>}
            <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              s.done ? 'bg-green-500 text-white' : s.current ? 'bg-brand-blue text-white' : 'bg-gray-200 text-gray-400'
            }`}>
              {s.done ? '✓' : s.n}
            </span>
            <span className={s.current ? 'font-medium text-brand-blue-dark' : 'text-gray-400'}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared: multi-checkbox ────────────────────────────────────────────────────
function MultiCheckboxes({ label, note, options, selected, onChange, error }: {
  label: string; note?: string; options: string[]
  selected: string[]; onChange: (v: string[]) => void; error?: string
}) {
  return (
    <div>
      <p className="font-semibold text-brand-blue-dark mb-1">{label}</p>
      {note && <p className="text-xs text-gray-400 mb-2">{note}</p>}
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(opt)}
              onChange={() => onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt])}
              className="rounded border-gray-300 text-brand-blue" />
            {opt}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Number stepper ────────────────────────────────────────────────────────────
function NumberStepper({ label, value, min, max, onChange, note }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void; note?: string
}) {
  return (
    <div>
      <label className="label-text">{label}</label>
      <div className="flex items-center gap-3 mt-1">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-lg font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">
          −
        </button>
        <span className="w-10 text-center font-semibold text-brand-blue-dark text-lg">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
          className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-lg font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40">
          +
        </button>
      </div>
      {note && <p className="text-xs text-gray-400 mt-1">{note}</p>}
    </div>
  )
}

// ── Adult accordion ───────────────────────────────────────────────────────────
function AdultAccordion({ index, data, onChange, expanded, onToggle }: {
  index: number; data: AdultData
  onChange: (field: keyof AdultData, value: string | string[]) => void
  expanded: boolean; onToggle: () => void
}) {
  const label = data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : `Additional Adult ${index + 1}`
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left">
        <span className="font-medium text-brand-blue-dark text-sm">{label}</span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="label-text">First Name *</label><input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} className="input-field" /></div>
            <div><label className="label-text">Last Name *</label><input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} className="input-field" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="label-text">Email *</label><input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} className="input-field" /></div>
            <div><label className="label-text">Phone *</label><input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} className="input-field" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className="label-text">Date of Birth *</label><input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} className="input-field" /></div>
            <div>
              <label className="label-text">Gender *</label>
              <select value={data.gender} onChange={e => onChange('gender', e.target.value)} className="input-field">
                <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label-text">T-Shirt Size *</label>
              <select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)} className="input-field">
                <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY}
            selected={data.dietary_requirements} onChange={v => onChange('dietary_requirements', v)} />
          <div>
            <label className="label-text">Health Conditions / Allergies</label>
            <textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="input-field resize-none" rows={2} placeholder="Leave blank if none." />
          </div>
          <div>
            <label className="label-text">Existing Membership ID</label>
            <input value={data.existing_membership_id} onChange={e => onChange('existing_membership_id', e.target.value)}
              className="input-field font-mono" placeholder="e.g. 0000001 — leave blank if new to Stellr" />
            <p className="text-xs text-gray-400 mt-1">If this person has previously registered with Stellr, enter their Membership ID to prevent duplicate records.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Student accordion ─────────────────────────────────────────────────────────
function StudentAccordion({ index, data, onChange, expanded, onToggle }: {
  index: number; data: StudentData
  onChange: (field: keyof StudentData, value: string) => void
  expanded: boolean; onToggle: () => void
}) {
  const label = data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : `Student ${index + 1}`
  const isHS = data.grade ? HS_GRADES.includes(data.grade) : true
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 text-left">
        <span className="font-medium text-brand-blue-dark text-sm">{label}</span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="label-text">First Name *</label><input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} className="input-field" /></div>
            <div><label className="label-text">Last Name *</label><input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} className="input-field" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="label-text">Email *</label><input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} className="input-field" /></div>
            <div><label className="label-text">Phone *</label><input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} className="input-field" /></div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 sm:col-span-1"><label className="label-text">Date of Birth *</label><input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} className="input-field" /></div>
            <div>
              <label className="label-text">Grade *</label>
              <select value={data.grade} onChange={e => onChange('grade', e.target.value)} className="input-field">
                <option value="">Select…</option>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label-text">Gender *</label>
              <select value={data.gender} onChange={e => onChange('gender', e.target.value)} className="input-field">
                <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="label-text">T-Shirt *</label>
              <select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)} className="input-field">
                <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label-text">Health Conditions / Allergies</label>
            <textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="input-field resize-none" rows={2} placeholder="Leave blank if none." />
          </div>
          {isHS && (
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <div>
                <p className="font-semibold text-brand-blue-dark text-sm">Emergency Contact</p>
                <p className="text-xs text-gray-400">Required for High School students</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input value={data.emergency_contact_first_name} onChange={e => onChange('emergency_contact_first_name', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Last Name *</label><input value={data.emergency_contact_last_name} onChange={e => onChange('emergency_contact_last_name', e.target.value)} className="input-field" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email *</label><input type="email" value={data.emergency_contact_email} onChange={e => onChange('emergency_contact_email', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Phone *</label><input type="tel" value={data.emergency_contact_phone} onChange={e => onChange('emergency_contact_phone', e.target.value)} className="input-field" /></div>
              </div>
            </div>
          )}
          <div className="border-t border-gray-100 pt-4">
            <label className="label-text">Existing Membership ID</label>
            <input value={data.existing_membership_id} onChange={e => onChange('existing_membership_id', e.target.value)}
              className="input-field font-mono" placeholder="e.g. 0000001 — leave blank if new to Stellr" />
            <p className="text-xs text-gray-400 mt-1">If this student has previously registered with Stellr, enter their Membership ID to prevent duplicate records.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GroupRegistrationForm({ eventSlug, eventTitle }: { eventSlug: string; eventTitle: string }) {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [registrantRole, setRegistrantRole] = useState<RegistrantRole>('teacher')

  const teacherForm = useForm<TeacherFormData>({
    resolver: zodResolver(teacherSchema),
    defaultValues: { ethnicity: [], dietary_requirements: [] },
  })
  const smForm = useForm<StudentManagerFormData>({
    resolver: zodResolver(studentManagerSchema),
    defaultValues: { ethnicity: [], dietary_requirements: [] },
  })

  // Use the active form based on role
  const tf = teacherForm
  const sf = smForm
  const tEthnicity = tf.watch('ethnicity') ?? []
  const tDietary = tf.watch('dietary_requirements') ?? []
  const sEthnicity = sf.watch('ethnicity') ?? []
  const sDietary = sf.watch('dietary_requirements') ?? []

  const [adultCount, setAdultCount] = useState(1)
  const [studentCount, setStudentCount] = useState(2)
  const [detailsMethod, setDetailsMethod] = useState<DetailsMethod>('add_now')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('invoice')
  const [additionalAdults, setAdditionalAdults] = useState<AdultData[]>([])
  const [students, setStudents] = useState<StudentData[]>([emptyStudent(), emptyStudent()])
  const [expandedAdult, setExpandedAdult] = useState<number | null>(null)
  const [expandedStudent, setExpandedStudent] = useState<number | null>(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleAdultCountChange(n: number) {
    setAdultCount(n)
    const need = n - 1
    setAdditionalAdults(prev => prev.length < need ? [...prev, ...Array.from({ length: need - prev.length }, emptyAdult)] : prev.slice(0, need))
  }

  function handleStudentCountChange(n: number) {
    setStudentCount(n)
    setStudents(prev => prev.length < n ? [...prev, ...Array.from({ length: n - prev.length }, emptyStudent)] : prev.slice(0, n))
  }

  function updateAdult(i: number, field: keyof AdultData, value: string | string[]) {
    setAdditionalAdults(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  function updateStudent(i: number, field: keyof StudentData, value: string) {
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
  }

  async function goToStep2() {
    let valid = false
    if (registrantRole === 'teacher') {
      valid = await tf.trigger()
    } else {
      valid = await sf.trigger()
    }
    if (valid) setStep(2)
  }

  function deriveAgeBracket(dob: string, grade?: string): string {
    if (!dob) return 'Adult'
    const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
    if (age < 18 || (grade && HS_GRADES.includes(grade))) return 'High School'
    if (grade?.startsWith('College') || grade === 'Grad / PhD') return 'College'
    return 'Adult'
  }

  function validateParticipants(): string | null {
    if (detailsMethod !== 'add_now') return null
    for (let i = 0; i < additionalAdults.length; i++) {
      const a = additionalAdults[i]
      if (!a.first_name || !a.last_name || !a.email || !a.phone || !a.date_of_birth || !a.gender || !a.t_shirt_size || a.dietary_requirements.length === 0)
        return `Additional Adult ${i + 1}: please complete all required fields`
    }
    for (let i = 0; i < students.length; i++) {
      const s = students[i]
      if (!s.first_name || !s.last_name || !s.email || !s.phone || !s.date_of_birth || !s.grade || !s.gender || !s.t_shirt_size)
        return `Student ${i + 1}: please complete all required fields`
      if (HS_GRADES.includes(s.grade) && (!s.emergency_contact_first_name || !s.emergency_contact_last_name || !s.emergency_contact_email || !s.emergency_contact_phone))
        return `Student ${i + 1}: emergency contact is required for High School students`
    }
    return null
  }

  async function handleFinalSubmit() {
    setSubmitting(true)
    setError(null)

    const participantError = validateParticipants()
    if (participantError) {
      setError(participantError)
      setSubmitting(false)
      return
    }

    try {
      let registrantPayload: Record<string, unknown>

      if (registrantRole === 'teacher') {
        const d = tf.getValues()
        registrantPayload = {
          ...d,
          age_bracket: deriveAgeBracket(d.date_of_birth),
          event_role: 'Teacher',
        }
      } else {
        const d = sf.getValues()
        registrantPayload = {
          ...d,
          age_bracket: deriveAgeBracket(d.date_of_birth, d.grade),
          event_role: 'School Student Manager',
        }
      }

      const isTeacher = registrantRole === 'teacher'
      const smData = !isTeacher ? sf.getValues() : null

      const res = await fetch('/api/register/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_slug: eventSlug,
          event_title: eventTitle,
          registrant_role: registrantRole,
          teacher: registrantPayload,
          teacher_poc: smData ? {
            first_name: smData.teacher_poc_first_name,
            last_name: smData.teacher_poc_last_name,
            email: smData.teacher_poc_email,
          } : null,
          adult_count: adultCount,
          student_count: studentCount,
          total_participants: adultCount + studentCount,
          details_method: detailsMethod,
          payment_method: paymentMethod,
          member_pays_individually: paymentMethod === 'individual',
          additional_adults: detailsMethod === 'add_now' ? additionalAdults.map(a => ({ ...a, age_bracket: deriveAgeBracket(a.date_of_birth), event_role: 'Adult' })) : [],
          students: detailsMethod === 'add_now' ? students.map(s => ({ ...s, age_bracket: deriveAgeBracket(s.date_of_birth, s.grade), event_role: 'School Student' })) : [],
        }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Registration failed')
      }

      const { registrationId, checkoutUrl, spreadsheetUrl } = await res.json()

      if (checkoutUrl) {
        window.location.href = checkoutUrl
      } else {
        const params = new URLSearchParams({ id: registrationId, type: 'group' })
        if (spreadsheetUrl) params.set('spreadsheet', encodeURIComponent(spreadsheetUrl))
        router.push(`/register/${eventSlug}/confirmation?${params.toString()}`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Step 1: Registrant details ────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepBar step={1} />
        <div>
          <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Your Details</h2>
          <p className="text-sm text-gray-600">Step 2 of 4 — Your information as the group organiser</p>
        </div>

        {/* Role selector */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h3 className="font-semibold text-brand-blue-dark">I am registering as a…</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => setRegistrantRole('teacher')}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'teacher' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
              <span className="font-semibold block mb-0.5">Teacher / Coordinator</span>
              <span className="text-xs text-gray-500">I am an adult educator bringing students to this event</span>
            </button>
            <button type="button" onClick={() => setRegistrantRole('student_manager')}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'student_manager' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-gray-200 hover:border-gray-300 text-gray-700'}`}>
              <span className="font-semibold block mb-0.5">Student Manager</span>
              <span className="text-xs text-gray-500">I am a high school student organising a group for this event</span>
            </button>
          </div>
        </div>

        {registrantRole === 'teacher' ? (
          <>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...tf.register('first_name')} className="input-field" /><FieldError message={tf.formState.errors.first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...tf.register('last_name')} className="input-field" /><FieldError message={tf.formState.errors.last_name?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email Address *</label><input {...tf.register('email')} type="email" className="input-field" /><FieldError message={tf.formState.errors.email?.message} /></div>
                <div><label className="label-text">Phone Number *</label><input {...tf.register('phone')} type="tel" className="input-field" /><FieldError message={tf.formState.errors.phone?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="label-text">Date of Birth *</label><input {...tf.register('date_of_birth')} type="date" className="input-field" /><FieldError message={tf.formState.errors.date_of_birth?.message} /></div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select {...tf.register('gender')} className="input-field"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select>
                  <FieldError message={tf.formState.errors.gender?.message} />
                </div>
                <div>
                  <label className="label-text">T-Shirt Size *</label>
                  <select {...tf.register('t_shirt_size')} className="input-field"><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <FieldError message={tf.formState.errors.t_shirt_size?.message} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <div><label className="label-text">School Name *</label><input {...tf.register('school_name')} className="input-field" /><FieldError message={tf.formState.errors.school_name?.message} /></div>
              <div><label className="label-text">Street Address *</label><input {...tf.register('school_address_street')} className="input-field" /><FieldError message={tf.formState.errors.school_address_street?.message} /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="col-span-2"><label className="label-text">City *</label><input {...tf.register('school_address_city')} className="input-field" /><FieldError message={tf.formState.errors.school_address_city?.message} /></div>
                <div>
                  <label className="label-text">State *</label>
                  <select {...tf.register('school_address_state')} className="input-field">
                    <option value="">Select…</option>{US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <FieldError message={tf.formState.errors.school_address_state?.message} />
                </div>
                <div><label className="label-text">ZIP *</label><input {...tf.register('school_address_zip')} className="input-field" /><FieldError message={tf.formState.errors.school_address_zip?.message} /></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES} selected={tEthnicity}
                onChange={v => tf.setValue('ethnicity', v, { shouldValidate: true })} error={tf.formState.errors.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY} selected={tDietary}
                onChange={v => tf.setValue('dietary_requirements', v, { shouldValidate: true })} error={tf.formState.errors.dietary_requirements?.message} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea {...tf.register('health_conditions')} className="input-field resize-none" rows={3} placeholder="Leave blank if none." />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Student Manager personal info */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('first_name')} className="input-field" /><FieldError message={sf.formState.errors.first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('last_name')} className="input-field" /><FieldError message={sf.formState.errors.last_name?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email Address *</label><input {...sf.register('email')} type="email" className="input-field" /><FieldError message={sf.formState.errors.email?.message} /></div>
                <div><label className="label-text">Phone Number *</label><input {...sf.register('phone')} type="tel" className="input-field" /><FieldError message={sf.formState.errors.phone?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div><label className="label-text">Date of Birth *</label><input {...sf.register('date_of_birth')} type="date" className="input-field" /><FieldError message={sf.formState.errors.date_of_birth?.message} /></div>
                <div>
                  <label className="label-text">Grade *</label>
                  <select {...sf.register('grade')} className="input-field">
                    <option value="">Select…</option>{['9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <FieldError message={sf.formState.errors.grade?.message} />
                </div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select {...sf.register('gender')} className="input-field"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select>
                  <FieldError message={sf.formState.errors.gender?.message} />
                </div>
                <div>
                  <label className="label-text">T-Shirt Size *</label>
                  <select {...sf.register('t_shirt_size')} className="input-field"><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <FieldError message={sf.formState.errors.t_shirt_size?.message} />
                </div>
              </div>
            </div>

            {/* School */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <div><label className="label-text">School Name *</label><input {...sf.register('school_name')} className="input-field" /><FieldError message={sf.formState.errors.school_name?.message} /></div>
              <div><label className="label-text">Street Address *</label><input {...sf.register('school_address_street')} className="input-field" /><FieldError message={sf.formState.errors.school_address_street?.message} /></div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="col-span-2"><label className="label-text">City *</label><input {...sf.register('school_address_city')} className="input-field" /><FieldError message={sf.formState.errors.school_address_city?.message} /></div>
                <div>
                  <label className="label-text">State *</label>
                  <select {...sf.register('school_address_state')} className="input-field">
                    <option value="">Select…</option>{US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <FieldError message={sf.formState.errors.school_address_state?.message} />
                </div>
                <div><label className="label-text">ZIP *</label><input {...sf.register('school_address_zip')} className="input-field" /><FieldError message={sf.formState.errors.school_address_zip?.message} /></div>
              </div>
            </div>

            {/* Additional info */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES} selected={sEthnicity}
                onChange={v => sf.setValue('ethnicity', v, { shouldValidate: true })} error={sf.formState.errors.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY} selected={sDietary}
                onChange={v => sf.setValue('dietary_requirements', v, { shouldValidate: true })} error={sf.formState.errors.dietary_requirements?.message} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea {...sf.register('health_conditions')} className="input-field resize-none" rows={3} placeholder="Leave blank if none." />
              </div>
            </div>

            {/* Emergency contact — HS student */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-brand-blue-dark">Emergency Contact</h3>
                <p className="text-xs text-gray-400 mt-0.5">Required for High School student participants</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('emergency_contact_first_name')} className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('emergency_contact_last_name')} className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_last_name?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email *</label><input {...sf.register('emergency_contact_email')} type="email" className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_email?.message} /></div>
                <div><label className="label-text">Phone *</label><input {...sf.register('emergency_contact_phone')} type="tel" className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_phone?.message} /></div>
              </div>
            </div>

            {/* Teacher Point of Contact */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-amber-900">Teacher Point of Contact</h3>
                <p className="text-xs text-amber-700 mt-0.5">Nominate a teacher who will be cc'd on all group correspondence. They are not the primary contact — that's you — but they'll be kept informed.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('teacher_poc_first_name')} className="input-field" /><FieldError message={sf.formState.errors.teacher_poc_first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('teacher_poc_last_name')} className="input-field" /><FieldError message={sf.formState.errors.teacher_poc_last_name?.message} /></div>
              </div>
              <div>
                <label className="label-text">Teacher Email *</label>
                <input {...sf.register('teacher_poc_email')} type="email" className="input-field" />
                <FieldError message={sf.formState.errors.teacher_poc_email?.message} />
              </div>
            </div>
          </>
        )}

        <button type="button" onClick={goToStep2} className="btn-primary w-full py-3">
          Continue — Group Details →
        </button>
      </div>
    )
  }

  // ── Step 2: Group details ─────────────────────────────────────────────────
  const paymentMethodLabel = registrantRole === 'student_manager' ? 'you' : 'you'

  return (
    <div className="space-y-6">
      <StepBar step={2} />
      <div>
        <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Group Details</h2>
        <p className="text-sm text-gray-600">Step 3 of 4 — Group size, member details, and payment</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        <h3 className="font-semibold text-brand-blue-dark">Group Size</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <NumberStepper label="How many adults will be in the group?" value={adultCount} min={registrantRole === 'student_manager' ? 0 : 1} max={2}
            onChange={handleAdultCountChange} note={registrantRole === 'student_manager' ? 'Optional. Maximum 2.' : 'Includes yourself as teacher / coordinator. Maximum 2.'} />
          <NumberStepper label="How many students will be in the group?" value={studentCount} min={2} max={20}
            onChange={handleStudentCountChange}
            note="Minimum 2. Maximum 20. For groups larger than 20, contact Stellr directly for custom registration." />
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark">
          Total participants: <strong>{adultCount + studentCount}</strong>
          {registrantRole === 'student_manager' && <span className="ml-1 text-xs text-gray-500">(including yourself)</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-brand-blue-dark">How do you want to provide team member details?</h3>
        <select value={detailsMethod} onChange={e => setDetailsMethod(e.target.value as DetailsMethod)} className="input-field">
          <option value="add_now">Add them now via this screen</option>
          <option value="spreadsheet">Download a pre-populated spreadsheet and deliver details later</option>
          <option value="email_link">Email a registration link to group members</option>
        </select>
        {detailsMethod === 'spreadsheet' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            A Google Sheet pre-formatted with all required fields will be created for your group and shared to your email. Complete it at your own pace and return it to Stellr.
          </div>
        )}
        {detailsMethod === 'email_link' && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark space-y-1">
            <p className="font-medium">You'll receive an email with a registration link to forward to your group members.</p>
            <p className="text-gray-500 text-xs">Each member will click the link, sign in or create a free Stellr account, and confirm their participation. You'll be notified as each member completes their registration.</p>
          </div>
        )}
      </div>

      {detailsMethod === 'add_now' && (
        <>
          {additionalAdults.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-brand-blue-dark">Additional Adults</h3>
              {additionalAdults.map((adult, i) => (
                <AdultAccordion key={i} index={i} data={adult}
                  onChange={(field, value) => updateAdult(i, field, value)}
                  expanded={expandedAdult === i} onToggle={() => setExpandedAdult(expandedAdult === i ? null : i)} />
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-semibold text-brand-blue-dark">Students</h3>
            {students.map((student, i) => (
              <StudentAccordion key={i} index={i} data={student}
                onChange={(field, value) => updateStudent(i, field, value)}
                expanded={expandedStudent === i} onToggle={() => setExpandedStudent(expandedStudent === i ? null : i)} />
            ))}
          </div>
        </>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h3 className="font-semibold text-brand-blue-dark">How will the group pay?</h3>
        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="input-field">
          <option value="invoice">Have an invoice emailed to {paymentMethodLabel}</option>
          <option value="card">Pay now via credit card</option>
          <option value="individual">Group members will pay individually</option>
        </select>
        {paymentMethod === 'invoice' && <p className="text-sm text-gray-500">An invoice will be emailed to you within 1–2 business days. Registration is confirmed upon payment.</p>}
        {paymentMethod === 'card' && <p className="text-sm text-gray-500">You'll be redirected to a secure Stripe checkout page to pay for all {adultCount + studentCount} participants.</p>}
        {paymentMethod === 'individual' && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark space-y-1">
            <p className="font-medium">Each group member will receive an individual payment link via email.</p>
            <p className="text-gray-500 text-xs">Payment links are sent once each member is confirmed in the system — either now (if adding details today) or when they complete their self-registration.</p>
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="flex gap-3">
        <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1 py-3">← Back</button>
        <button type="button" onClick={handleFinalSubmit} disabled={submitting}
          className="btn-primary flex-1 py-3 disabled:opacity-60">
          {submitting ? 'Submitting…' : paymentMethod === 'card' ? 'Continue to Payment →' : 'Submit Registration'}
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">By submitting you confirm all details are accurate.</p>
    </div>
  )
}
