'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import FieldError from '@/components/forms/FieldError'

const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GENDERS = ['Male', 'Female', 'Other']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const DIETARY = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Vegetarian', 'Vegan', 'Other']

const schema = z.object({
  // Step 1 — Personal
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  nickname: z.string().optional(),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Valid phone required'),
  date_of_birth: z.string().min(1, 'Required'),
  grade: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  school_name: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  // Step 2 — Emergency contact + health
  emergency_contact_first_name: z.string().min(1, 'Required'),
  emergency_contact_last_name: z.string().min(1, 'Required'),
  emergency_contact_email: z.string().email('Valid email required'),
  emergency_contact_phone: z.string().min(7, 'Valid phone required'),
  ethnicity: z.array(z.string()).min(1, 'Select at least one'),
  dietary_requirements: z.array(z.string()).min(1, 'Select at least one'),
  health_conditions: z.string().optional(),
})

type FormData = z.infer<typeof schema>

function deriveAgeBracket(dob: string): 'High School' | 'College' | 'Adult' {
  const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
  if (age < 18) return 'High School'
  const hsGrades = ['9', '10', '11', '12']
  return 'College' // simplified; refined server-side
}

export default function IndividualRegistrationForm({
  eventSlug,
  eventTitle,
}: {
  eventSlug: string
  eventTitle: string
}) {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    trigger,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      ethnicity: [],
      dietary_requirements: [],
    },
  })

  const ethnicity = watch('ethnicity') ?? []
  const dietary = watch('dietary_requirements') ?? []

  function toggleMulti(field: 'ethnicity' | 'dietary_requirements', value: string) {
    const current = getValues(field) ?? []
    const updated = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    setValue(field, updated, { shouldValidate: true })
  }

  async function nextStep() {
    const step1Fields: (keyof FormData)[] = [
      'first_name', 'last_name', 'email', 'phone', 'date_of_birth',
      'grade', 'gender', 'school_name', 't_shirt_size',
    ]
    const valid = await trigger(step === 1 ? step1Fields : undefined)
    if (valid) setStep((s) => s + 1)
  }

  async function onSubmit(data: FormData) {
    setSubmitting(true)
    setError(null)
    try {
      const dob = data.date_of_birth
      const age = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
      const hsGrades = ['9', '10', '11', '12']
      const age_bracket = age < 18 || hsGrades.includes(data.grade) ? 'High School'
        : data.grade.startsWith('College') || data.grade === 'Grad / PhD' ? 'College'
        : 'Adult'

      const res = await fetch('/api/register/individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          event_slug: eventSlug,
          event_title: eventTitle,
          age_bracket,
          event_role: age_bracket === 'High School' ? 'School Student' : 'Mentor',
        }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Registration failed')
      }

      const { registrationId } = await res.json()
      router.push(`/register/${eventSlug}/confirmation?id=${registrationId}&type=individual`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* ── Step 1: Personal Details ── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Personal Details</h2>
            <p className="text-sm text-gray-600">Step 1 of 2 — Tell us about yourself</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">First Name *</label>
                <input {...register('first_name')} className="input-field" placeholder="Jane" />
                <FieldError message={errors.first_name?.message} />
              </div>
              <div>
                <label className="label-text">Last Name *</label>
                <input {...register('last_name')} className="input-field" placeholder="Smith" />
                <FieldError message={errors.last_name?.message} />
              </div>
            </div>

            <div>
              <label className="label-text">Preferred Name / Nickname</label>
              <input {...register('nickname')} className="input-field" placeholder="Optional" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">Email Address *</label>
                <input {...register('email')} type="email" className="input-field" placeholder="jane@example.com" />
                <FieldError message={errors.email?.message} />
              </div>
              <div>
                <label className="label-text">Phone Number *</label>
                <input {...register('phone')} type="tel" className="input-field" placeholder="+1 555 000 0000" />
                <FieldError message={errors.phone?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">Date of Birth *</label>
                <input {...register('date_of_birth')} type="date" className="input-field" />
                <FieldError message={errors.date_of_birth?.message} />
              </div>
              <div>
                <label className="label-text">Grade / Year Level *</label>
                <select {...register('grade')} className="input-field">
                  <option value="">Select…</option>
                  {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <FieldError message={errors.grade?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">Gender *</label>
                <select {...register('gender')} className="input-field">
                  <option value="">Select…</option>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <FieldError message={errors.gender?.message} />
              </div>
              <div>
                <label className="label-text">T-Shirt Size *</label>
                <select {...register('t_shirt_size')} className="input-field">
                  <option value="">Select…</option>
                  {T_SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <FieldError message={errors.t_shirt_size?.message} />
              </div>
            </div>

            <div>
              <label className="label-text">School Name *</label>
              <input {...register('school_name')} className="input-field" placeholder="Lincoln High School" />
              <FieldError message={errors.school_name?.message} />
            </div>
          </div>

          <button type="button" onClick={nextStep} className="btn-primary w-full py-3">
            Continue →
          </button>
        </div>
      )}

      {/* ── Step 2: Emergency Contact + Health ── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Emergency Contact & Health</h2>
            <p className="text-sm text-gray-600">Step 2 of 2 — Required for all participants</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h3 className="font-semibold text-brand-blue-dark">Emergency Contact</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">First Name *</label>
                <input {...register('emergency_contact_first_name')} className="input-field" />
                <FieldError message={errors.emergency_contact_first_name?.message} />
              </div>
              <div>
                <label className="label-text">Last Name *</label>
                <input {...register('emergency_contact_last_name')} className="input-field" />
                <FieldError message={errors.emergency_contact_last_name?.message} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label-text">Email *</label>
                <input {...register('emergency_contact_email')} type="email" className="input-field" />
                <FieldError message={errors.emergency_contact_email?.message} />
              </div>
              <div>
                <label className="label-text">Phone *</label>
                <input {...register('emergency_contact_phone')} type="tel" className="input-field" />
                <FieldError message={errors.emergency_contact_phone?.message} />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h3 className="font-semibold text-brand-blue-dark">Ethnicity *</h3>
            <p className="text-xs text-gray-400 -mt-3">Select all that apply</p>
            <div className="grid grid-cols-2 gap-2">
              {ETHNICITIES.map((e) => (
                <label key={e} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ethnicity.includes(e)}
                    onChange={() => toggleMulti('ethnicity', e)}
                    className="rounded border-gray-300 text-brand-blue"
                  />
                  {e}
                </label>
              ))}
            </div>
            <FieldError message={errors.ethnicity?.message} />

            <h3 className="font-semibold text-brand-blue-dark pt-2">Dietary Requirements *</h3>
            <p className="text-xs text-gray-400 -mt-3">Select all that apply</p>
            <div className="grid grid-cols-2 gap-2">
              {DIETARY.map((d) => (
                <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dietary.includes(d)}
                    onChange={() => toggleMulti('dietary_requirements', d)}
                    className="rounded border-gray-300 text-brand-blue"
                  />
                  {d}
                </label>
              ))}
            </div>
            <FieldError message={errors.dietary_requirements?.message} />

            <div>
              <label className="label-text">Health Conditions / Allergies</label>
              <textarea
                {...register('health_conditions')}
                className="input-field resize-none"
                rows={3}
                placeholder="List any physical or health conditions we should be aware of, or leave blank if none."
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-outline flex-1 py-3"
            >
              ← Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary flex-1 py-3 disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit Registration'}
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center">
            By submitting you confirm all details are accurate. A confirmation email will be sent to you.
          </p>
        </div>
      )}
    </form>
  )
}
