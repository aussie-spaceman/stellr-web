'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Choice, Field, Input, Select } from '@stellr/web-ui'
import Link from '@/components/ui/SiteLink'
import { trackLeadSubmitted } from '@/lib/analytics'
import { useUtm } from '@/components/lp/useUtm'
import type { CurriculumLandingPageConfig } from '@/content/lp/cq-types'

/**
 * The curriculum request form (Classroom Qualifier pages).
 *
 * Teacher data only — the handover's minors rule. Students are a band, never
 * names. UTMs ride along as hidden values from useUtm(), which also persists
 * them across the anchor jumps the page's CTAs make.
 *
 * On success the card becomes the thank-you state in place: the free Educator
 * account link (where the curriculum lives) and, on the MnCOSE page, the
 * upgrade link with the booth code. Unlike the booking-call LeadForm nothing
 * navigates away, so the conversion is never at the mercy of a redirect.
 */

const schema = z.object({
  firstName: z.string().trim().min(1, 'Please enter your first name'),
  lastName: z.string().trim().min(1, 'Please enter your last name'),
  email: z.string().trim().email('Please enter your school email address'),
  school: z.string().trim().min(1, 'Please enter your school'),
  subject: z.string().trim().min(1, 'Please enter your course or subject'),
  studentsBand: z.enum(['1-25', '26-75', '76-150', '150+'], { error: 'Please choose a range' }),
  theme: z.enum(['space', 'enviro', 'not_sure'], { error: 'Please choose a theme' }),
  grantInterest: z.boolean(),
  consent: z.literal(true, { error: 'Please agree so we can send you the curriculum' }),
})

type FormData = z.infer<typeof schema>

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

export function CurriculumLeadForm({ config }: { config: CurriculumLandingPageConfig }) {
  const { form, slug } = config
  const utm = useUtm()
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  const successHeading = useRef<HTMLHeadingElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { grantInterest: false },
  })

  // A context change, not a style change: move focus to the new heading.
  useEffect(() => {
    if (done) successHeading.current?.focus()
  }, [done])

  async function onSubmit(data: FormData) {
    setFailed(false)
    try {
      const res = await fetch('/api/cq-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, pageSlug: slug, ...utm }),
      })
      const body: { stored?: boolean } = res.ok ? await res.json().catch(() => ({})) : {}
      if (res.ok && body.stored) {
        // The conversion fires only on a lead that actually landed.
        trackLeadSubmitted('landing_page_teacher', {
          page_slug: slug,
          lp_audience: 'classroom_qualifier_teacher',
          cq_theme: data.theme,
        })
      } else {
        setFailed(true)
      }
    } catch {
      setFailed(true)
    }
    // The teacher reaches the curriculum either way; a failed write has
    // already dead-lettered and alerted on the server.
    setDone(true)
  }

  if (done) {
    const { success } = form
    return (
      <div className="grid gap-4 rounded-panel border border-line bg-white p-7" aria-live="polite">
        <h3
          ref={successHeading}
          tabIndex={-1}
          className="font-display text-xl font-bold tracking-heading text-ink focus:outline-hidden"
        >
          {success.heading}
        </h3>
        <p className="text-ds-body leading-relaxed text-content-secondary">{success.body}</p>
        <div className="flex flex-wrap gap-3">
          <Button href={`${AUTH_URL}/sign-up`}>{success.accountCta}</Button>
          {success.upgrade && (
            <Button href={success.upgrade.href} as={Link} variant="secondary">
              {success.upgrade.label}
            </Button>
          )}
        </div>
        {success.upgrade && <p className="text-ds-meta text-content-muted">{success.upgrade.note}</p>}
        {failed && (
          <p className="text-ds-meta text-danger">
            We could not confirm your details were saved. If nothing reaches your inbox, email
            hello@stellreducation.org.
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-4 rounded-panel border border-line bg-white p-7"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message} required>
          <Input autoComplete="given-name" {...register('firstName')} />
        </Field>
        <Field label="Last name" error={errors.lastName?.message} required>
          <Input autoComplete="family-name" {...register('lastName')} />
        </Field>
      </div>
      <Field label="School email" error={errors.email?.message} required>
        <Input type="email" autoComplete="email" inputMode="email" {...register('email')} />
      </Field>
      <Field label="School name" error={errors.school?.message} required>
        <Input autoComplete="organization" {...register('school')} />
      </Field>
      <Field label="Course or subject" hint="e.g. Physics, Earth Science, CTE" error={errors.subject?.message} required>
        <Input {...register('subject')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Number of students" error={errors.studentsBand?.message} required>
          <Select defaultValue="" {...register('studentsBand')}>
            <option value="" disabled>Choose…</option>
            <option value="1-25">1–25</option>
            <option value="26-75">26–75</option>
            <option value="76-150">76–150</option>
            <option value="150+">150+</option>
          </Select>
        </Field>
        <Field label="Theme" error={errors.theme?.message} required>
          <Select defaultValue="" {...register('theme')}>
            <option value="" disabled>Choose…</option>
            <option value="space">Space Mission Design</option>
            <option value="enviro">Environmental Design</option>
            <option value="not_sure">Not sure yet</option>
          </Select>
        </Field>
      </div>
      <Choice label="I’m interested in the Teacher Grant" {...register('grantInterest')} />
      <div>
        <Choice label={form.consentLabel} {...register('consent')} />
        {errors.consent && <p className="text-sm text-danger">{errors.consent.message}</p>}
      </div>
      <Button type="submit" disabled={isSubmitting} className="w-full justify-center">
        {isSubmitting ? 'Sending…' : form.submitLabel}
      </Button>
      <p className="text-ds-meta text-content-muted">{form.lead}</p>
    </form>
  )
}
