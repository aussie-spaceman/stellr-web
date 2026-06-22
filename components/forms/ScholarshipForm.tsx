'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check } from 'lucide-react'
import FieldError from '@/components/forms/FieldError'

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().optional(),
  activity: z.string().min(1, 'Please choose a Stellr activity'),
  school: z.string().optional(),
  brief: z.string().min(1, 'Please tell us a little about your application'),
})

type FormData = z.infer<typeof schema>

const inputClass = (error: boolean) =>
  `w-full px-3.5 py-[11px] rounded-control border text-[15px] text-ink bg-white placeholder:text-content-faint focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary ${
    error ? 'border-red-400' : 'border-line'
  }`

const labelClass = 'block text-[13.5px] font-semibold text-ink mb-1.5'
const reqMark = <span className="text-primary">*</span>

export function ScholarshipForm({
  activities,
  usedFallback = false,
}: {
  activities: string[]
  usedFallback?: boolean
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/scholarship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center text-center py-6">
        <div className="w-16 h-16 rounded-full bg-enviro-green-bg flex items-center justify-center">
          <Check size={30} strokeWidth={2.4} className="text-enviro-green" />
        </div>
        <h3 className="font-display text-2xl font-bold text-ink mt-5">Thanks for submitting!</h3>
        <p className="mt-3 text-[15px] text-content-secondary leading-relaxed max-w-[380px]">
          Your application is on its way to our Scholarships Committee. We&rsquo;ll follow up by email — keep
          an eye on your inbox.
        </p>
        <button
          type="button"
          onClick={() => {
            reset()
            setStatus('idle')
          }}
          className="mt-6 inline-flex items-center justify-center rounded-control border-[1.5px] border-primary-deep px-6 py-3 text-sm font-subheading font-semibold text-primary-deep hover:bg-primary-soft transition-colors"
        >
          Submit another application
        </button>
      </div>
    )
  }

  const hasActivities = activities.length > 0

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div>
        <h3 className="font-display text-[21px] font-bold text-ink">Scholarship application</h3>
        <p className="mt-1 text-sm text-content-muted">
          Fields marked {reqMark} are required.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className={labelClass}>
            First name {reqMark}
          </label>
          <input
            id="firstName"
            type="text"
            autoComplete="given-name"
            {...register('firstName')}
            className={inputClass(!!errors.firstName)}
          />
          <FieldError message={errors.firstName?.message} />
        </div>
        <div>
          <label htmlFor="lastName" className={labelClass}>
            Last name {reqMark}
          </label>
          <input
            id="lastName"
            type="text"
            autoComplete="family-name"
            {...register('lastName')}
            className={inputClass(!!errors.lastName)}
          />
          <FieldError message={errors.lastName?.message} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="email" className={labelClass}>
            Email {reqMark}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            {...register('email')}
            className={inputClass(!!errors.email)}
          />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            {...register('phone')}
            className={inputClass(false)}
          />
        </div>
      </div>

      <div>
        <label htmlFor="activity" className={labelClass}>
          Stellr activity {reqMark}
        </label>
        <select
          id="activity"
          defaultValue=""
          {...register('activity')}
          className={`${inputClass(!!errors.activity)} appearance-none bg-[length:18px] bg-[right_14px_center] bg-no-repeat pr-10`}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236A708C' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
          }}
        >
          <option value="" disabled>
            {hasActivities ? 'Select an activity…' : 'Loading events…'}
          </option>
          {activities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <FieldError message={errors.activity?.message} />
        {usedFallback && (
          <p className="mt-1.5 text-xs text-content-faint">Showing the standard event list…</p>
        )}
      </div>

      <div>
        <label htmlFor="school" className={labelClass}>
          School name
        </label>
        <input id="school" type="text" {...register('school')} className={inputClass(false)} />
      </div>

      <div>
        <label htmlFor="brief" className={labelClass}>
          Application brief {reqMark}
        </label>
        <textarea
          id="brief"
          rows={5}
          {...register('brief')}
          className={`${inputClass(!!errors.brief)} min-h-[130px] resize-y`}
          placeholder="Tell us a little about why you're applying. You don't need to share more than you're comfortable with."
        />
        <FieldError message={errors.brief?.message} />
      </div>

      {(Object.keys(errors).length > 0 || status === 'error') && (
        <p className="rounded-control bg-[#FBECEA] border border-[#EAC9C4] text-[#9A4A41] text-[13.5px] px-4 py-3">
          {status === 'error'
            ? 'Something went wrong sending your application. Please try again, or email hello@stellreducation.org directly.'
            : 'Please complete all required fields before submitting.'}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'loading'}
        className="w-full inline-flex items-center justify-center rounded-control bg-primary px-[22px] py-3.5 text-[15.5px] font-subheading font-semibold text-white hover:bg-primary-deep transition-colors disabled:opacity-60"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit application'}
      </button>

      <p className="text-center text-[12.5px] text-content-faint">
        Submitting sends your application to the Stellr Scholarships Committee at
        hello@stellreducation.org.
      </p>
    </form>
  )
}
