'use client'

import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Choice, Field, Fieldset, Input, Textarea } from '@stellr/web-ui'
import { SchoolSearchInput, type SchoolSelection } from '@/components/member/SchoolSearchInput'
import { usePrefillForm } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'

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

const legendClass =
  'text-sm font-semibold text-brand-blue-dark uppercase tracking-wide pb-2 border-b border-line-light w-full'

const SCHOOL_REQUIRED = 'Please select or add your organization.'

export function HostEventForm() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [school, setSchool] = useState<SchoolSelection | null>(null)
  const [schoolError, setSchoolError] = useState('')
  const schoolRef = useRef<HTMLDivElement>(null)

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

  // The other fields failed: flag a missing organization too, so every
  // problem shows on the first submit. react-hook-form then focuses the first
  // invalid field it knows about.
  function onInvalid() {
    if (!school) setSchoolError(SCHOOL_REQUIRED)
  }

  async function onSubmit(data: FormData) {
    if (!school) {
      setSchoolError(SCHOOL_REQUIRED)
      schoolRef.current?.querySelector<HTMLInputElement>('input')?.focus()
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

      if (res.ok) trackLeadSubmitted('host_event')
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
    // noValidate: the schema's messages show under each field instead of the
    // browser's bubbles. On a failed submit react-hook-form focuses the first
    // invalid field (shouldFocusError); the organization picker is checked in
    // onInvalid / onSubmit and focused by hand, as it isn't a registered field.
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6" noValidate>
      {/* Personal */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Personal Details</legend>
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

      {/* Facility */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Facility Details</legend>
        {/* The school picker is a search box plus an "add new" sub-form, not one
            control, so it is named as a group. */}
        <div ref={schoolRef}>
          <Fieldset
            legend={
              <>
                Company / School <span className="text-danger" aria-hidden="true">*</span>
                <span className="sr-only"> (required)</span>
              </>
            }
            error={schoolError || undefined}
          >
            <SchoolSearchInput onChange={(s) => { setSchool(s); if (s) setSchoolError('') }} />
          </Fieldset>
        </div>
        <Field label="Approximate Venue Hosting Capacity" required error={errors.venueCapacity?.message}>
          <Input id="venueCapacity" type="text" {...register('venueCapacity')} placeholder="e.g. 50–100 students" />
        </Field>
      </fieldset>

      {/* Event Specifics */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Event Specifics</legend>
        <Field label="Preferred Timing" required error={errors.preferredTiming?.message}>
          <Input
            id="preferredTiming"
            type="text"
            {...register('preferredTiming')}
            placeholder="e.g. Spring 2026, or February–March"
          />
        </Field>
        <Field label="Preferred Event Duration" required error={errors.preferredDuration?.message}>
          <Input
            id="preferredDuration"
            type="text"
            {...register('preferredDuration')}
            placeholder="e.g. Full day, weekend, or 2–3 weeks part-time"
          />
        </Field>
      </fieldset>

      {/* Financial */}
      <fieldset className="space-y-4">
        <legend className={legendClass}>Financial</legend>
        <Field label="Is there any funding available to subsidize event costs?">
          <Textarea
            id="funding"
            rows={3}
            {...register('funding')}
            className="resize-none"
            placeholder="e.g. School district budget, grant funding, corporate sponsor, none"
          />
        </Field>
        <Field label="Any facility overheads we should be aware of?">
          <Textarea
            id="facilityOverheads"
            rows={3}
            {...register('facilityOverheads')}
            className="resize-none"
            placeholder="e.g. Room hire fees, catering minimums, AV equipment rental"
          />
        </Field>
      </fieldset>

      {/* Consent */}
      <div className="space-y-1.5">
        <Choice
          {...register('consent')}
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={errors.consent ? 'consent-error' : undefined}
          label={
            <>
              I agree to Stellr Education contacting me in relation to this inquiry. View our{' '}
              <a href="/privacy" className="font-semibold text-primary-deep underline">
                Privacy Policy
              </a>
              .
            </>
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
