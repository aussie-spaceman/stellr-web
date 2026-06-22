'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import FieldError from '@/components/forms/FieldError'

const PARTNER_TYPES = [
  'Fellow Education Provider [Industry]',
  'Interested College [University]',
  'Want To Support [Corporate]',
] as const

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Please enter a valid email address'),
  phone: z.string().min(7, 'Please enter a valid phone number'),
  companyName: z.string().min(1, 'Company name is required'),
  address: z.string().optional(),
  whatYouDo: z.string().min(1, 'Please tell us a little about what you do'),
  reason: z.enum(PARTNER_TYPES, { errorMap: () => ({ message: 'Please choose an option' }) }),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to be contacted' }),
  }),
})

type FormData = z.infer<typeof schema>

const inputClass = (error: boolean) =>
  `w-full px-4 py-3 rounded-control border text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary ${
    error ? 'border-red-400' : 'border-line'
  }`

const legendClass =
  'text-xs font-subheading font-semibold text-content-body uppercase tracking-[0.12em] pb-2 border-b border-line-light w-full'
const labelClass = 'block text-[13px] font-semibold text-content-body mb-1'

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
        <legend className={legendClass}>Your Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="firstName" className={labelClass}>
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
            <label htmlFor="lastName" className={labelClass}>
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
            <label htmlFor="email" className={labelClass}>
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
            <label htmlFor="phone" className={labelClass}>
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
        <legend className={legendClass}>Business Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="companyName" className={labelClass}>
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
            <label htmlFor="address" className={labelClass}>
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
        </div>
      </fieldset>

      <div>
        <label htmlFor="whatYouDo" className={labelClass}>
          What do you do? <span className="text-red-500">*</span>
        </label>
        <input
          id="whatYouDo"
          type="text"
          {...register('whatYouDo')}
          className={inputClass(!!errors.whatYouDo)}
          placeholder="A sentence is plenty"
        />
        <FieldError message={errors.whatYouDo?.message} />
      </div>

      <div>
        <label htmlFor="reason" className={labelClass}>
          What kind of partner are you? <span className="text-red-500">*</span>
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
          {PARTNER_TYPES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <FieldError message={errors.reason?.message} />
      </div>

      {/* Consent */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            {...register('consent')}
            className="mt-0.5 h-4 w-4 rounded border-line text-primary"
          />
          <span className="text-[13.5px] text-content-secondary leading-relaxed">
            I agree to Stellr Education contacting me about this enquiry, as described in our{' '}
            <a href="/privacy" className="font-semibold text-primary underline">
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
