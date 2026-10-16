'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Choice, Field, Fieldset, Input, Select, Textarea } from '@stellr/web-ui'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { GENDERS } from '@/lib/registration-constants'
import { GRANT_PLACES, GRANT_PROGRAM_YEAR, GRANT_THRESHOLDS } from '@/lib/grant'

const hintClass = 'mt-1 text-xs text-content-muted'
const legendClass = 'font-display text-base font-semibold text-ink mb-4'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY',
]

/**
 * Mirrors the schema in app/api/teacher-grant/route.ts. This copy exists to
 * give the person filling the form a useful message next to the field they got
 * wrong; the server's copy is the one that decides what is accepted.
 */
const schema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name'),
  lastName: z.string().trim().min(1, 'Enter your last name'),
  email: z.string().trim().email('Please enter a valid email address'),
  phone: z.string().trim().optional(),
  yearsTeaching: z.string().trim().optional(),
  // Date of birth and gender are not idle curiosity: `members.date_of_birth`
  // and `members.gender` are NOT NULL with no default, so without them the
  // applicant cannot be created as an Educator at all.
  dateOfBirth: z.string().trim().min(1, 'Enter your date of birth'),
  gender: z.string().min(1, 'Select an option'),
  schoolName: z.string().trim().min(1, 'Tell us where you teach'),
  schoolCity: z.string().trim().min(1, "Enter your school's city"),
  schoolState: z.string().min(1, 'Select a state'),
  subjects: z.string().trim().min(1, 'Tell us what you teach'),
  plannedActivities: z.enum(['challenge', 'campaign', 'both'], {
    errorMap: () => ({ message: 'Choose what you plan to run' }),
  }),
  expectedStudents: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, 'Give us a rough whole number'),
  priorStellr: z.enum(['yes', 'no']).optional(),
  motivation: z.string().trim().min(40, 'A couple of sentences, please — at least 40 characters'),
  referralSource: z.string().trim().optional(),
  acknowledgePayment: z.literal(true, {
    errorMap: () => ({ message: 'Please confirm you have read how payment works' }),
  }),
  consent: z.literal(true, {
    errorMap: () => ({ message: 'We need your agreement to contact you' }),
  }),
  /** Honeypot — see the note in the route. Must stay empty. */
  website: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export default function TeacherGrantForm({
  programYear = GRANT_PROGRAM_YEAR,
  prefill,
}: {
  programYear?: string
  /** The signed-in member's record, resolved on the server — see /grant. */
  prefill?: RegistrationPrefill | null
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    // Prefill is resolved server-side and arrives with the first render, so
    // these are real defaults — no post-mount reset, and nothing to clobber.
    defaultValues: {
      website: '',
      firstName: prefill?.first_name ?? '',
      lastName: prefill?.last_name ?? '',
      email: prefill?.email ?? '',
      phone: prefill?.phone ?? '',
      dateOfBirth: prefill?.date_of_birth ?? '',
      gender: prefill?.gender ?? '',
      schoolName: prefill?.school_name ?? '',
    },
  })

  async function onSubmit(data: FormData) {
    setStatus('loading')
    try {
      const res = await fetch('/api/teacher-grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) trackLeadSubmitted('teacher_grant')
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="bg-enviro-green-bg border border-enviro-green/30 rounded-panel p-8 text-center">
        <p className="text-2xl mb-2">✓</p>
        <p className="font-display font-semibold text-enviro-green-text text-lg">
          Application received
        </p>
        <p className="text-enviro-green-text mt-1 text-sm">
          Thanks — you&rsquo;re registered as a Stellr Educator, and we&rsquo;ll be in touch at the
          email address you gave us. We read every application and reply to all of them, whether or
          not you get a place.
        </p>
      </div>
    )
  }

  // A failed submit moves focus to the first field that failed, in page order
  // (react-hook-form's shouldFocusError, on by default; the primitives pass the
  // ref through), and that field's error is read out with it. Without it the
  // messages appear somewhere up the page and a keyboard or screen-reader user
  // is left at the submit button with no idea what happened.
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      {/* Honeypot. Positioned off-screen rather than display:none — better bots
          skip hidden fields precisely because they read as traps. */}
      <div aria-hidden="true" className="absolute left-[-9999px] w-px h-px overflow-hidden">
        <label htmlFor="grant-website">Website</label>
        <input
          id="grant-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register('website')}
        />
      </div>

      {/* ── About you ── */}
      <fieldset>
        <legend className={legendClass}>About you</legend>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="First name" required error={errors.firstName?.message}>
              <Input id="firstName" type="text" autoComplete="given-name" {...register('firstName')} />
            </Field>
            <Field label="Last name" required error={errors.lastName?.message}>
              <Input id="lastName" type="text" autoComplete="family-name" {...register('lastName')} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Email"
              required
              error={errors.email?.message}
              hint={
                prefill?.email
                  ? "You're signed in, so we'll use your Stellr account email."
                  : 'Use your school address if you have one.'
              }
            >
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                readOnly={Boolean(prefill?.email)}
                {...register('email')}
                className="read-only:bg-surface read-only:text-content-secondary"
              />
            </Field>
            <Field label="Phone" hint="Optional.">
              <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" {...register('phone')} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Date of birth" required error={errors.dateOfBirth?.message}>
              <Input id="dateOfBirth" type="date" autoComplete="bday" {...register('dateOfBirth')} />
            </Field>
            <Field label="Gender" required error={errors.gender?.message}>
              <Select id="gender" {...register('gender')}>
                <option value="" disabled>
                  Select…
                </option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Years teaching" hint="Optional.">
              <Input id="yearsTeaching" type="text" inputMode="numeric" {...register('yearsTeaching')} placeholder="e.g. 8" />
            </Field>
          </div>
          <p className={hintClass}>
            We ask for your date of birth and gender because they&rsquo;re required on your Stellr
            member record — the same details every Stellr registration collects.
          </p>
        </div>
      </fieldset>

      {/* ── Where you teach ── */}
      <fieldset>
        <legend className={legendClass}>Where you teach</legend>
        <div className="space-y-5">
          <Field label="High school" required error={errors.schoolName?.message}>
            <Input id="schoolName" type="text" autoComplete="organization" {...register('schoolName')} />
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="City" required error={errors.schoolCity?.message} className="sm:col-span-2">
              <Input id="schoolCity" type="text" autoComplete="address-level2" {...register('schoolCity')} />
            </Field>
            <Field label="State" required error={errors.schoolState?.message}>
              <Select id="schoolState" autoComplete="address-level1" {...register('schoolState')} defaultValue="">
                <option value="" disabled>
                  Select…
                </option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className={hintClass}>
            The {programYear} pilot is open to U.S. high school teachers only.
          </p>

          <Field label="Subjects you teach" required error={errors.subjects?.message}>
            <Input id="subjects" type="text" {...register('subjects')} placeholder="e.g. Physics, Engineering" />
          </Field>
        </div>
      </fieldset>

      {/* ── Your plan ── */}
      <fieldset>
        <legend className={legendClass}>What you plan to run</legend>
        <div className="space-y-5">
          <Fieldset
            legend={
              <>
                In {programYear}, you plan to <span className="text-danger" aria-hidden="true">*</span>
                <span className="sr-only"> (required)</span>
              </>
            }
            error={errors.plannedActivities?.message}
          >
            {[
              {
                value: 'challenge',
                label: 'Bring a team to a live Challenge',
                hint: 'You travel to the venue with your students.',
              },
              {
                value: 'campaign',
                label: 'Run a Campaign at my school',
                hint: 'You run it remotely, in class or as a club.',
              },
              { value: 'both', label: 'Both', hint: 'The only route to the $500 maximum.' },
            ].map((opt) => (
              <Choice
                key={opt.value}
                type="radio"
                value={opt.value}
                {...register('plannedActivities')}
                aria-invalid={errors.plannedActivities ? true : undefined}
                label={
                  <>
                    {opt.label}
                    <span className="block text-xs text-content-muted">{opt.hint}</span>
                  </>
                }
              />
            ))}
          </Fieldset>

          <Field
            label="Students you expect to involve"
            required
            error={errors.expectedStudents?.message}
            hint={`A rough number is fine. A Challenge needs at least ${GRANT_THRESHOLDS.challengeStudents} students plus you to attend; a Campaign needs at least ${GRANT_THRESHOLDS.campaignStudents} registered.`}
            className="sm:max-w-xs"
          >
            <Input id="expectedStudents" type="text" inputMode="numeric" {...register('expectedStudents')} />
          </Field>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Run a Stellr Challenge or Campaign before?" hint="Optional. First-timers are welcome.">
              <Select id="priorStellr" {...register('priorStellr')} defaultValue="">
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="How did you hear about the grant?" hint="Optional.">
              <Input id="referralSource" type="text" {...register('referralSource')} />
            </Field>
          </div>

          <Field label="Why do you want to take part?" required error={errors.motivation?.message}>
            <Textarea
              id="motivation"
              rows={5}
              {...register('motivation')}
              className="resize-none"
              placeholder="A couple of sentences on what you'd do with it and who it would reach."
            />
          </Field>
        </div>
      </fieldset>

      {/* ── Before you send ── */}
      <fieldset>
        <legend className={legendClass}>Before you send</legend>
        <div className="space-y-4">
          <p className="text-sm text-content-secondary bg-primary-soft border border-primary/20 rounded-control px-4 py-3">
            Submitting this form registers you as a Stellr{' '}
            <span className="font-semibold text-ink">Educator</span>{' '}— our free membership for
            teachers. If you already have a Stellr account we&rsquo;ll match it by email address
            and update it rather than create a second one.
          </p>
          <div className="space-y-1.5">
            <Choice
              {...register('acknowledgePayment')}
              aria-invalid={errors.acknowledgePayment ? true : undefined}
              aria-describedby={errors.acknowledgePayment ? 'acknowledgePayment-error' : undefined}
              label={
                <span className="text-content-secondary">
                  I understand payment comes as a single check posted on 31 May, covering
                  everything I completed since the last payout. <span className="text-danger">*</span>
                </span>
              }
            />
            {errors.acknowledgePayment?.message && (
              <p id="acknowledgePayment-error" className="text-sm text-danger">
                {errors.acknowledgePayment.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Choice
              {...register('consent')}
              aria-invalid={errors.consent ? true : undefined}
              aria-describedby={errors.consent ? 'consent-error' : undefined}
              label={
                <span className="text-content-secondary">
                  I agree to Stellr Education contacting me about my application. View our{' '}
                  <a href="/privacy" className="text-primary-deep underline">
                    Privacy Policy
                  </a>
                  . <span className="text-danger">*</span>
                </span>
              }
            />
            {errors.consent?.message && (
              <p id="consent-error" className="text-sm text-danger">
                {errors.consent.message}
              </p>
            )}
          </div>
        </div>
      </fieldset>

      {status === 'error' && (
        <p
          role="alert"
          className="text-sm text-danger bg-danger/5 border border-danger/30 rounded-control px-4 py-3"
        >
          Something went wrong sending your application. Please try again, or email us at{' '}
          <a href="mailto:hello@stellreducation.org" className="underline">
            hello@stellreducation.org
          </a>
          .
        </p>
      )}

      <div>
        <Button
          type="submit"
          disabled={status === 'loading'}
          className="w-full disabled:opacity-60"
        >
          {status === 'loading' ? 'Sending…' : 'Apply for the grant'}
        </Button>
        <p className={`${hintClass} text-center`}>
          {GRANT_PLACES} places for {programYear}. We read every application and reply to all
          of them.
        </p>
      </div>
    </form>
  )
}
