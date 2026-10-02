'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'

// The privacy request form. Whatever is entered, a successful send reads the
// same: "check your email". It never says whether the address is known to us.

const KINDS: { value: string; label: string }[] = [
  { value: 'review', label: 'See the information you hold' },
  { value: 'correction', label: 'Correct something that is wrong' },
  { value: 'deletion', label: 'Delete the information' },
  { value: 'withdrawal', label: 'Withdraw a consent (for example photos, or messages to my child)' },
]

export function PrivacyRequestForm() {
  const [form, setForm] = useState({ kind: 'review', relationship: 'parent_guardian', requesterName: '', requesterEmail: '', subjectName: '', details: '', website: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    // The obvious gaps are caught here; the server checks everything again.
    const missing: Record<string, string> = {}
    if (!form.requesterName.trim()) missing.requesterName = 'Enter your name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.requesterEmail.trim())) missing.requesterEmail = 'Enter your email address.'
    if (form.relationship === 'parent_guardian' && !form.subjectName.trim()) missing.subjectName = 'Give your child’s name.'
    if (Object.keys(missing).length) {
      setErrors(missing)
      const first = Object.keys(missing)[0]
      return requestAnimationFrame(() => document.getElementById(`pr-${first}`)?.focus())
    }
    setBusy(true); setErrors({})
    const res = await fetch('/api/privacy-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, subjectName: form.relationship === 'self' ? '' : form.subjectName }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) return setSent(true)
    setErrors(data.fieldErrors ?? {})
    setMessage(data.error ?? 'Something went wrong. Please try again.')
    const first = Object.keys(data.fieldErrors ?? {})[0]
    if (first) requestAnimationFrame(() => document.getElementById(`pr-${first}`)?.focus())
  }

  if (sent) {
    return (
      <section role="status" className="rounded-ds-card border border-line bg-white p-6">
        <h2 className="font-display text-xl font-bold text-ink">Check your email</h2>
        <p className="mt-2 text-content-body">
          We have sent a link to {form.requesterEmail}. Follow it within 7 days to confirm your request. If it does not
          arrive in a few minutes, check your junk folder, or email privacy@stellreducation.org.
        </p>
      </section>
    )
  }

  const field = (name: string, label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label htmlFor={`pr-${name}`} className="block text-sm font-semibold text-ink">{label}</label>
      {hint && <p id={`pr-${name}-hint`} className="text-xs text-content-muted">{hint}</p>}
      {input}
      {errors[name] && <p id={`pr-${name}-error`} className="mt-1 text-sm text-danger">{errors[name]}</p>}
    </div>
  )
  const described = (name: string, hint?: boolean) => [hint ? `pr-${name}-hint` : '', errors[name] ? `pr-${name}-error` : ''].filter(Boolean).join(' ') || undefined
  const box = 'mt-1 w-full rounded-control border border-line px-3 py-2 text-ink'

  return (
    <form onSubmit={submit} noValidate className="space-y-5 rounded-ds-card border border-line bg-white p-6 sm:p-8">
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-ink">Who is the request about?</legend>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="relationship" value="parent_guardian" checked={form.relationship === 'parent_guardian'} onChange={set('relationship')} />
          My child (I am their parent or legal guardian)
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="radio" name="relationship" value="self" checked={form.relationship === 'self'} onChange={set('relationship')} />
          Me
        </label>
      </fieldset>
      {field('kind', 'What would you like us to do?',
        <select id="pr-kind" className={box} value={form.kind} onChange={set('kind')}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>)}
      {field('requesterName', 'Your full name',
        <input id="pr-requesterName" className={box} autoComplete="name" value={form.requesterName} onChange={set('requesterName')} aria-invalid={!!errors.requesterName} aria-describedby={described('requesterName')} />)}
      {field('requesterEmail', 'Your email address',
        <input id="pr-requesterEmail" type="email" className={box} autoComplete="email" value={form.requesterEmail} onChange={set('requesterEmail')} aria-invalid={!!errors.requesterEmail} aria-describedby={described('requesterEmail', true)} />,
        'Use the address you gave when you or your child registered, so we can find the records.')}
      {form.relationship === 'parent_guardian' && field('subjectName', 'Your child’s full name',
        <input id="pr-subjectName" className={box} value={form.subjectName} onChange={set('subjectName')} aria-invalid={!!errors.subjectName} aria-describedby={described('subjectName')} />)}
      {field('details', 'Anything else we should know (optional)',
        <textarea id="pr-details" rows={4} maxLength={2000} className={box} value={form.details} onChange={set('details')} aria-describedby={described('details', true)} />,
        'For example which event, or which consent you want to withdraw.')}
      {/* Left empty by people; bots fill every field. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="pr-website">Website</label>
        <input id="pr-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>
      <Button type="submit" variant="primaryStrong" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>
    </form>
  )
}
