'use client'

import { Field, Input } from '@stellr/web-ui'
import { Info } from 'lucide-react'
import type { FocusEvent } from 'react'
import {
  PERSONAL_EMAIL_LABEL,
  SCHOOL_EMAIL_LABEL,
  SCHOOL_EMAIL_NOTE,
  showsSchoolEmail,
} from '@/lib/member-email'

// The email field(s) on every form that creates or edits a member (4 Nov 2026).
// Under 18 by date of birth: Personal email + School email, at least one
// required, with a note that school networks block some Stellr mail. Otherwise
// the single Email field. The same `email` value carries across, so typing a
// date of birth never loses what was entered. See lib/member-email.

export interface MemberEmailFieldsProps {
  dateOfBirth: string | null | undefined
  email: string
  schoolEmail: string
  onEmailChange: (value: string) => void
  onSchoolEmailChange: (value: string) => void
  /** Error for the primary field (Email, or Personal email). */
  error?: string
  schoolError?: string
  /** Is an address required at all? (Usually yes.) */
  required?: boolean
  /** Whose address is this? Changes the note's wording for an organiser. */
  audience?: 'self' | 'other'
  autoComplete?: string
  /** For the single-field state, a label other than "Email". */
  label?: string
  hint?: string
  /** Registers with react-hook-form style forms that need refs/names. */
  emailName?: string
  schoolEmailName?: string
  /** id for the primary input, so a form can focus it on error. */
  emailId?: string
  onEmailBlur?: (value: string) => void
  disabled?: boolean
}

export function MemberEmailFields({
  dateOfBirth,
  email,
  schoolEmail,
  onEmailChange,
  onSchoolEmailChange,
  error,
  schoolError,
  required = true,
  audience = 'self',
  autoComplete = 'email',
  label = 'Email',
  hint,
  emailName,
  schoolEmailName,
  emailId,
  onEmailBlur,
  disabled,
}: MemberEmailFieldsProps) {
  const blur = onEmailBlur ? (e: FocusEvent<HTMLInputElement>) => onEmailBlur(e.target.value) : undefined
  if (!showsSchoolEmail(dateOfBirth)) {
    return (
      <Field label={label} required={required} error={error} hint={hint}>
        <Input
          id={emailId}
          type="email"
          inputMode="email"
          name={emailName}
          autoComplete={autoComplete}
          value={email}
          disabled={disabled}
          onChange={(e) => onEmailChange(e.target.value)}
          onBlur={blur}
        />
      </Field>
    )
  }

  // Either address satisfies "required"; the personal one is asked for first.
  const needOne = required && !email.trim() && !schoolEmail.trim()
  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={PERSONAL_EMAIL_LABEL} required={needOne} error={error}>
          <Input
            id={emailId}
            type="email"
            inputMode="email"
            name={emailName}
            autoComplete={autoComplete}
            value={email}
            disabled={disabled}
            onChange={(e) => onEmailChange(e.target.value)}
            onBlur={blur}
          />
        </Field>
        <Field label={SCHOOL_EMAIL_LABEL} error={schoolError} hint="Optional if a personal email is given.">
          <Input
            type="email"
            inputMode="email"
            name={schoolEmailName}
            autoComplete="off"
            value={schoolEmail}
            disabled={disabled}
            onChange={(e) => onSchoolEmailChange(e.target.value)}
          />
        </Field>
      </div>
      <p className="flex gap-2 rounded-ds-card bg-pathway-amber-bg px-3 py-2 text-xs text-brand-gold-ink">
        <Info size={16} className="mt-px shrink-0" aria-hidden />
        <span>
          {audience === 'other'
            ? 'Use their personal email if you can. School networks often block emails from Stellr services such as permission forms and payments, so a school address may never receive them.'
            : SCHOOL_EMAIL_NOTE}
        </span>
      </p>
    </div>
  )
}

/** Client-side check shared by the forms: under 18 needs at least one address. */
export function emailPairError(
  dateOfBirth: string | null | undefined,
  email: string,
  schoolEmail: string,
): string | undefined {
  const valid = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
  if (showsSchoolEmail(dateOfBirth)) {
    if (!email.trim() && !schoolEmail.trim()) return 'Enter a personal or school email.'
    if (email.trim() && !valid(email)) return 'Enter a valid email address.'
    if (schoolEmail.trim() && !valid(schoolEmail)) return 'Enter a valid school email address.'
    if (email.trim() && email.trim().toLowerCase() === schoolEmail.trim().toLowerCase()) {
      return 'Personal and school email should be different. Leave school email blank if there is only one.'
    }
    return undefined
  }
  if (!email.trim()) return 'Required'
  if (!valid(email)) return 'Enter a valid email address.'
  return undefined
}
