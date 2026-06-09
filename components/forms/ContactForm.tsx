'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  type: z.string().min(1, 'Please select an enquiry type'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
  consent: z.literal(true, { errorMap: () => ({ message: 'You must agree to be contacted' }) }),
})

type FormData = z.infer<typeof schema>

const ENQUIRY_TYPES = [
  { value: '', label: 'Select enquiry type…' },
  { value: 'General', label: 'General' },
  { value: 'Event Registration Help', label: 'Event Registration Help' },
  { value: 'Sponsorship / Donation', label: 'Sponsorship / Donation' },
  { value: 'Volunteer / Mentor', label: 'Volunteer / Mentor' },
  { value: 'Media', label: 'Media' },
  { value: 'Other', label: 'Other' },
]

export function ContactForm({ prefillType }: { prefillType?: string }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: prefillType ?? '' },
  })

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/contact', {
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
        <p className="font-bold text-green-800 text-lg">Message sent!</p>
        <p className="text-green-700 mt-1 text-sm">
          We&apos;ll get back to you at the email address you provided, usually within 2 business days.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {/* Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-brand-blue-dark mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="name"
          type="text"
          autoComplete="name"
          {...register('name')}
          className={`w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue ${
            errors.name ? 'border-red-400' : 'border-gray-200'
          }`}
          placeholder="Your full name"
        />
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
      </div>

      {/* Email */}
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-brand-blue-dark mb-1">
          Email <span className="text-red-500">*</span>
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          {...register('email')}
          className={`w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue ${
            errors.email ? 'border-red-400' : 'border-gray-200'
          }`}
          placeholder="your@email.com"
        />
        {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
      </div>

      {/* Enquiry type */}
      <div>
        <label htmlFor="type" className="block text-sm font-medium text-brand-blue-dark mb-1">
          Enquiry Type <span className="text-red-500">*</span>
        </label>
        <select
          id="type"
          {...register('type')}
          className={`w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue bg-white ${
            errors.type ? 'border-red-400' : 'border-gray-200'
          }`}
        >
          {ENQUIRY_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.value === ''}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.type && <p className="mt-1 text-xs text-red-500">{errors.type.message}</p>}
      </div>

      {/* Message */}
      <div>
        <label htmlFor="message" className="block text-sm font-medium text-brand-blue-dark mb-1">
          Message <span className="text-red-500">*</span>
        </label>
        <textarea
          id="message"
          rows={5}
          {...register('message')}
          className={`w-full px-4 py-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue resize-none ${
            errors.message ? 'border-red-400' : 'border-gray-200'
          }`}
          placeholder="How can we help?"
        />
        {errors.message && <p className="mt-1 text-xs text-red-500">{errors.message.message}</p>}
      </div>

      {/* Consent */}
      <div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            {...register('consent')}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-blue"
          />
          <span className="text-sm text-brand-grey-dark">
            I agree to Stellr Education contacting me in relation to my enquiry. View our{' '}
            <a href="/privacy" className="text-brand-blue hover:underline">Privacy Policy</a>.
          </span>
        </label>
        {errors.consent && <p className="mt-1 text-xs text-red-500">{errors.consent.message}</p>}
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
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
