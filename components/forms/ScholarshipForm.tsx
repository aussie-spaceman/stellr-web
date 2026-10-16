'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Check } from 'lucide-react'
import { Field, Input, Select, Textarea } from '@stellr/web-ui'
import { usePrefillForm } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'

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

// Matches the asterisk the Field primitive puts on each required label.
const reqMark = <span className="text-danger">*</span>

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

  // Pre-fill from the signed-in member's record; never clobbers typing.
  usePrefillForm(reset, (p) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    school: p.schoolName,
  }))

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/scholarship', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (res.ok) trackLeadSubmitted('scholarship')
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center text-center py-6">
        <div className="w-16 h-16 rounded-full bg-enviro-green-bg flex items-center justify-center">
          <Check size={30} strokeWidth={2.4} className="text-enviro-green-text" />
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
    // noValidate: the schema's messages show under each field instead of the
    // browser's bubbles. On a failed submit react-hook-form focuses the first
    // invalid field (shouldFocusError), and that field's error is read with it.
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div>
        <h3 className="font-display text-[21px] font-bold text-ink">Scholarship application</h3>
        <p className="mt-1 text-sm text-content-muted">
          Fields marked {reqMark} are required.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="First name" required error={errors.firstName?.message}>
          <Input id="firstName" type="text" autoComplete="given-name" {...register('firstName')} />
        </Field>
        <Field label="Last name" required error={errors.lastName?.message}>
          <Input id="lastName" type="text" autoComplete="family-name" {...register('lastName')} />
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Email" required error={errors.email?.message}>
          <Input id="email" type="email" inputMode="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Phone">
          <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" {...register('phone')} />
        </Field>
      </div>

      <Field
        label="Stellr activity"
        required
        error={errors.activity?.message}
        hint={usedFallback ? 'Showing the standard event list…' : undefined}
      >
        <Select id="activity" defaultValue="" {...register('activity')}>
          <option value="" disabled>
            {hasActivities ? 'Select an activity…' : 'Loading events…'}
          </option>
          {activities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="School name">
        <Input id="school" type="text" autoComplete="organization" {...register('school')} />
      </Field>

      <Field label="Application brief" required error={errors.brief?.message}>
        <Textarea
          id="brief"
          rows={5}
          {...register('brief')}
          className="resize-y"
          placeholder="Tell us a little about why you're applying. You don't need to share more than you're comfortable with."
        />
      </Field>

      {(Object.keys(errors).length > 0 || status === 'error') && (
        <p
          role={status === 'error' ? 'alert' : undefined}
          className="rounded-control bg-danger/5 border border-danger/30 text-danger text-sm px-4 py-3"
        >
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
