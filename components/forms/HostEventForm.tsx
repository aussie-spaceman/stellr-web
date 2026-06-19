'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { SchoolSearchInput, type SchoolSelection } from '@/components/member/SchoolSearchInput'
import FieldError from '@/components/forms/FieldError'

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(7, 'Please enter a valid phone number'),
  venueCapacity: z.string().min(1, 'Please provide an approximate capacity'),
  preferredTiming: z.string().min(1, 'Please indicate your preferred timing'),
  preferredDuration: z.string().min(1, 'Please indicate your preferred event duration'),
  funding: z.string().optional(),
  facilityOverheads: z.string().optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to be contacted' }),
  }),
})

type FormData = z.infer<typeof schema>

function schoolSelectionToFields(selection: SchoolSelection): { companySchool: string; address: string } {
  if (selection.type === 'existing') {
    return { companySchool: selection.name, address: '' }
  }
  const { name, address_line1, address_line2, city, state, postcode } = selection.data
  const address = [address_line1, address_line2, city, state, postcode].filter(Boolean).join(', ')
  return { companySchool: name, address }
}

const inputClass = (error: boolean) =>
  `w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue ${
    error ? 'border-red-400' : 'border-line'
  }`

export function HostEventForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [school, setSchool] = useState<SchoolSelection | null>(null)
  const [schoolError, setSchoolError] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    if (!school) {
      setSchoolError('Please select or add your organization.')
      return
    }
    setSchoolError('')
    setStatus('loading')
    const { companySchool, address } = schoolSelectionToFields(school)
    try {
      const res = await fetch('/api/host-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, companySchool, address }),
      })
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
        <p className="text-2xl mb-2">✓</p>
        <p className="font-bold text-green-800 text-lg">Expression of interest received!</p>
        <p className="text-green-700 mt-1 text-sm">
          We&apos;ll be in touch at the email address you provided, usually within 2 business days.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* Personal */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Personal Details
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className="block text-sm font-medium text-brand-blue-dark mb-1">
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              id="firstName"
              type="text"
              autoComplete="given-name"
              {...register('firstName')}
              className={inputClass(!!errors.firstName)}
              placeholder="Jane"
            />
            <FieldError message={errors.firstName?.message} />
          </div>
          <div>
            <label htmlFor="lastName" className="block text-sm font-medium text-brand-blue-dark mb-1">
              Last Name <span className="text-red-500">*</span>
            </label>
            <input
              id="lastName"
              type="text"
              autoComplete="family-name"
              {...register('lastName')}
              className={inputClass(!!errors.lastName)}
              placeholder="Smith"
            />
            <FieldError message={errors.lastName?.message} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-brand-blue-dark mb-1">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              {...register('email')}
              className={inputClass(!!errors.email)}
              placeholder="jane@example.com"
            />
            <FieldError message={errors.email?.message} />
          </div>
          <div>
            <label htmlFor="phone" className="block text-sm font-medium text-brand-blue-dark mb-1">
              Phone Number <span className="text-red-500">*</span>
            </label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              {...register('phone')}
              className={inputClass(!!errors.phone)}
              placeholder="+1 (555) 000-0000"
            />
            <FieldError message={errors.phone?.message} />
          </div>
        </div>
      </fieldset>

      {/* Facility */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Facility Details
        </legend>
        <div>
          <label className="block text-sm font-medium text-brand-blue-dark mb-1">
            Company / School <span className="text-red-500">*</span>
          </label>
          <SchoolSearchInput onChange={(s) => { setSchool(s); if (s) setSchoolError('') }} />
          {schoolError && <p className="mt-1 text-xs text-red-500">{schoolError}</p>}
        </div>
        <div>
          <label htmlFor="venueCapacity" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Approximate Venue Hosting Capacity <span className="text-red-500">*</span>
          </label>
          <input
            id="venueCapacity"
            type="text"
            {...register('venueCapacity')}
            className={inputClass(!!errors.venueCapacity)}
            placeholder="e.g. 50–100 students"
          />
          <FieldError message={errors.venueCapacity?.message} />
        </div>
      </fieldset>

      {/* Event Specifics */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Event Specifics
        </legend>
        <div>
          <label htmlFor="preferredTiming" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Preferred Timing <span className="text-red-500">*</span>
          </label>
          <input
            id="preferredTiming"
            type="text"
            {...register('preferredTiming')}
            className={inputClass(!!errors.preferredTiming)}
            placeholder="e.g. Spring 2026, or February–March"
          />
          <FieldError message={errors.preferredTiming?.message} />
        </div>
        <div>
          <label htmlFor="preferredDuration" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Preferred Event Duration <span className="text-red-500">*</span>
          </label>
          <input
            id="preferredDuration"
            type="text"
            {...register('preferredDuration')}
            className={inputClass(!!errors.preferredDuration)}
            placeholder="e.g. Full day, weekend, or 2–3 weeks part-time"
          />
          <FieldError message={errors.preferredDuration?.message} />
        </div>
      </fieldset>

      {/* Financial */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Financial
        </legend>
        <div>
          <label htmlFor="funding" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Is there any funding available to subsidize event costs?
          </label>
          <textarea
            id="funding"
            rows={3}
            {...register('funding')}
            className="w-full px-4 py-3 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none"
            placeholder="e.g. School district budget, grant funding, corporate sponsor, none"
          />
        </div>
        <div>
          <label htmlFor="facilityOverheads" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Any facility overheads we should be aware of?
          </label>
          <textarea
            id="facilityOverheads"
            rows={3}
            {...register('facilityOverheads')}
            className="w-full px-4 py-3 rounded-lg border border-line text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none"
            placeholder="e.g. Room hire fees, catering minimums, AV equipment rental"
          />
        </div>
      </fieldset>

      {/* Consent */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            {...register('consent')}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand-blue"
          />
          <span className="text-sm text-brand-grey-dark">
            I agree to Stellr Education contacting me in relation to this enquiry. View our{' '}
            <a href="/privacy" className="text-brand-blue hover:underline">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <FieldError message={errors.consent?.message} />
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          Something went wrong sending your submission. Please try again or email us directly at{' '}
          <a href="mailto:hello@stellreducation.org" className="underline">
            hello@stellreducation.org
          </a>
          .
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'loading'}
        className="btn-primary w-full justify-center disabled:opacity-60"
      >
        {status === 'loading' ? 'Submitting…' : 'Submit Expression of Interest'}
      </button>
    </form>
  )
}
