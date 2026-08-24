'use client'

import { useState } from 'react'
import { useForm, type SubmitErrorHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@stellr/web-ui'
import FieldError from '@/components/forms/FieldError'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { trackLeadSubmitted } from '@/lib/analytics'
import { GENDERS } from '@/lib/registration-constants'
import { STIPEND_PLACES, STIPEND_PROGRAM_YEAR, STIPEND_THRESHOLDS } from '@/lib/stipend'

const inputClass = (hasError: boolean) =>
  `w-full px-4 py-3 rounded-control border text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary ${hasError ? 'border-danger' : 'border-line'}`

const labelClass = 'block text-sm font-medium text-ink mb-1'
const hintClass = 'mt-1 text-xs text-content-muted'
const legendClass = 'font-display text-base font-semibold text-ink mb-4'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY',
]

/**
 * Mirrors the schema in app/api/teacher-stipend/route.ts. This copy exists to
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

export default function TeacherStipendForm({
  programYear = STIPEND_PROGRAM_YEAR,
  prefill,
}: {
  programYear?: string
  /** The signed-in member's record, resolved on the server — see /stipend. */
  prefill?: RegistrationPrefill | null
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const {
    register,
    handleSubmit,
    setFocus,
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
      const res = await fetch('/api/teacher-stipend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) trackLeadSubmitted('teacher_stipend')
      setStatus(res.ok ? 'success' : 'error')
    } catch {
      setStatus('error')
    }
  }

  /**
   * Move focus to the first field that failed. Without this the error messages
   * appear somewhere up the page and a keyboard or screen-reader user is left
   * at the submit button with no idea what happened.
   */
  const onInvalid: SubmitErrorHandler<FormData> = (found) => {
    const first = Object.keys(found)[0] as keyof FormData | undefined
    if (first) setFocus(first)
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

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className="space-y-8"
      noValidate
    >
      {/* Honeypot. Positioned off-screen rather than display:none — better bots
          skip hidden fields precisely because they read as traps. */}
      <div aria-hidden="true" className="absolute left-[-9999px] w-px h-px overflow-hidden">
        <label htmlFor="stipend-website">Website</label>
        <input
          id="stipend-website"
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
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First name <span className="text-danger">*</span>
              </label>
              <input
                id="firstName"
                type="text"
                autoComplete="given-name"
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                {...register('firstName')}
                className={inputClass(!!errors.firstName)}
              />
              <FieldError id="firstName-error" message={errors.firstName?.message} />
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last name <span className="text-danger">*</span>
              </label>
              <input
                id="lastName"
                type="text"
                autoComplete="family-name"
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'lastName-error' : undefined}
                {...register('lastName')}
                className={inputClass(!!errors.lastName)}
              />
              <FieldError id="lastName-error" message={errors.lastName?.message} />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className={labelClass}>
                Email <span className="text-danger">*</span>
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                readOnly={Boolean(prefill?.email)}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
                className={`${inputClass(!!errors.email)} ${prefill?.email ? 'bg-surface text-content-secondary' : ''}`}
              />
              <p className={hintClass}>
                {prefill?.email
                  ? "You're signed in, so we'll use your Stellr account email."
                  : 'Use your school address if you have one.'}
              </p>
              <FieldError id="email-error" message={errors.email?.message} />
            </div>
            <div>
              <label htmlFor="phone" className={labelClass}>
                Phone
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                {...register('phone')}
                className={inputClass(false)}
              />
              <p className={hintClass}>Optional.</p>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div>
              <label htmlFor="dateOfBirth" className={labelClass}>
                Date of birth <span className="text-danger">*</span>
              </label>
              <input
                id="dateOfBirth"
                type="date"
                autoComplete="bday"
                aria-invalid={!!errors.dateOfBirth}
                aria-describedby={errors.dateOfBirth ? 'dateOfBirth-error' : undefined}
                {...register('dateOfBirth')}
                className={inputClass(!!errors.dateOfBirth)}
              />
              <FieldError id="dateOfBirth-error" message={errors.dateOfBirth?.message} />
            </div>
            <div>
              <label htmlFor="gender" className={labelClass}>
                Gender <span className="text-danger">*</span>
              </label>
              <select
                id="gender"
                aria-invalid={!!errors.gender}
                aria-describedby={errors.gender ? 'gender-error' : undefined}
                {...register('gender')}
                className={`${inputClass(!!errors.gender)} bg-white`}
              >
                <option value="" disabled>
                  Select…
                </option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <FieldError id="gender-error" message={errors.gender?.message} />
            </div>
            <div>
              <label htmlFor="yearsTeaching" className={labelClass}>
                Years teaching
              </label>
              <input
                id="yearsTeaching"
                type="text"
                {...register('yearsTeaching')}
                className={inputClass(false)}
                placeholder="e.g. 8"
              />
              <p className={hintClass}>Optional.</p>
            </div>
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
          <div>
            <label htmlFor="schoolName" className={labelClass}>
              High school <span className="text-danger">*</span>
            </label>
            <input
              id="schoolName"
              type="text"
              autoComplete="organization"
              aria-invalid={!!errors.schoolName}
              aria-describedby={errors.schoolName ? 'schoolName-error' : undefined}
              {...register('schoolName')}
              className={inputClass(!!errors.schoolName)}
            />
            <FieldError id="schoolName-error" message={errors.schoolName?.message} />
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="schoolCity" className={labelClass}>
                City <span className="text-danger">*</span>
              </label>
              <input
                id="schoolCity"
                type="text"
                autoComplete="address-level2"
                aria-invalid={!!errors.schoolCity}
                aria-describedby={errors.schoolCity ? 'schoolCity-error' : undefined}
                {...register('schoolCity')}
                className={inputClass(!!errors.schoolCity)}
              />
              <FieldError id="schoolCity-error" message={errors.schoolCity?.message} />
            </div>
            <div>
              <label htmlFor="schoolState" className={labelClass}>
                State <span className="text-danger">*</span>
              </label>
              <select
                id="schoolState"
                autoComplete="address-level1"
                aria-invalid={!!errors.schoolState}
                aria-describedby={errors.schoolState ? 'schoolState-error' : undefined}
                {...register('schoolState')}
                className={`${inputClass(!!errors.schoolState)} bg-white`}
                defaultValue=""
              >
                <option value="" disabled>
                  Select…
                </option>
                {US_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <FieldError id="schoolState-error" message={errors.schoolState?.message} />
            </div>
          </div>
          <p className={hintClass}>
            The {programYear} pilot is open to U.S. high school teachers only.
          </p>

          <div>
            <div>
              <label htmlFor="subjects" className={labelClass}>
                Subjects you teach <span className="text-danger">*</span>
              </label>
              <input
                id="subjects"
                type="text"
                aria-invalid={!!errors.subjects}
                aria-describedby={errors.subjects ? 'subjects-error' : undefined}
                {...register('subjects')}
                className={inputClass(!!errors.subjects)}
                placeholder="e.g. Physics, Engineering"
              />
              <FieldError id="subjects-error" message={errors.subjects?.message} />
            </div>

          </div>
        </div>
      </fieldset>

      {/* ── Your plan ── */}
      <fieldset>
        <legend className={legendClass}>What you plan to run</legend>
        <div className="space-y-5">
          <fieldset
            aria-describedby={errors.plannedActivities ? 'plannedActivities-error' : undefined}
          >
            <legend className={labelClass}>
                In {programYear}, you plan to <span className="text-danger">*</span>
            </legend>
            <div className="space-y-2">
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
                <label
                  key={opt.value}
                  className="flex items-start gap-3 text-sm text-content-secondary cursor-pointer"
                >
                  <input
                    type="radio"
                    value={opt.value}
                    {...register('plannedActivities')}
                    className="mt-1 h-4 w-4 border-line text-primary"
                  />
                  <span>
                    {opt.label}
                    <span className="block text-xs text-content-muted">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <FieldError
              id="plannedActivities-error"
              message={errors.plannedActivities?.message}
            />
          </fieldset>

          <div className="sm:max-w-xs">
            <div>
              <label htmlFor="expectedStudents" className={labelClass}>
                Students you expect to involve <span className="text-danger">*</span>
              </label>
              <input
                id="expectedStudents"
                type="text"
                inputMode="numeric"
                aria-invalid={!!errors.expectedStudents}
                aria-describedby={errors.expectedStudents ? 'expectedStudents-error' : undefined}
                {...register('expectedStudents')}
                className={inputClass(!!errors.expectedStudents)}
              />
              <p className={hintClass}>
                {`A rough number is fine. A Challenge needs at least ${STIPEND_THRESHOLDS.challengeStudents} students plus you to attend; a Campaign needs at least ${STIPEND_THRESHOLDS.campaignStudents} registered.`}
              </p>
              <FieldError id="expectedStudents-error" message={errors.expectedStudents?.message} />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="priorStellr" className={labelClass}>
                Run a Stellr Challenge or Campaign before?
              </label>
              <select
                id="priorStellr"
                {...register('priorStellr')}
                className={`${inputClass(false)} bg-white`}
                defaultValue=""
              >
                <option value="">Select…</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              <p className={hintClass}>Optional. First-timers are welcome.</p>
            </div>
            <div>
              <label htmlFor="referralSource" className={labelClass}>
                How did you hear about the stipend?
              </label>
              <input
                id="referralSource"
                type="text"
                {...register('referralSource')}
                className={inputClass(false)}
              />
              <p className={hintClass}>Optional.</p>
            </div>
          </div>

          <div>
            <label htmlFor="motivation" className={labelClass}>
              Why do you want to take part? <span className="text-danger">*</span>
            </label>
            <textarea
              id="motivation"
              rows={5}
              aria-invalid={!!errors.motivation}
              aria-describedby={errors.motivation ? 'motivation-error' : undefined}
              {...register('motivation')}
              className={`${inputClass(!!errors.motivation)} resize-none`}
              placeholder="A couple of sentences on what you'd do with it and who it would reach."
            />
            <FieldError id="motivation-error" message={errors.motivation?.message} />
          </div>
        </div>
      </fieldset>

      {/* ── Before you send ── */}
      <fieldset>
        <legend className={legendClass}>Before you send</legend>
        <div className="space-y-4">
          <p className="text-sm text-content-secondary bg-primary-soft border border-primary/20 rounded-control px-4 py-3">
            Submitting this form registers you as a Stellr{' '}
            <span className="font-semibold text-ink">Educator</span> — our free membership for
            teachers. If you already have a Stellr account we&rsquo;ll match it by email address
            and update it rather than create a second one.
          </p>
          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                aria-invalid={!!errors.acknowledgePayment}
                aria-describedby={errors.acknowledgePayment ? 'acknowledgePayment-error' : undefined}
                {...register('acknowledgePayment')}
                className="mt-0.5 h-4 w-4 rounded border-line text-primary"
              />
              <span className="text-sm text-content-secondary">
                I understand payment comes as a single check posted on 31 May, covering
                everything I completed since the last payout. <span className="text-danger">*</span>
              </span>
            </label>
            <FieldError
              id="acknowledgePayment-error"
              message={errors.acknowledgePayment?.message}
            />
          </div>

          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                aria-invalid={!!errors.consent}
                aria-describedby={errors.consent ? 'consent-error' : undefined}
                {...register('consent')}
                className="mt-0.5 h-4 w-4 rounded border-line text-primary"
              />
              <span className="text-sm text-content-secondary">
                I agree to Stellr Education contacting me about my application. View our{' '}
                <a href="/privacy" className="text-primary-deep underline">
                  Privacy Policy
                </a>
                . <span className="text-danger">*</span>
              </span>
            </label>
            <FieldError id="consent-error" message={errors.consent?.message} />
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
          {status === 'loading' ? 'Sending…' : 'Apply for the stipend'}
        </Button>
        <p className={`${hintClass} text-center`}>
          {STIPEND_PLACES} places for {programYear}. We read every application and reply to all
          of them.
        </p>
      </div>
    </form>
  )
}
