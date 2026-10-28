'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Choice, Field, Input, Select } from '@stellr/web-ui'
import { usePrefillForm } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'

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
  reason: z.enum(PARTNER_TYPES, { error: 'Please choose an option' }),
  consent: z.literal(true, {
    error: 'You must agree to be contacted',
  }),
})

type FormData = z.infer<typeof schema>

const legendClass =
  'text-xs font-subheading font-semibold text-content-body uppercase tracking-[0.12em] pb-2 border-b border-line-light w-full'

export function JoinNetworkForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) })

  // Pre-fill from the signed-in member's record; never clobbers typing.
  usePrefillForm(reset, (p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
  }))

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/join-network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (res.ok) trackLeadSubmitted('join_network')
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
    // noValidate: the schema's messages show under each field instead of the
    // browser's bubbles. On a failed submit react-hook-form focuses the first
    // invalid field (shouldFocusError), and that field's error is read with it.
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {/* Personal */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Your Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First Name" required error={errors.firstName?.message}>
            <Input id="firstName" type="text" autoComplete="given-name" {...register('firstName')} placeholder="Jane" />
          </Field>
          <Field label="Last Name" required error={errors.lastName?.message}>
            <Input id="lastName" type="text" autoComplete="family-name" {...register('lastName')} placeholder="Smith" />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email" required error={errors.email?.message}>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              {...register('email')}
              placeholder="jane@example.com"
            />
          </Field>
          <Field label="Phone Number" required error={errors.phone?.message}>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              {...register('phone')}
              placeholder="+1 (555) 000-0000"
            />
          </Field>
        </div>
      </fieldset>

      {/* Business */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Business Details</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company Name" required error={errors.companyName?.message}>
            <Input
              id="companyName"
              type="text"
              autoComplete="organization"
              {...register('companyName')}
              placeholder="Acme STEM Labs"
            />
          </Field>
          <Field label="Address">
            <Input
              id="address"
              type="text"
              autoComplete="street-address"
              {...register('address')}
              placeholder="City, State, Country"
            />
          </Field>
        </div>
      </fieldset>

      <Field label="What do you do?" required error={errors.whatYouDo?.message}>
        <Input id="whatYouDo" type="text" {...register('whatYouDo')} placeholder="A sentence is plenty" />
      </Field>

      <Field label="What kind of partner are you?" required error={errors.reason?.message}>
        <Select id="reason" defaultValue="" {...register('reason')}>
          <option value="" disabled>
            Select an option…
          </option>
          {PARTNER_TYPES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>

      {/* Consent */}
      <div className="space-y-1.5">
        <Choice
          {...register('consent')}
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={errors.consent ? 'consent-error' : undefined}
          label={
            <span className="leading-relaxed text-content-secondary">
              I agree to Stellr Education contacting me about this inquiry, as described in our{' '}
              <a href="/privacy" className="font-semibold text-primary underline">
                Privacy Policy
              </a>
              .
            </span>
          }
        />
        {errors.consent?.message && (
          <p id="consent-error" className="text-sm text-danger">
            {errors.consent.message}
          </p>
        )}
      </div>

      {status === 'error' && (
        <p role="alert" className="text-sm text-danger bg-danger/5 border border-danger/30 rounded-control px-4 py-3">
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
