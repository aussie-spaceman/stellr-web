'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Choice, Field, Input, Select, Textarea } from '@stellr/web-ui'
import { usePrefillForm } from '@/components/forms/useMemberPrefill'
import { trackLeadSubmitted } from '@/lib/analytics'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  type: z.string().min(1, 'Please select an inquiry type'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  consent: z.literal(true, { error: 'You must agree to be contacted' }),
})

type FormData = z.infer<typeof schema>

const ENQUIRY_TYPES = [
  { value: '', label: 'Select inquiry type…' },
  { value: 'General', label: 'General' },
  { value: 'Event Registration Help', label: 'Event Registration Help' },
  { value: 'Sponsorship / Donation', label: 'Sponsorship / Donation' },
  { value: 'Volunteer / Mentor', label: 'Volunteer / Mentor' },
  { value: 'Media', label: 'Media' },
  { value: 'Other', label: 'Other' },
]

// `/contact?type=mentor` and `?type=sponsorship` deep links pick the inquiry
// type. Read in the browser, so /contact stays a static page.
const TYPE_FROM_QUERY: Record<string, string> = {
  mentor: 'Volunteer / Mentor',
  sponsorship: 'Sponsorship / Donation',
}

export function ContactForm({ prefillType }: { prefillType?: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: prefillType ?? '' },
  })

  useEffect(() => {
    if (prefillType) return
    const fromQuery = TYPE_FROM_QUERY[new URLSearchParams(window.location.search).get('type') ?? '']
    if (fromQuery && !getValues('type')) setValue('type', fromQuery)
  }, [prefillType, getValues, setValue])

  // Pre-fill from the signed-in member's record; never clobbers typing.
  usePrefillForm(reset, (p) => ({
    name: [p.firstName, p.lastName].filter(Boolean).join(' '),
    email: p.email,
  }))

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) trackLeadSubmitted('contact')
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
        <p className="text-2xl mb-2">✓</p>
        <p className="font-bold text-green-800 text-lg">Message sent!</p>
        <p className="text-green-700 mt-1 text-sm">
          We&apos;ll get back to you at the email address you provided, usually within 2 business days.
        </p>
      </div>
    )
  }

  return (
    // noValidate: the schema's messages show under each field instead of the
    // browser's bubbles. On a failed submit react-hook-form focuses the first
    // invalid field (shouldFocusError), and that field's error is read with it.
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <Field label="Name" required error={errors.name?.message}>
        <Input id="name" type="text" autoComplete="name" {...register('name')} placeholder="Your full name" />
      </Field>

      <Field label="Email" required error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          {...register('email')}
          placeholder="your@email.com"
        />
      </Field>

      <Field label="Inquiry Type" required error={errors.type?.message}>
        <Select id="type" {...register('type')}>
          {ENQUIRY_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.value === ''}>
              {opt.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Message" required error={errors.message?.message}>
        <Textarea id="message" rows={5} {...register('message')} className="resize-none" placeholder="How can we help?" />
      </Field>

      <div className="space-y-1.5">
        <Choice
          {...register('consent')}
          aria-invalid={errors.consent ? true : undefined}
          aria-describedby={errors.consent ? 'consent-error' : undefined}
          label={
            <>
              I agree to Stellr Education contacting me in relation to my inquiry. View our{' '}
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
          Something went wrong sending your message. Please try again or email us directly at{' '}
          <a href="mailto:hello@stellreducation.org" className="underline">hello@stellreducation.org</a>.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'loading'}
        className="btn-primary w-full justify-center disabled:opacity-60"
      >
        {status === 'loading' ? 'Sending…' : 'Send Message'}
      </button>
    </form>
  )
}
