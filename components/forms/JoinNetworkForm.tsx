'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import FieldError from '@/components/forms/FieldError'

const REASONS = [
  'Network — looking to work with (other!) amazing people',
  'Adding Value — to my students and/or activities',
  'Just Want To Learn More',
] as const

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(7, 'Please enter a valid phone number'),
  companyName: z.string().min(1, 'Company name is required'),
  address: z.string().optional(),
  whatYouDo: z.string().min(1, 'Please tell us a little about what you do'),
  reason: z.enum(REASONS, { errorMap: () => ({ message: 'Please choose an option' }) }),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to be contacted' }),
  }),
})

type FormData = z.infer<typeof schema>

const inputClass = (error: boolean) =>
  `w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue ${
    error ? 'border-red-400' : 'border-line'
  }`

export function JoinNetworkForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/join-network', {
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
        <p className="font-bold text-green-800 text-lg">Welcome aboard — request received!</p>
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
          Your Details
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

      {/* Business */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Business Details
        </legend>
        <div>
          <label htmlFor="companyName" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Company Name <span className="text-red-500">*</span>
          </label>
          <input
            id="companyName"
            type="text"
            autoComplete="organization"
            {...register('companyName')}
            className={inputClass(!!errors.companyName)}
            placeholder="Acme STEM Labs"
          />
          <FieldError message={errors.companyName?.message} />
        </div>
        <div>
          <label htmlFor="address" className="block text-sm font-medium text-brand-blue-dark mb-1">
            Address
          </label>
          <input
            id="address"
            type="text"
            autoComplete="street-address"
            {...register('address')}
            className={inputClass(!!errors.address)}
            placeholder="City, State, Country"
          />
        </div>
        <div>
          <label htmlFor="whatYouDo" className="block text-sm font-medium text-brand-blue-dark mb-1">
            What do you do? <span className="text-red-500">*</span>
          </label>
          <textarea
            id="whatYouDo"
            rows={4}
            {...register('whatYouDo')}
            className={`${inputClass(!!errors.whatYouDo)} resize-none`}
            placeholder="Tell us about your organization, the STEM work you do, and who you serve."
          />
          <FieldError message={errors.whatYouDo?.message} />
        </div>
      </fieldset>

      {/* Why Stellr */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full">
          Why Stellr?
        </legend>
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-brand-blue-dark mb-1">
            What brings you to the network? <span className="text-red-500">*</span>
          </label>
          <select
            id="reason"
            defaultValue=""
            {...register('reason')}
            className={`${inputClass(!!errors.reason)} bg-white`}
          >
            <option value="" disabled>
              Select an option…
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <FieldError message={errors.reason?.message} />
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
          Something went wrong sending your request. Please try again or email us directly at{' '}
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
        {status === 'loading' ? 'Submitting…' : 'Join The Stellr Network'}
      </button>
    </form>
  )
}
