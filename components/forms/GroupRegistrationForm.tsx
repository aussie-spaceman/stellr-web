'use client'

import { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import FieldError from '@/components/forms/FieldError'

const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GENDERS = ['Male', 'Female', 'Other']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

const participantSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Required'),
  date_of_birth: z.string().min(1, 'Required'),
  grade: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  emergency_contact_first_name: z.string().min(1, 'Required'),
  emergency_contact_last_name: z.string().min(1, 'Required'),
  emergency_contact_email: z.string().email('Valid email required'),
  emergency_contact_phone: z.string().min(7, 'Required'),
  health_conditions: z.string().optional(),
})

const schema = z.object({
  teacher_first_name: z.string().min(1, 'Required'),
  teacher_last_name: z.string().min(1, 'Required'),
  teacher_email: z.string().email('Valid email required'),
  school_name: z.string().min(1, 'Required'),
  school_address_street: z.string().min(1, 'Required'),
  school_address_city: z.string().min(1, 'Required'),
  school_address_state: z.string().min(1, 'Required'),
  school_address_zip: z.string().min(5, 'Valid ZIP required'),
  participants: z.array(participantSchema).min(2, 'At least 2 students required'),
})

type FormData = z.infer<typeof schema>

const emptyParticipant = {
  first_name: '', last_name: '', email: '', phone: '',
  date_of_birth: '', grade: '', gender: '', t_shirt_size: '',
  emergency_contact_first_name: '', emergency_contact_last_name: '',
  emergency_contact_email: '', emergency_contact_phone: '',
  health_conditions: '',
}

export default function GroupRegistrationForm({
  eventSlug,
  eventTitle,
  capacity,
}: {
  eventSlug: string
  eventTitle: string
  capacity?: number
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      participants: [emptyParticipant, emptyParticipant],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'participants' })

  async function onSubmit(data: FormData) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/register/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, event_slug: eventSlug, event_title: eventTitle }),
      })

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Registration failed')
      }

      const { registrationId } = await res.json()
      router.push(`/register/${eventSlug}/confirmation?id=${registrationId}&type=group`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  const participantErrors = errors.participants

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Teacher / Coordinator Details */}
      <div>
        <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Teacher / Coordinator Details</h2>
        <p className="text-sm text-gray-600 mb-5">The invoice will be sent to this email address.</p>

        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-text">First Name *</label>
              <input {...register('teacher_first_name')} className="input-field" />
              <FieldError message={errors.teacher_first_name?.message} />
            </div>
            <div>
              <label className="label-text">Last Name *</label>
              <input {...register('teacher_last_name')} className="input-field" />
              <FieldError message={errors.teacher_last_name?.message} />
            </div>
          </div>

          <div>
            <label className="label-text">Email Address *</label>
            <input {...register('teacher_email')} type="email" className="input-field" />
            <FieldError message={errors.teacher_email?.message} />
          </div>

          <div>
            <label className="label-text">School Name *</label>
            <input {...register('school_name')} className="input-field" placeholder="Lincoln High School" />
            <FieldError message={errors.school_name?.message} />
          </div>

          <div>
            <label className="label-text">Street Address *</label>
            <input {...register('school_address_street')} className="input-field" />
            <FieldError message={errors.school_address_street?.message} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="col-span-2">
              <label className="label-text">City *</label>
              <input {...register('school_address_city')} className="input-field" />
              <FieldError message={errors.school_address_city?.message} />
            </div>
            <div>
              <label className="label-text">State *</label>
              <select {...register('school_address_state')} className="input-field">
                <option value="">—</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <FieldError message={errors.school_address_state?.message} />
            </div>
            <div>
              <label className="label-text">ZIP *</label>
              <input {...register('school_address_zip')} className="input-field" maxLength={10} />
              <FieldError message={errors.school_address_zip?.message} />
            </div>
          </div>
        </div>
      </div>

      {/* Participants */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-bold text-brand-blue-dark">Participants</h2>
          <span className="text-sm text-gray-400">{fields.length} student{fields.length !== 1 ? 's' : ''}</span>
        </div>
        <p className="text-sm text-gray-600 mb-5">
          Minimum 2 students required.
          {capacity ? ` Maximum ${capacity} participants for this event.` : ''}
        </p>

        {typeof participantErrors === 'object' && 'message' in participantErrors && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {(participantErrors as { message?: string }).message}
          </div>
        )}

        <div className="space-y-3">
          {fields.map((field, idx) => {
            const pErrors = (participantErrors as Record<number, Record<string, { message?: string }>> | undefined)?.[idx]
            const isOpen = expandedIdx === idx

            return (
              <div key={field.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Accordion header */}
                <button
                  type="button"
                  onClick={() => setExpandedIdx(isOpen ? null : idx)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <span className="font-medium text-brand-blue-dark">
                    Student {idx + 1}
                    {field.first_name && field.last_name
                      ? ` — ${field.first_name} ${field.last_name}`
                      : ''}
                  </span>
                  <div className="flex items-center gap-3">
                    {fields.length > 2 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove(idx) }}
                        className="text-red-400 hover:text-red-600 p-1"
                        aria-label="Remove student"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <span className="text-gray-400 text-sm">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-5 pb-5 space-y-4 border-t border-gray-100">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4">
                      <div>
                        <label className="label-text">First Name *</label>
                        <input {...register(`participants.${idx}.first_name`)} className="input-field" />
                        <FieldError message={pErrors?.first_name?.message} />
                      </div>
                      <div>
                        <label className="label-text">Last Name *</label>
                        <input {...register(`participants.${idx}.last_name`)} className="input-field" />
                        <FieldError message={pErrors?.last_name?.message} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="label-text">Email *</label>
                        <input {...register(`participants.${idx}.email`)} type="email" className="input-field" />
                        <FieldError message={pErrors?.email?.message} />
                      </div>
                      <div>
                        <label className="label-text">Phone *</label>
                        <input {...register(`participants.${idx}.phone`)} type="tel" className="input-field" />
                        <FieldError message={pErrors?.phone?.message} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="label-text">Date of Birth *</label>
                        <input {...register(`participants.${idx}.date_of_birth`)} type="date" className="input-field" />
                        <FieldError message={pErrors?.date_of_birth?.message} />
                      </div>
                      <div>
                        <label className="label-text">Grade *</label>
                        <select {...register(`participants.${idx}.grade`)} className="input-field">
                          <option value="">Select…</option>
                          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <FieldError message={pErrors?.grade?.message} />
                      </div>
                      <div>
                        <label className="label-text">Gender *</label>
                        <select {...register(`participants.${idx}.gender`)} className="input-field">
                          <option value="">Select…</option>
                          {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                        </select>
                        <FieldError message={pErrors?.gender?.message} />
                      </div>
                    </div>

                    <div>
                      <label className="label-text">T-Shirt Size *</label>
                      <select {...register(`participants.${idx}.t_shirt_size`)} className="input-field w-full sm:w-40">
                        <option value="">Select…</option>
                        {T_SHIRT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <FieldError message={pErrors?.t_shirt_size?.message} />
                    </div>

                    <div className="border-t border-gray-100 pt-4">
                      <p className="text-sm font-semibold text-brand-blue-dark mb-3">Emergency Contact</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="label-text">First Name *</label>
                          <input {...register(`participants.${idx}.emergency_contact_first_name`)} className="input-field" />
                          <FieldError message={pErrors?.emergency_contact_first_name?.message} />
                        </div>
                        <div>
                          <label className="label-text">Last Name *</label>
                          <input {...register(`participants.${idx}.emergency_contact_last_name`)} className="input-field" />
                          <FieldError message={pErrors?.emergency_contact_last_name?.message} />
                        </div>
                        <div>
                          <label className="label-text">Email *</label>
                          <input {...register(`participants.${idx}.emergency_contact_email`)} type="email" className="input-field" />
                          <FieldError message={pErrors?.emergency_contact_email?.message} />
                        </div>
                        <div>
                          <label className="label-text">Phone *</label>
                          <input {...register(`participants.${idx}.emergency_contact_phone`)} type="tel" className="input-field" />
                          <FieldError message={pErrors?.emergency_contact_phone?.message} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="label-text">Health Conditions / Allergies</label>
                      <textarea
                        {...register(`participants.${idx}.health_conditions`)}
                        className="input-field resize-none"
                        rows={2}
                        placeholder="Leave blank if none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => { append(emptyParticipant); setExpandedIdx(fields.length) }}
          className="mt-4 flex items-center gap-2 text-brand-blue text-sm font-medium hover:underline"
        >
          <Plus size={16} /> Add another student
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-sm text-brand-blue-dark space-y-1">
        <p className="font-semibold">What happens next?</p>
        <ul className="list-disc list-inside text-gray-600 space-y-1">
          <li>You&apos;ll receive a confirmation email with a summary of your group registration</li>
          <li>An invoice will be issued to <strong>{'{your email}'}</strong> within 1–2 business days</li>
          <li>Registration is confirmed upon receipt of payment</li>
        </ul>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full py-4 text-base disabled:opacity-60"
      >
        {submitting ? 'Submitting…' : `Submit Group Registration (${fields.length} students)`}
      </button>

      <p className="text-xs text-gray-400 text-center">
        By submitting you confirm all participant details are accurate and you have permission to submit on their behalf.
      </p>
    </form>
  )
}
