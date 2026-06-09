'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(7, 'Please enter a valid phone number'),
  address: z.string().min(5, 'Please enter your facility address'),
  companySchool: z.string().min(2, 'Please enter your organization name'),
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

const inputClass = (error: boolean) =>
  `w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue ${
    error ? 'border-red-400' : 'border-gray-200'
  }`

export function HostEventForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/host-event', {
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
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-gray-100 w-full">
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
            {errors.firstName && (
              <p className="mt-1 text-xs text-red-500">{errors.firstName.message}</p>
            )}
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
            {errors.lastName && (
              <p className="mt-1 text-xs text-red-500">{errors.lastName.message}</p>
            )}
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
            {errors.email && (
              <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>
            )}
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
            {errors.phone && (
              <p className="mt-1 text-xs text-red-500">{errors.phone.message}</p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Facility */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-gray-100 w-full">
          Facility Details
        </legend>
        <div>
          <label htmlFor="companySchool" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Company / School Name <span className="text-red-500">*</span>
          </label>
          <input
            id="companySchool"
            type="text"
            {...register('companySchool')}
            className={inputClass(!!errors.companySchool)}
            placeholder="Springfield High School"
          />
          {errors.companySchool && (
            <p className="mt-1 text-xs text-red-500">{errors.companySchool.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Facility Address <span className="text-red-500">*</span>
          </label>
          <input
            id="address"
            type="text"
            autoComplete="street-address"
            {...register('address')}
            className={inputClass(!!errors.address)}
            placeholder="123 Main St, Springfield, IL 62701"
          />
          {errors.address && (
            <p className="mt-1 text-xs text-red-500">{errors.address.message}</p>
          )}
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
          {errors.venueCapacity && (
            <p className="mt-1 text-xs text-red-500">{errors.venueCapacity.message}</p>
          )}
        </div>
      </fieldset>

      {/* Event Specifics */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-gray-100 w-full">
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
          {errors.preferredTiming && (
            <p className="mt-1 text-xs text-red-500">{errors.preferredTiming.message}</p>
          )}
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
          {errors.preferredDuration && (
            <p className="mt-1 text-xs text-red-500">{errors.preferredDuration.message}</p>
          )}
        </div>
      </fieldset>

      {/* Financial */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-gray-100 w-full">
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
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none"
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
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none"
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
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-blue"
          />
          <span className="text-sm text-brand-grey-dark">
            I agree to Stellr Education contacting me in relation to this enquiry. View our{' '}
            <a href="/privacy" className="text-brand-blue hover:underline">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p className="mt-1 text-xs text-red-500">{errors.consent.message}</p>
        )}
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          Something went wrong sending your submission. Please try again or email us directly at{' '}
          <a href="mailto:david.shaw@insimeducation.com" className="underline">
            david.shaw@insimeducation.com
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
