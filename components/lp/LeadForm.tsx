'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@stellr/web-ui'
import FieldError from '@/components/forms/FieldError'
import { trackLeadSubmitted } from '@/lib/analytics'
import { trackBookingClick } from '@/components/lp/LpTracking'
import type { LandingPageConfig } from '@/content/lp/types'

/**
 * The lead form, and the booking hand-off it leads to.
 *
 * On success this redirects straight to the Motion calendar. Three rules make
 * that safe:
 *
 *   1. **Store the lead before anything navigates.** A lost lead is the only
 *      unrecoverable failure on this page — the visitor is gone and we never
 *      knew they came. So the redirect waits for the POST to resolve *and* for
 *      the route to confirm the lead actually reached HubSpot.
 *   2. **A failed write never redirects.** If the lead did not store, the card
 *      falls back to the manual booking panel with an error line, so the
 *      visitor can still book and we have told them the truth. Redirecting
 *      there would hand us a booking with no contact to attach it to.
 *   3. **Never promise payment.** The button says "Learn more now" and the
 *      reassurance line says so explicitly. Nothing here charges anyone.
 *
 * The Motion calendar does not support prefill — `?name=`/`?email=` and its own
 * `?e=` are all ignored (tested against the live page 2026-09-02) — so the copy
 * warns the visitor they will be asked again rather than pretending the
 * hand-off is seamless.
 */

const schema = z.object({
  name: z.string().min(1, 'Please tell us your name'),
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['teacher', 'parent', 'student']),
  // Coerced because a number input hands back a string, and an empty field
  // must stay undefined rather than becoming 0 — HubSpot would store the zero.
  students: z.coerce.number().int().min(1, 'Enter 1 or more').optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to be contacted' }),
  }),
})

type FormData = z.infer<typeof schema>

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const UTM_STORE = 'stellr_lp_utm'

/**
 * Capture attribution once and keep it.
 *
 * Read on mount and persisted to sessionStorage, because the visitor will click
 * "Reserve a spot" or "Learn More" — both anchors — and a scroll-and-return can
 * lose the query string. Falls back to the referrer host for `utm_source`,
 * which is how an untagged social post still attributes to somewhere.
 */
function useUtm(): Record<string, string> {
  const [utm, setUtm] = useState<Record<string, string>>({})

  useEffect(() => {
    let stored: Record<string, string> = {}
    try {
      stored = JSON.parse(sessionStorage.getItem(UTM_STORE) ?? '{}')
    } catch {
      // A private window or blocked storage is not a reason to lose the form.
      stored = {}
    }

    const params = new URLSearchParams(window.location.search)
    const fresh: Record<string, string> = {}
    for (const key of UTM_KEYS) {
      const value = params.get(key)
      if (value) fresh[key] = value
    }
    if (!fresh.utm_source && !stored.utm_source && document.referrer) {
      try {
        fresh.utm_source = new URL(document.referrer).hostname
      } catch {
        /* a malformed referrer is not worth a throw */
      }
    }

    const merged = { ...stored, ...fresh }
    setUtm(merged)
    try {
      sessionStorage.setItem(UTM_STORE, JSON.stringify(merged))
    } catch {
      /* nothing to do — the values still ride this page's submission */
    }
  }, [])

  return utm
}

const labelClass = 'block text-ds-meta font-semibold text-content'
const inputClass = (error: boolean) =>
  // 16px is deliberate and not on the type scale by accident: anything smaller
  // makes iOS Safari zoom the whole page on focus.
  `mt-1.5 w-full rounded-control border bg-white px-3.5 py-3 text-[16px] text-ink focus:border-primary focus:outline-none focus:outline-2 focus:outline-primary ${
    error ? 'border-danger' : 'border-line'
  }`

export function LeadForm({
  config, bookingUrl,
}: {
  config: LandingPageConfig
  bookingUrl: string
}) {
  const { form, audience, slug, analyticsSource } = config
  const utm = useUtm()
  const [state, setState] = useState<'form' | 'redirecting' | 'booking'>('form')
  const [failed, setFailed] = useState(false)
  const confirmHeading = useRef<HTMLHeadingElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { role: form.defaultRole, students: form.defaultStudents },
  })

  // Moving between card states is a context change, not a style change: send
  // focus to the new heading so a screen-reader user is not left reading a form
  // that is no longer there. Relevant even in the redirecting state, which is
  // what a slow or blocked navigation leaves on screen.
  useEffect(() => {
    if (state !== 'form') confirmHeading.current?.focus()
  }, [state])

  async function onSubmit(data: FormData) {
    setFailed(false)
    try {
      const res = await fetch('/api/lp-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          pageSlug: slug,
          audience,
          ...utm,
        }),
      })
      // res.ok is checked before the body is touched: parsing first turns a
      // 500 with an HTML error page into a JSON exception and loses the reason.
      //
      // The route answers 200 even when HubSpot rejected the write, because the
      // visitor must reach the calendar either way — so `stored`, not the
      // status code, is what says whether the lead actually landed. Firing the
      // conversion on the status code alone would report leads we do not have,
      // and every ad platform optimises against that event.
      const body: { stored?: boolean } = res.ok ? await res.json().catch(() => ({})) : {}
      if (res.ok && body.stored) {
        trackLeadSubmitted(analyticsSource, { lp_audience: audience, page_slug: slug })
        // Both events are pushed before navigating. GA4's tags send over
        // sendBeacon, which survives a same-tab navigation; a tag that did not
        // would lose the conversion, which is why nothing here waits on GTM.
        trackBookingClick({ audience, pageSlug: slug })
        setState('redirecting')
        if (bookingUrl) window.location.assign(bookingUrl)
        return
      }
      // Stored is false: the route accepted the request but HubSpot rejected the
      // write, and captureLead has already dead-lettered and alerted. Do not
      // redirect — a booking with no contact behind it is worse than a visitor
      // who was told plainly and given a working link.
      setFailed(true)
    } catch {
      // Network failure. The visitor still gets the booking step — better a
      // booked call we have to reconcile by hand than a dead end.
      setFailed(true)
    }
    setState('booking')
  }

  if (state === 'redirecting') {
    return (
      <div
        className="grid gap-4 rounded-panel border border-line bg-white p-7 lp-fade-in"
        aria-live="polite"
      >
        <p className="font-display text-ds-eyebrow font-bold uppercase text-content-faint">
          {form.confirm.eyebrow}
        </p>
        <h3
          ref={confirmHeading}
          tabIndex={-1}
          className="font-display text-[22px] font-bold tracking-heading text-ink focus:outline-none"
        >
          {form.redirect.heading}
        </h3>
        <p className="text-ds-body leading-relaxed text-content-secondary">{form.redirect.body}</p>
        <Button href={bookingUrl} variant="primary" className="w-full">
          {form.redirect.manual}
        </Button>
      </div>
    )
  }

  if (state === 'booking') {
    return (
      <div
        className="grid gap-4 rounded-panel border border-line bg-white p-7 lp-fade-in"
        aria-live="polite"
      >
        <p className="font-display text-ds-eyebrow font-bold uppercase text-content-faint">
          {form.confirm.eyebrow}
        </p>
        <h3
          ref={confirmHeading}
          tabIndex={-1}
          className="font-display text-[22px] font-bold tracking-heading text-ink focus:outline-none"
        >
          {form.confirm.heading}
        </h3>
        <p className="text-ds-body leading-relaxed text-content-secondary">{form.confirm.body}</p>
        <Button
          href={bookingUrl}
          variant="primary"
          className="w-full"
          onClick={() => trackBookingClick({ audience, pageSlug: slug })}
        >
          {form.confirm.cta}
        </Button>
        {failed ? (
          <p className="text-ds-meta leading-relaxed text-danger">
            We could not confirm your details were saved. Please book a time anyway, or email{' '}
            <a className="underline" href="mailto:hello@stellreducation.org">
              hello@stellreducation.org
            </a>{' '}
            so we can pick it up.
          </p>
        ) : (
          <p className="text-ds-meta leading-relaxed text-content-faint">{form.confirm.fallback}</p>
        )}
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="rounded-panel border border-line bg-white p-7"
    >
      <div className="grid gap-[18px]">
        <div>
          <label htmlFor="lp-name" className={labelClass}>
            Full name
          </label>
          <input
            id="lp-name"
            type="text"
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'lp-name-error' : undefined}
            className={inputClass(!!errors.name)}
            {...register('name')}
          />
          <FieldError id="lp-name-error" message={errors.name?.message} />
        </div>

        <div>
          <label htmlFor="lp-email" className={labelClass}>
            Email
          </label>
          <input
            id="lp-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'lp-email-error' : undefined}
            className={inputClass(!!errors.email)}
            {...register('email')}
          />
          <FieldError id="lp-email-error" message={errors.email?.message} />
        </div>

        <div className="grid gap-[18px] sm:grid-cols-2">
          <div>
            <label htmlFor="lp-role" className={labelClass}>
              I am a…
            </label>
            <select id="lp-role" className={inputClass(!!errors.role)} {...register('role')}>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent or guardian</option>
              <option value="student">Student</option>
            </select>
            <FieldError message={errors.role?.message} />
          </div>
          <div>
            <label htmlFor="lp-students" className={labelClass}>
              Students
            </label>
            <input
              id="lp-students"
              type="number"
              min={1}
              inputMode="numeric"
              aria-invalid={!!errors.students}
              aria-describedby={errors.students ? 'lp-students-error' : undefined}
              className={inputClass(!!errors.students)}
              {...register('students')}
            />
            <FieldError id="lp-students-error" message={errors.students?.message} />
          </div>
        </div>

        <div>
          <label htmlFor="lp-consent" className="flex items-start gap-2.5 text-ds-meta leading-relaxed text-content-secondary">
            <input
              id="lp-consent"
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              {...register('consent')}
            />
            <span>
              {form.consentLabel} View our{' '}
              <Link href="/privacy" className="font-medium text-primary-deep underline underline-offset-2 hover:no-underline">
                privacy policy
              </Link>
              .
            </span>
          </label>
          <FieldError message={errors.consent?.message} />
        </div>

        <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Sending…' : form.submitLabel}
        </Button>
        <p className="text-ds-meta leading-relaxed text-content-faint">{form.reassurance}</p>
      </div>
    </form>
  )
}
