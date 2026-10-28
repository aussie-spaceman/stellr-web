'use client'

import { useState, useEffect, useMemo, useRef, useCallback, useId, type RefObject } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { useSignIn } from '@clerk/nextjs/legacy'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Field, Fieldset, Choice, Input, Select, Textarea } from '@stellr/web-ui'
import { joinLinkStorageKey } from '@/components/forms/JoinLinkButton'
import { SchoolSearchInput, SchoolSelection, schoolSelectionState } from '@/components/member/SchoolSearchInput'
import { T_SHIRT_SIZES, GENDERS, COLLEGE_GRADES, ETHNICITIES, DIETARY, EMERGENCY_RELATIONSHIPS, deriveAgeBracket } from '@/lib/registration-constants'
import { inferStudentGrade, DEFAULT_GRADE_BAND } from '@/lib/grade-logic'
import { gradeOptions } from '@/lib/grade-band'
import { resolveSchoolPayload } from '@/lib/school-utils'
import { isValidEmail } from '@/lib/member-enums'
import { MemberIdLookup, type MemberMatch } from '@/components/forms/MemberIdLookup'
import type { RegistrationPrefill } from '@/lib/registration-prefill'
import { StepBar as SharedStepBar } from '@/components/registration/StepBar'

// ── Types ─────────────────────────────────────────────────────────────────────
type RegistrantRole = 'teacher' | 'student_manager'
type DetailsMethod = 'add_now' | 'spreadsheet' | 'email_link'
type PaymentMethod = 'invoice' | 'card' | 'individual'

interface AdultData {
  first_name: string; last_name: string; nickname: string; email: string; phone: string
  date_of_birth: string; gender: string; t_shirt_size: string
  ethnicity: string[]; dietary_requirements: string[]; health_conditions: string
  existing_membership_id: string
  // True when the organiser entered a Member ID and accepted the match — the
  // route resolves that ID server-side and builds the participant from the
  // member's on-file record, leaving the other fields untouched.
  linked: boolean
}

interface StudentData {
  first_name: string; last_name: string; nickname: string; email: string; phone: string
  date_of_birth: string; grade: string; gender: string; t_shirt_size: string
  ethnicity: string[]; dietary_requirements: string[]; health_conditions: string
  emergency_contact_first_name: string; emergency_contact_last_name: string
  emergency_contact_email: string; emergency_contact_phone: string
  emergency_contact_relationship: string
  existing_membership_id: string
  linked: boolean
}

function emptyAdult(): AdultData {
  return { first_name: '', last_name: '', nickname: '', email: '', phone: '', date_of_birth: '', gender: '', t_shirt_size: '', ethnicity: [], dietary_requirements: [], health_conditions: '', existing_membership_id: '', linked: false }
}

function emptyStudent(): StudentData {
  return { first_name: '', last_name: '', nickname: '', email: '', phone: '', date_of_birth: '', grade: '', gender: '', t_shirt_size: '', ethnicity: [], dietary_requirements: [], health_conditions: '', emergency_contact_first_name: '', emergency_contact_last_name: '', emergency_contact_email: '', emergency_contact_phone: '', emergency_contact_relationship: '', existing_membership_id: '', linked: false }
}

// ── Schemas (no school fields — school is handled via SchoolSearchInput state) ─
const teacherSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  nickname: z.string().optional(),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Valid phone required'),
  date_of_birth: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  ethnicity: z.array(z.string()).min(1, 'Select at least one'),
  dietary_requirements: z.array(z.string()).min(1, 'Select at least one'),
  health_conditions: z.string().optional(),
})
type TeacherFormData = z.infer<typeof teacherSchema>

const studentManagerSchema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  nickname: z.string().optional(),
  email: z.string().email('Valid email required'),
  phone: z.string().min(7, 'Valid phone required'),
  date_of_birth: z.string().min(1, 'Required'),
  grade: z.string().min(1, 'Required'),
  gender: z.string().min(1, 'Required'),
  t_shirt_size: z.string().min(1, 'Required'),
  ethnicity: z.array(z.string()).min(1, 'Select at least one'),
  dietary_requirements: z.array(z.string()).min(1, 'Select at least one'),
  health_conditions: z.string().optional(),
  emergency_contact_first_name: z.string().min(1, 'Required'),
  emergency_contact_last_name: z.string().min(1, 'Required'),
  emergency_contact_email: z.string().email('Valid email required'),
  emergency_contact_phone: z.string().min(7, 'Valid phone required'),
  emergency_contact_relationship: z.string().min(1, 'Required'),
  teacher_poc_first_name: z.string().min(1, 'Required'),
  teacher_poc_last_name: z.string().min(1, 'Required'),
  teacher_poc_email: z.string().email('Valid email required'),
})
type StudentManagerFormData = z.infer<typeof studentManagerSchema>

// ── Step bar ──────────────────────────────────────────────────────────────────
function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <div className="bg-white border-b border-line -mx-4 px-4 py-4 mb-6 sm:-mx-0">
      <SharedStepBar steps={['Registration Type', 'Your Details', 'Group Details', 'Confirmation']} current={step + 1} />
    </div>
  )
}

// ── Focus the first invalid field ─────────────────────────────────────────────
// The first control marked invalid, in on-screen order. Field sets aria-invalid
// on its control (the school search included); a checkbox group marks its
// wrapper with data-invalid instead.
const FIRST_INVALID = '[aria-invalid="true"], [data-invalid="true"] input'

/**
 * Returns a function that moves focus to the first invalid field once the
 * errors it follows have rendered — so a failed Continue or Submit lands the
 * organiser (and their screen reader) on the field to fix, which reads its error.
 */
function useFocusFirstInvalid(root: RefObject<HTMLElement | null>) {
  const [request, setRequest] = useState(0)
  useEffect(() => {
    if (request) root.current?.querySelector<HTMLElement>(FIRST_INVALID)?.focus()
  }, [request, root])
  return useCallback(() => setRequest(n => n + 1), [])
}

/** Visible asterisk for a legend; the words are for screen readers. */
function RequiredMark() {
  return (
    <>
      <span className="text-danger" aria-hidden>{' '}*</span>
      <span className="sr-only"> (required)</span>
    </>
  )
}

// ── Shared: multi-checkbox ────────────────────────────────────────────────────
function MultiCheckboxes({ label, note, options, selected, onChange, error }: {
  label: string; note?: string; options: readonly string[]
  selected: string[]; onChange: (v: string[]) => void; error?: string
}) {
  return (
    <div data-invalid={error ? 'true' : undefined}>
      <Fieldset legend={<>{label}<RequiredMark /></>} hint={note} error={error}>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {options.map(opt => (
            <Choice key={opt} label={opt} checked={selected.includes(opt)}
              onChange={() => onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt])} />
          ))}
        </div>
      </Fieldset>
    </div>
  )
}

// ── Number stepper ────────────────────────────────────────────────────────────
// Two 44px buttons around a count, named as one group by its question; the
// count is announced as it changes.
function NumberStepper({ label, value, min, max, onChange, note }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void; note?: string
}) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={note ? `${id}-note` : undefined}>
      <p id={`${id}-label`} className="font-subheading text-sm font-medium text-content-body">{label}</p>
      <div className="flex items-center gap-3 mt-1">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          aria-label="Fewer"
          className="w-11 h-11 rounded-full border border-line-strong flex items-center justify-center text-lg font-medium text-content-body hover:bg-surface disabled:opacity-40">
          −
        </button>
        <span aria-live="polite" className="w-10 text-center font-semibold text-brand-blue-dark text-lg">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
          aria-label="More"
          className="w-11 h-11 rounded-full border border-line-strong flex items-center justify-center text-lg font-medium text-content-body hover:bg-surface disabled:opacity-40">
          +
        </button>
      </div>
      {note && <p id={`${id}-note`} className="text-xs text-content-faint mt-1">{note}</p>}
    </div>
  )
}

// ── Per-slot completion status ────────────────────────────────────────────────
// A slot is 'empty' (deferred — finish later via link/Sheet), 'incomplete'
// (started but missing required fields — blocks submit), or 'complete'. The
// status pill, the per-field errors and validateParticipants() all read the
// same slot*Errors() below, so they can never disagree. Linked slots are built
// from the member's on-file record → always complete.
type SlotStatus = 'complete' | 'incomplete' | 'empty'
type SlotErrors<T> = Partial<Record<keyof T, string>>

const ADULT_REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'gender', 't_shirt_size'] as const
const STUDENT_REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'grade', 'gender', 't_shirt_size'] as const
const STUDENT_EC_REQUIRED = [
  'emergency_contact_first_name', 'emergency_contact_last_name', 'emergency_contact_email',
  'emergency_contact_phone', 'emergency_contact_relationship',
] as const

const isEmptySlot = (p: { first_name: string; last_name: string; email: string }) => !(p.first_name || p.last_name || p.email)

/** Missing required fields of a started, unlinked adult slot ({} when none). */
function adultSlotErrors(a: AdultData): SlotErrors<AdultData> {
  if (a.linked || isEmptySlot(a)) return {}
  const e: SlotErrors<AdultData> = {}
  for (const f of ADULT_REQUIRED) if (!a[f]) e[f] = 'Required'
  if (a.email && !isValidEmail(a.email)) e.email = 'Enter a valid email'
  if (a.ethnicity.length === 0) e.ethnicity = 'Select at least one'
  if (a.dietary_requirements.length === 0) e.dietary_requirements = 'Select at least one'
  return e
}

/** Missing required fields of a started, unlinked student slot ({} when none). */
function studentSlotErrors(s: StudentData): SlotErrors<StudentData> {
  if (s.linked || isEmptySlot(s)) return {}
  const e: SlotErrors<StudentData> = {}
  for (const f of STUDENT_REQUIRED) if (!s[f]) e[f] = 'Required'
  if (s.email && !isValidEmail(s.email)) e.email = 'Enter a valid email'
  if (s.ethnicity.length === 0) e.ethnicity = 'Select at least one'
  if (s.dietary_requirements.length === 0) e.dietary_requirements = 'Select at least one'
  for (const f of STUDENT_EC_REQUIRED) if (!s[f]) e[f] = 'Required'
  // The consent form is emailed here — "none" or a typo means no agreement.
  if (s.emergency_contact_email && !isValidEmail(s.emergency_contact_email)) {
    e.emergency_contact_email = 'Enter a valid email — the consent form is sent here'
  }
  return e
}

function adultStatus(a: AdultData): SlotStatus {
  if (a.linked) return 'complete'
  if (isEmptySlot(a)) return 'empty'
  return Object.keys(adultSlotErrors(a)).length === 0 ? 'complete' : 'incomplete'
}

function studentStatus(s: StudentData): SlotStatus {
  if (s.linked) return 'complete'
  if (isEmptySlot(s)) return 'empty'
  return Object.keys(studentSlotErrors(s)).length === 0 ? 'complete' : 'incomplete'
}

function StatusPill({ status }: { status: SlotStatus }) {
  const map: Record<SlotStatus, { label: string; cls: string }> = {
    complete:   { label: 'Complete',       cls: 'bg-green-100 text-green-700' },
    incomplete: { label: 'Incomplete',     cls: 'bg-amber-100 text-amber-700' },
    empty:      { label: 'To finish later', cls: 'bg-surface text-content-muted' },
  }
  const { label, cls } = map[status]
  return <span className={`text-xs uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${cls}`}>{label}</span>
}

// ── Adult accordion ───────────────────────────────────────────────────────────
// Participant slots hold someone else's details — another adult, or a child —
// so none of them autofill from the organiser's own browser profile.
const NOT_MINE = 'off'

function AdultAccordion({ index, data, onChange, onAccept, onUnlink, expanded, onToggle, isPoC, status, errors }: {
  index: number; data: AdultData
  onChange: (field: keyof AdultData, value: string | string[]) => void
  onAccept: (m: MemberMatch) => void; onUnlink: () => void
  expanded: boolean; onToggle: () => void; isPoC?: boolean; status: SlotStatus
  /** Missing fields, shown once the organiser has tried to submit. */
  errors: SlotErrors<AdultData>
}) {
  const label = data.first_name && data.last_name
    ? `${data.first_name} ${data.last_name}${isPoC ? ' (Teacher Point of Contact)' : ''}`
    : isPoC
      ? 'Teacher Point of Contact (Adult 1)'
      : `Additional Adult ${index + 1}`
  return (
    <div className={`rounded-xl overflow-hidden border ${isPoC ? 'border-amber-200' : 'border-line'}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${isPoC ? 'bg-amber-50 hover:bg-amber-100' : 'bg-surface hover:bg-surface'}`}>
        <span className={`font-medium text-sm ${isPoC ? 'text-amber-900' : 'text-brand-blue-dark'}`}>{label}</span>
        <span className="flex items-center gap-2 shrink-0">
          <StatusPill status={status} />
          {expanded ? <ChevronUp size={16} className="text-content-faint" /> : <ChevronDown size={16} className="text-content-faint" />}
        </span>
      </button>
      {expanded && (
        // Named group, so each "First Name" is announced as this person's.
        <div role="group" aria-label={label} className="p-4 space-y-4">
          {isPoC && !data.linked && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Pre-filled from your Teacher Point of Contact. Please complete their remaining details so they can be registered as a participant.
            </p>
          )}
          <MemberIdLookup value={data.existing_membership_id} linked={data.linked}
            linkedName={`${data.first_name} ${data.last_name}`.trim()}
            onChange={v => onChange('existing_membership_id', v)} onAccept={onAccept} onUnlink={onUnlink} />
          {!data.linked && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required error={errors.first_name}>
                  <Input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Last Name" required error={errors.last_name}>
                  <Input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
              </div>
              <Field label="Preferred Name / Nickname">
                <Input value={data.nickname} onChange={e => onChange('nickname', e.target.value)} autoComplete={NOT_MINE} placeholder="Optional" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Email" required error={errors.email}>
                  <Input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Phone" required error={errors.phone}>
                  <Input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Date of Birth" required error={errors.date_of_birth}>
                  <Input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Gender" required error={errors.gender}>
                  <Select value={data.gender} onChange={e => onChange('gender', e.target.value)} autoComplete={NOT_MINE}>
                    <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </Field>
                <Field label="T-Shirt Size" required error={errors.t_shirt_size}>
                  <Select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)}>
                    <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
              <MultiCheckboxes label="Ethnicity" note="Select all that apply" options={ETHNICITIES}
                selected={data.ethnicity} onChange={v => onChange('ethnicity', v)} error={errors.ethnicity} />
              <MultiCheckboxes label="Dietary Requirements" note="Select all that apply" options={DIETARY}
                selected={data.dietary_requirements} onChange={v => onChange('dietary_requirements', v)} error={errors.dietary_requirements} />
              <Field label="Health Conditions / Allergies">
                <Textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="resize-none" rows={2} placeholder="Leave blank if none." />
              </Field>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Student accordion ─────────────────────────────────────────────────────────
function StudentAccordion({ index, displayNumber, data, onChange, onAccept, onUnlink, expanded, onToggle, status, band, errors }: {
  index: number; displayNumber?: number; data: StudentData
  onChange: (field: keyof StudentData, value: string | string[]) => void
  onAccept: (m: MemberMatch) => void; onUnlink: () => void
  expanded: boolean; onToggle: () => void; status: SlotStatus
  /** The event's eligible grade range — school grades offered in this slot. */
  band: { min: number; max: number }
  /** Missing fields, shown once the organiser has tried to submit. */
  errors: SlotErrors<StudentData>
}) {
  const ecNoteId = useId()
  const label = data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : `Student ${displayNumber ?? index + 1}`
  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface hover:bg-surface text-left">
        <span className="font-medium text-brand-blue-dark text-sm">{label}</span>
        <span className="flex items-center gap-2 shrink-0">
          <StatusPill status={status} />
          {expanded ? <ChevronUp size={16} className="text-content-faint" /> : <ChevronDown size={16} className="text-content-faint" />}
        </span>
      </button>
      {expanded && (
        // Named group, so each "First Name" is announced as this student's.
        <div role="group" aria-label={label} className="p-4 space-y-4">
          <MemberIdLookup value={data.existing_membership_id} linked={data.linked}
            linkedName={`${data.first_name} ${data.last_name}`.trim()}
            onChange={v => onChange('existing_membership_id', v)} onAccept={onAccept} onUnlink={onUnlink} />
          {!data.linked && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required error={errors.first_name}>
                  <Input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Last Name" required error={errors.last_name}>
                  <Input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
              </div>
              <Field label="Preferred Name / Nickname">
                <Input value={data.nickname} onChange={e => onChange('nickname', e.target.value)} autoComplete={NOT_MINE} placeholder="Optional" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Email" required error={errors.email}>
                  <Input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Phone" required error={errors.phone}>
                  <Input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Date of Birth" required error={errors.date_of_birth}>
                  <Input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} autoComplete={NOT_MINE} />
                </Field>
                <Field label="Grade" required error={errors.grade}>
                  <Select value={data.grade} onChange={e => onChange('grade', e.target.value)}>
                    <option value="">Select…</option>{[...gradeOptions(band), ...COLLEGE_GRADES].map(g => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </Field>
                <Field label="Gender" required error={errors.gender}>
                  <Select value={data.gender} onChange={e => onChange('gender', e.target.value)} autoComplete={NOT_MINE}>
                    <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </Field>
                <Field label="T-Shirt" required error={errors.t_shirt_size}>
                  <Select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)}>
                    <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
              </div>
              <MultiCheckboxes label="Ethnicity" note="Select all that apply" options={ETHNICITIES}
                selected={data.ethnicity} onChange={v => onChange('ethnicity', v)} error={errors.ethnicity} />
              <MultiCheckboxes label="Dietary Requirements" note="Select all that apply" options={DIETARY}
                selected={data.dietary_requirements} onChange={v => onChange('dietary_requirements', v)} error={errors.dietary_requirements} />
              <Field label="Health Conditions / Allergies">
                <Textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="resize-none" rows={2} placeholder="Leave blank if none." />
              </Field>
              {/* The student's guardian, not the organiser — no autofill either. */}
              <div className="border-t border-line-light pt-4">
                <fieldset className="min-w-0" aria-describedby={ecNoteId}>
                  <legend className="font-semibold text-brand-blue-dark text-sm">Emergency Contact</legend>
                  <p id={ecNoteId} className="text-xs text-content-faint">Required for all student participants — acts as the guardian for their participation agreement</p>
                  <div className="mt-4 space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="First Name" required error={errors.emergency_contact_first_name}>
                        <Input value={data.emergency_contact_first_name} onChange={e => onChange('emergency_contact_first_name', e.target.value)} autoComplete={NOT_MINE} />
                      </Field>
                      <Field label="Last Name" required error={errors.emergency_contact_last_name}>
                        <Input value={data.emergency_contact_last_name} onChange={e => onChange('emergency_contact_last_name', e.target.value)} autoComplete={NOT_MINE} />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Field label="Email" required error={errors.emergency_contact_email}>
                        <Input type="email" value={data.emergency_contact_email} onChange={e => onChange('emergency_contact_email', e.target.value)} autoComplete={NOT_MINE} />
                      </Field>
                      <Field label="Phone" required error={errors.emergency_contact_phone}>
                        <Input type="tel" value={data.emergency_contact_phone} onChange={e => onChange('emergency_contact_phone', e.target.value)} autoComplete={NOT_MINE} />
                      </Field>
                    </div>
                    <Field label="Relationship To Participant" required error={errors.emergency_contact_relationship}>
                      <Select value={data.emergency_contact_relationship} onChange={e => onChange('emergency_contact_relationship', e.target.value)}>
                        <option value="">Select…</option>{EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    </Field>
                  </div>
                </fieldset>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Student Manager (self) read-only card ─────────────────────────────────────
// The Student Manager is the group's first student. Their full student profile was
// captured on Step 1 ("Your Details"), so here we only confirm it read-only —
// editing happens back on Step 1. Mirrors how the Teacher PoC is surfaced as Adult
// 1, except the SM's details are already complete, so nothing here is editable.
function StudentManagerCard({ data, onEdit }: { data: StudentManagerFormData; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const name = `${data.first_name} ${data.last_name}`.trim() || 'You'
  const ec = [data.emergency_contact_first_name, data.emergency_contact_last_name].filter(Boolean).join(' ')
  const summary: { label: string; value: string }[] = [
    { label: 'Preferred Name', value: data.nickname || '' },
    { label: 'Email', value: data.email },
    { label: 'Phone', value: data.phone },
    { label: 'Date of Birth', value: data.date_of_birth },
    { label: 'Grade', value: data.grade ? `Grade ${data.grade}` : '' },
    { label: 'Gender', value: data.gender },
    { label: 'T-Shirt Size', value: data.t_shirt_size },
    { label: 'Dietary', value: (data.dietary_requirements ?? []).join(', ') },
    { label: 'Health Conditions', value: data.health_conditions || 'None' },
    { label: 'Emergency Contact', value: ec },
    { label: 'Emergency Phone', value: data.emergency_contact_phone },
    { label: 'Relationship', value: data.emergency_contact_relationship },
  ]
  return (
    <div className="rounded-xl overflow-hidden border border-amber-200">
      <button type="button" onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left bg-amber-50 hover:bg-amber-100">
        <span className="font-medium text-sm text-amber-900">{name} — You (Student Manager)</span>
        {expanded ? <ChevronUp size={16} className="text-content-faint" /> : <ChevronDown size={16} className="text-content-faint" />}
      </button>
      <div className="px-4 py-2 bg-amber-50/60 border-t border-amber-100 flex items-center justify-between gap-3">
        <span className="text-xs text-amber-700">Pre-filled from <strong>Your Details</strong> — you&apos;re registered as the group&apos;s first student.</span>
        <button type="button" onClick={onEdit} className="text-xs text-brand-blue underline whitespace-nowrap">Edit ↗</button>
      </div>
      {expanded && (
        <div className="p-4">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {summary.filter(s => s.value).map(s => (
              <div key={s.label} className="flex justify-between gap-3 border-b border-line-light pb-1">
                <dt className="text-content-muted">{s.label}</dt>
                <dd className="text-brand-blue-dark font-medium text-right">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GroupRegistrationForm({ eventSlug, eventTitle, prefill, isCampaign = false, isFree = false, gradeMin = DEFAULT_GRADE_BAND.min, gradeMax = DEFAULT_GRADE_BAND.max }: {
  eventSlug: string; eventTitle: string; prefill?: RegistrationPrefill | null
  isCampaign?: boolean; isFree?: boolean
  /**
   * The event's eligible grade range, as primitives so the memoised band below
   * stays referentially stable — an inline `band={{...}}` object would be a new
   * value every render and re-run the DOB inference effect on each one.
   * Defaults to 9–12.
   */
  gradeMin?: number; gradeMax?: number
}) {
  const band = useMemo(() => ({ min: gradeMin, max: gradeMax }), [gradeMin, gradeMax])
  const router = useRouter()
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn()
  const { isSignedIn } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  const [registrantRole, setRegistrantRole] = useState<RegistrantRole>('teacher')

  // When the registrant is signed in, their email is authoritative and locked
  // (Option A) — only the registrant block is pre-filled; additional adults and
  // students are still entered as before.
  const emailLocked = !!prefill?.email
  const registrantDefaults = {
    first_name: prefill?.first_name ?? '',
    last_name: prefill?.last_name ?? '',
    nickname: prefill?.nickname ?? '',
    email: prefill?.email ?? '',
    phone: prefill?.phone ?? '',
    date_of_birth: prefill?.date_of_birth ?? '',
    gender: prefill?.gender ?? '',
    t_shirt_size: prefill?.t_shirt_size ?? '',
    ethnicity: prefill?.ethnicity ?? [],
    dietary_requirements: prefill?.dietary_requirements ?? [],
    health_conditions: prefill?.health_conditions ?? '',
  }

  // Two form instances — hooks must be unconditional
  const teacherForm = useForm<TeacherFormData>({
    resolver: zodResolver(teacherSchema),
    defaultValues: { ...registrantDefaults },
  })
  const smForm = useForm<StudentManagerFormData>({
    resolver: zodResolver(studentManagerSchema),
    defaultValues: {
      ...registrantDefaults,
      grade: prefill?.grade ?? '',
      emergency_contact_first_name: prefill?.emergency_contact_first_name ?? '',
      emergency_contact_last_name: prefill?.emergency_contact_last_name ?? '',
      emergency_contact_email: prefill?.emergency_contact_email ?? '',
      emergency_contact_phone: prefill?.emergency_contact_phone ?? '',
      emergency_contact_relationship: prefill?.emergency_contact_relationship ?? '',
    },
  })

  const tf = teacherForm
  const sf = smForm
  const tEthnicity = tf.watch('ethnicity') ?? []
  const tDietary = tf.watch('dietary_requirements') ?? []
  const sEthnicity = sf.watch('ethnicity') ?? []
  const sDietary = sf.watch('dietary_requirements') ?? []

  // School selection (separate state — SchoolSearchInput owns its own UI)
  const initialSchool: SchoolSelection | null = prefill?.school
    ? { type: 'existing', id: prefill.school.id, name: prefill.school.name }
    : null
  const [teacherSchool, setTeacherSchool] = useState<SchoolSelection | null>(initialSchool)
  const [smSchool, setSmSchool] = useState<SchoolSelection | null>(initialSchool)
  const [schoolError, setSchoolError] = useState<string | null>(null)

  // Student-Manager registers as a school student themselves — pre-fill their
  // own Grade from DOB + their school's State (editable), clamped into the
  // event's band, mirroring the per-student inference above.
  const smDob = sf.watch('date_of_birth')
  const smSchoolState = schoolSelectionState(smSchool)
  useEffect(() => {
    if (registrantRole !== 'student_manager') return
    const inferred = inferStudentGrade(smDob, smSchoolState, undefined, { band })
    if (inferred) sf.setValue('grade', inferred)
  }, [smDob, smSchoolState, registrantRole, band, sf])

  // For teacher: adultCount includes teacher themselves (min=1)
  // For SM: adultCount = PoC + optional second adult (min=1; PoC always required as participant)
  const [adultCount, setAdultCount] = useState(1)
  const [studentCount, setStudentCount] = useState(2)
  const [detailsMethod, setDetailsMethod] = useState<DetailsMethod>('add_now')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('invoice')
  const [additionalAdults, setAdditionalAdults] = useState<AdultData[]>([])
  const [students, setStudents] = useState<StudentData[]>([emptyStudent(), emptyStudent()])
  const [expandedAdult, setExpandedAdult] = useState<number | null>(null)
  const [expandedStudent, setExpandedStudent] = useState<number | null>(0)
  const [submitting, setSubmitting] = useState(false)
  // Submit outcome. 'info' is the "we've emailed you a link" answer to an
  // unfinished registration — not a failure, so it isn't painted red.
  const [notice, setNotice] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const setError = (text: string | null) => setNotice(text ? { kind: 'error', text } : null)
  const [dpaAgreed, setDpaAgreed] = useState(false)
  const [dpaError, setDpaError] = useState(false)
  // After a failed submit, each started slot shows its missing fields (live,
  // so they clear as they're filled).
  const [showSlotErrors, setShowSlotErrors] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const focusFirstInvalid = useFocusFirstInvalid(rootRef)
  const detailsMethodLabelId = useId()
  const paymentMethodLabelId = useId()
  const smEcNoteId = useId()
  const pocNoteId = useId()
  const dpaErrorId = useId()

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Extract PoC data from SM form to pre-populate as Adult 1 */
  function getPoCAsAdult(): AdultData {
    const d = sf.getValues()
    return {
      ...emptyAdult(),
      first_name: d.teacher_poc_first_name ?? '',
      last_name: d.teacher_poc_last_name ?? '',
      email: d.teacher_poc_email ?? '',
    }
  }

  function handleAdultCountChange(n: number) {
    setAdultCount(n)
    if (registrantRole === 'student_manager') {
      // For SM: all n adults are in additionalAdults (SM is in the teacher field)
      // additionalAdults[0] is always the PoC
      setAdditionalAdults(prev => {
        const poc = prev.length > 0 ? prev[0] : getPoCAsAdult()
        if (n === 0) return []
        if (n === 1) return [poc]
        return [poc, ...(prev.slice(1).length < n - 1
          ? [...prev.slice(1), ...Array.from({ length: n - 1 - prev.slice(1).length }, emptyAdult)]
          : prev.slice(1, n))]
      })
    } else {
      // For teacher: teacher is adult 1, additional adults fill the rest
      const need = n - 1
      setAdditionalAdults(prev =>
        prev.length < need
          ? [...prev, ...Array.from({ length: need - prev.length }, emptyAdult)]
          : prev.slice(0, need)
      )
    }
  }

  function handleStudentCountChange(n: number) {
    setStudentCount(n)
    setStudents(prev => prev.length < n ? [...prev, ...Array.from({ length: n - prev.length }, emptyStudent)] : prev.slice(0, n))
  }

  function updateAdult(i: number, field: keyof AdultData, value: string | string[]) {
    setAdditionalAdults(prev => prev.map((a, idx) => idx === i ? { ...a, [field]: value } : a))
  }

  // Group students are school students. When a DOB is entered, pre-fill their
  // Grade from DOB + the group school's State (Sep 1 default when unknown),
  // clamped into the event's band and re-inferred on later DOB edits. The Grade
  // select stays editable.
  function updateStudent(i: number, field: keyof StudentData, value: string | string[]) {
    setStudents(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const next = { ...s, [field]: value }
      if (field === 'date_of_birth' && typeof value === 'string') {
        const groupSchool = registrantRole === 'student_manager' ? smSchool : teacherSchool
        const inferred = inferStudentGrade(value, schoolSelectionState(groupSchool), undefined, { band })
        if (inferred) next.grade = inferred
      }
      return next
    }))
  }

  // Member ID match accepted — link the slot and adopt the matched name so the
  // accordion header reads correctly; the route fills the rest from the on-file
  // record. Unlink reverts to manual entry.
  function acceptAdult(i: number, m: MemberMatch) {
    setAdditionalAdults(prev => prev.map((a, idx) => idx === i ? { ...a, linked: true, first_name: m.first_name, last_name: m.last_name } : a))
  }
  function unlinkAdult(i: number) {
    setAdditionalAdults(prev => prev.map((a, idx) => idx === i ? { ...a, linked: false } : a))
  }
  function acceptStudent(i: number, m: MemberMatch) {
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, linked: true, first_name: m.first_name, last_name: m.last_name } : s))
  }
  function unlinkStudent(i: number) {
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, linked: false } : s))
  }

  // ── Step 1 → Step 2 ──────────────────────────────────────────────────────────
  async function goToStep2() {
    setSchoolError(null)
    let valid = false
    if (registrantRole === 'teacher') {
      valid = await tf.trigger()
    } else {
      valid = await sf.trigger()
    }

    // Validate school selection
    const school = registrantRole === 'teacher' ? teacherSchool : smSchool
    if (!school) {
      setSchoolError('Please search for and select your school before continuing.')
      focusFirstInvalid()
      return
    }

    if (!valid) {
      focusFirstInvalid()
      return
    }

    // For SM: ensure adultCount >= 1 and pre-populate PoC as Adult 1
    if (registrantRole === 'student_manager') {
      const poc = getPoCAsAdult()
      setAdultCount(prev => Math.max(prev, 1))
      setAdditionalAdults(prev => {
        if (prev.length === 0) {
          return [poc]
        }
        // Refresh PoC name/email from form (in case they edited step 1)
        return [
          { ...prev[0], first_name: poc.first_name, last_name: poc.last_name, email: poc.email },
          ...prev.slice(1),
        ]
      })
      setExpandedAdult(0) // Open Adult 1 (PoC) by default so user completes their details
    }

    setStep(2)
  }

  // A slot counts as "started" once it's linked to a member or has any of
  // name/email — fully blank slots are simply deferred (provide later via the
  // Sheet or completion link). Linked slots are built from the on-file record.
  const adultStarted = (a: AdultData) => adultStatus(a) !== 'empty'
  const studentStarted = (s: StudentData) => studentStatus(s) !== 'empty'

  /** Count of slots left for later (not entered now) — drives the "remaining" hint. */
  function deferredCount(): number {
    if (detailsMethod !== 'add_now') return 0
    const adults = additionalAdults.filter(a => !adultStarted(a)).length
    const studs = students.filter(s => !studentStarted(s)).length
    return adults + studs
  }

  // ── Validate participants before submit ──────────────────────────────────────
  // Partial entry is allowed: only *started* slots must be complete; blank slots
  // are deferred and linked slots use the member's on-file record. Returns the
  // first incomplete slot (adults, then students — screen order) and why.
  function validateParticipants(): { kind: 'adult' | 'student'; index: number; message: string } | null {
    if (detailsMethod !== 'add_now') return null
    for (let i = 0; i < additionalAdults.length; i++) {
      if (Object.keys(adultSlotErrors(additionalAdults[i])).length > 0)
        return { kind: 'adult', index: i, message: `${i === 0 && registrantRole === 'student_manager' ? 'Teacher Point of Contact' : `Additional Adult ${i + 1}`} is partly filled — finish their required fields, or clear the entry to add them later via your link or Sheet` }
    }
    // Student Manager occupies Student 1 (read-only), so the editable students
    // shown below start at Student 2 — keep error numbering in step.
    const studentOffset = registrantRole === 'student_manager' ? 1 : 0
    for (let i = 0; i < students.length; i++) {
      const missing = Object.keys(studentSlotErrors(students[i]))
      if (missing.length === 0) continue
      // Every student signs the minor participation agreement, with their
      // emergency contact as the guardian — so it's required for all students.
      const onlyEmergencyContact = missing.every(f => f.startsWith('emergency_contact_'))
      return {
        kind: 'student',
        index: i,
        message: onlyEmergencyContact
          ? `Student ${i + 1 + studentOffset} is partly filled — an emergency contact is required, or clear the entry to add them later`
          : `Student ${i + 1 + studentOffset} is partly filled — finish their required fields, or clear the entry to add them later via your link or Sheet`,
      }
    }
    return null
  }

  // ── Final submit ──────────────────────────────────────────────────────────────
  async function handleFinalSubmit() {
    setSubmitting(true)
    setError(null)

    const incomplete = validateParticipants()
    if (incomplete) {
      setError(incomplete.message)
      setSubmitting(false)
      // Open that person's card, mark its missing fields, and put focus on
      // the first one.
      setShowSlotErrors(true)
      if (incomplete.kind === 'adult') setExpandedAdult(incomplete.index)
      else setExpandedStudent(incomplete.index)
      focusFirstInvalid()
      return
    }

    if (!dpaAgreed) {
      setDpaError(true)
      setSubmitting(false)
      focusFirstInvalid()
      return
    }

    try {
      let registrantPayload: Record<string, unknown>
      const activeSchool = registrantRole === 'teacher' ? teacherSchool : smSchool
      const schoolFields = resolveSchoolPayload(activeSchool)

      if (registrantRole === 'teacher') {
        const d = tf.getValues()
        registrantPayload = {
          ...d,
          ...schoolFields,
          age_bracket: deriveAgeBracket(d.date_of_birth),
          event_role: 'Teacher',
        }
      } else {
        const d = sf.getValues()
        registrantPayload = {
          ...d,
          ...schoolFields,
          age_bracket: deriveAgeBracket(d.date_of_birth, d.grade),
          event_role: 'School Student Manager',
        }
      }

      const isTeacher = registrantRole === 'teacher'
      const smData = !isTeacher ? sf.getValues() : null

      // For SM: total includes SM(1) + adults(adultCount) + students
      // For teacher: total includes teacher(counted in adultCount) + students
      const totalParticipants = registrantRole === 'student_manager'
        ? 1 + adultCount + studentCount
        : adultCount + studentCount

      const res = await fetch('/api/register/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_slug: eventSlug,
          event_title: eventTitle,
          registrant_role: registrantRole,
          teacher: registrantPayload,
          teacher_poc: smData ? {
            first_name: smData.teacher_poc_first_name,
            last_name: smData.teacher_poc_last_name,
            email: smData.teacher_poc_email,
          } : null,
          adult_count: adultCount,
          student_count: studentCount,
          total_participants: totalParticipants,
          details_method: detailsMethod,
          // Campaigns are always free — never send a paid payment method, and flag
          // the registration so the API skips payment and marks it confirmed.
          // An event with no fee configured is the same story: the payment
          // question isn't asked, so don't send a method the API would have to
          // reject (invoice previously slipped through and recorded a phantom
          // "invoice sent" against an invoice that was never created).
          payment_method: isCampaign || isFree ? 'none' : paymentMethod,
          is_campaign: isCampaign,
          // On a free event there is no group-vs-individual choice to make — each
          // member individually owes nothing — so settle everyone individually.
          // That's what gets each participant the "you're registered, no payment
          // required" email; a group-paid flag would leave them silent, which is
          // the gap this fixes. Campaigns keep their own confirmation email.
          member_pays_individually: isCampaign
            ? false
            : isFree || paymentMethod === 'individual',
          // For SM: all additional_adults entries are genuinely additional (PoC is adults[0])
          // For teacher: additional_adults excludes teacher themselves. Map with the
          // ORIGINAL index (so PoC role detection holds), then drop blank/deferred
          // slots — only started or member-linked people are submitted now.
          additional_adults: detailsMethod === 'add_now'
            ? additionalAdults
                .map((a, i) => ({
                  ...a,
                  age_bracket: deriveAgeBracket(a.date_of_birth),
                  // PoC (SM adult 0) is a Teacher role; all others are Adult
                  event_role: registrantRole === 'student_manager' && i === 0 ? 'Teacher' : 'Adult',
                }))
                .filter(a => a.linked || a.first_name || a.last_name || a.email)
            : [],
          students: detailsMethod === 'add_now'
            ? students
                .map(s => ({ ...s, age_bracket: deriveAgeBracket(s.date_of_birth, s.grade), event_role: 'School Student' }))
                .filter(s => s.linked || s.first_name || s.last_name || s.email)
            : [],
          school_dpa_agreed: dpaAgreed,
        }),
      })

      const payload = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (payload.code === 'unfinished_registration') {
          setNotice({ kind: 'info', text: payload.error })
          setSubmitting(false)
          return
        }
        throw new Error(payload.error ?? 'Registration failed')
      }

      const { registrationId, checkoutUrl, spreadsheetUrl, joinUrl, signInToken, resume } = payload
      // The organiser's own unfinished card registration — straight back to checkout.
      if (resume && checkoutUrl) {
        window.location.href = checkoutUrl
        return
      }
      // Slots the organiser chose to provide later (blank now) — drives the
      // "complete the rest via Sheet / link" prompt on the confirmation page.
      const remaining = deferredCount()

      // Silently sign the registrant in (Clerk ticket flow) so they land on the
      // confirmation step already authenticated and can open their group's sheet
      // from the member portal without a separate sign-up. Non-fatal — if it
      // fails they can still sign in later with the same email.
      if (signInToken && !isSignedIn && signInLoaded && signIn) {
        try {
          const result = await signIn.create({ strategy: 'ticket', ticket: signInToken })
          if (result.status === 'complete' && result.createdSessionId) {
            await setActive({ session: result.createdSessionId })
          }
        } catch (signInErr) {
          console.error('Auto sign-in failed (non-fatal):', signInErr)
        }
      }

      if (checkoutUrl) {
        window.location.href = checkoutUrl
      } else {
        const params = new URLSearchParams({ id: registrationId, type: 'group' })
        if (isCampaign) params.set('campaign', '1')
        // Surface the Sheet for the spreadsheet/email-link flows, or whenever some
        // participants were deferred for later completion (partial add-now).
        if (spreadsheetUrl && (detailsMethod !== 'add_now' || remaining > 0)) params.set('spreadsheet', encodeURIComponent(spreadsheetUrl))
        // The join link is a key to the group: it goes to the confirmation page
        // through this tab's session storage, never the address bar, which
        // analytics would record.
        if (joinUrl && remaining > 0) {
          try { window.sessionStorage.setItem(joinLinkStorageKey(registrationId), joinUrl) } catch { /* emailed too */ }
        }
        if (remaining > 0) params.set('remaining', String(remaining))
        router.push(`/register/${eventSlug}/confirmation?${params.toString()}`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Step 1: Registrant details ─────────────────────────────────────────────
  // The organiser's own fields carry standard autocomplete tokens so a browser
  // can fill them from their profile (WCAG 1.3.5). Someone else's details get
  // their own autofill section, so the organiser's never land in them.
  if (step === 1) {
    const te = tf.formState.errors
    const se = sf.formState.errors
    return (
      <div ref={rootRef} className="space-y-6">
        <StepBar step={1} />
        <div>
          <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Your Details</h2>
          <p className="text-sm text-content-body">Step 2 of 4 — Your information as the group organizer</p>
        </div>

        {/* Role selector */}
        <div className="bg-white rounded-xl border border-line p-6 space-y-4">
          <h3 className="font-semibold text-brand-blue-dark">I am registering as a…</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => setRegistrantRole('teacher')} aria-pressed={registrantRole === 'teacher'}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'teacher' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-line hover:border-line text-content-body'}`}>
              <span className="font-semibold block mb-0.5">Teacher / Coordinator</span>
              <span className="text-xs text-content-muted">I am an adult educator bringing students to this event</span>
            </button>
            <button type="button" onClick={() => setRegistrantRole('student_manager')} aria-pressed={registrantRole === 'student_manager'}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'student_manager' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-line hover:border-line text-content-body'}`}>
              <span className="font-semibold block mb-0.5">Student Manager</span>
              <span className="text-xs text-content-muted">I am a high school student organizing a group for this event</span>
            </button>
          </div>
        </div>

        {registrantRole === 'teacher' ? (
          <>
            {/* Teacher personal info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required error={te.first_name?.message}>
                  <Input {...tf.register('first_name')} autoComplete="given-name" />
                </Field>
                <Field label="Last Name" required error={te.last_name?.message}>
                  <Input {...tf.register('last_name')} autoComplete="family-name" />
                </Field>
              </div>
              <Field label="Preferred Name / Nickname">
                <Input {...tf.register('nickname')} autoComplete="nickname" placeholder="Optional" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Email Address" required
                  hint={emailLocked ? 'Linked to your Stellr account.' : undefined}
                  error={emailLocked ? undefined : te.email?.message}>
                  <Input {...tf.register('email')} type="email" autoComplete="email" readOnly={emailLocked} aria-readonly={emailLocked} />
                </Field>
                <Field label="Phone Number" required error={te.phone?.message}>
                  <Input {...tf.register('phone')} type="tel" autoComplete="tel" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Date of Birth" required error={te.date_of_birth?.message}>
                  <Input {...tf.register('date_of_birth')} type="date" autoComplete="bday" />
                </Field>
                <Field label="Gender" required error={te.gender?.message}>
                  <Select {...tf.register('gender')} autoComplete="sex"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</Select>
                </Field>
                <Field label="T-Shirt Size" required error={te.t_shirt_size?.message}>
                  <Select {...tf.register('t_shirt_size')}><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</Select>
                </Field>
              </div>
            </div>

            {/* Teacher school — SchoolSearchInput */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-4">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <Field label="School Name" required error={schoolError && !teacherSchool ? schoolError : undefined}>
                <SchoolSearchInput initialSchool={prefill?.school} onChange={setTeacherSchool} />
              </Field>
            </div>

            {/* Teacher additional info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity" note="Select all that apply" options={ETHNICITIES} selected={tEthnicity}
                onChange={v => tf.setValue('ethnicity', v, { shouldValidate: true })} error={te.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements" note="Select all that apply" options={DIETARY} selected={tDietary}
                onChange={v => tf.setValue('dietary_requirements', v, { shouldValidate: true })} error={te.dietary_requirements?.message} />
              <Field label="Health Conditions / Allergies">
                <Textarea {...tf.register('health_conditions')} className="resize-none" rows={3} placeholder="Leave blank if none." />
              </Field>
            </div>
          </>
        ) : (
          <>
            {/* SM personal info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name" required error={se.first_name?.message}>
                  <Input {...sf.register('first_name')} autoComplete="given-name" />
                </Field>
                <Field label="Last Name" required error={se.last_name?.message}>
                  <Input {...sf.register('last_name')} autoComplete="family-name" />
                </Field>
              </div>
              <Field label="Preferred Name / Nickname">
                <Input {...sf.register('nickname')} autoComplete="nickname" placeholder="Optional" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Email Address" required
                  hint={emailLocked ? 'Linked to your Stellr account.' : undefined}
                  error={emailLocked ? undefined : se.email?.message}>
                  <Input {...sf.register('email')} type="email" autoComplete="email" readOnly={emailLocked} aria-readonly={emailLocked} />
                </Field>
                <Field label="Phone Number" required error={se.phone?.message}>
                  <Input {...sf.register('phone')} type="tel" autoComplete="tel" />
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Date of Birth" required error={se.date_of_birth?.message}>
                  <Input {...sf.register('date_of_birth')} type="date" autoComplete="bday" />
                </Field>
                <Field label="Grade" required error={se.grade?.message}>
                  <Select {...sf.register('grade')}>
                    <option value="">Select…</option>{gradeOptions(band).map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </Select>
                </Field>
                <Field label="Gender" required error={se.gender?.message}>
                  <Select {...sf.register('gender')} autoComplete="sex"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</Select>
                </Field>
                <Field label="T-Shirt Size" required error={se.t_shirt_size?.message}>
                  <Select {...sf.register('t_shirt_size')}><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</Select>
                </Field>
              </div>
            </div>

            {/* SM school — SchoolSearchInput */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-4">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <Field label="School Name" required error={schoolError && !smSchool ? schoolError : undefined}>
                <SchoolSearchInput initialSchool={prefill?.school} onChange={setSmSchool} />
              </Field>
            </div>

            {/* SM additional info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity" note="Select all that apply" options={ETHNICITIES} selected={sEthnicity}
                onChange={v => sf.setValue('ethnicity', v, { shouldValidate: true })} error={se.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements" note="Select all that apply" options={DIETARY} selected={sDietary}
                onChange={v => sf.setValue('dietary_requirements', v, { shouldValidate: true })} error={se.dietary_requirements?.message} />
              <Field label="Health Conditions / Allergies">
                <Textarea {...sf.register('health_conditions')} className="resize-none" rows={3} placeholder="Leave blank if none." />
              </Field>
            </div>

            {/* SM emergency contact — a fieldset, so its "First Name" is announced
                as the emergency contact's, not the Student Manager's. */}
            <div className="bg-white rounded-xl border border-line p-6">
              <fieldset className="min-w-0" aria-describedby={smEcNoteId}>
                <legend><h3 className="font-semibold text-brand-blue-dark">Emergency Contact</h3></legend>
                <p id={smEcNoteId} className="text-xs text-content-faint mt-0.5">Required for High School student participants</p>
                <div className="mt-5 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="First Name" required error={se.emergency_contact_first_name?.message}>
                      <Input {...sf.register('emergency_contact_first_name')} autoComplete="section-emergency given-name" />
                    </Field>
                    <Field label="Last Name" required error={se.emergency_contact_last_name?.message}>
                      <Input {...sf.register('emergency_contact_last_name')} autoComplete="section-emergency family-name" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Email" required error={se.emergency_contact_email?.message}>
                      <Input {...sf.register('emergency_contact_email')} type="email" autoComplete="section-emergency email" />
                    </Field>
                    <Field label="Phone" required error={se.emergency_contact_phone?.message}>
                      <Input {...sf.register('emergency_contact_phone')} type="tel" autoComplete="section-emergency tel" />
                    </Field>
                  </div>
                  <Field label="Relationship To Participant" required error={se.emergency_contact_relationship?.message}>
                    <Select {...sf.register('emergency_contact_relationship')}>
                      <option value="">Select…</option>{EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </Field>
                </div>
              </fieldset>
            </div>

            {/* Teacher Point of Contact */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6">
              <fieldset className="min-w-0" aria-describedby={pocNoteId}>
                <legend><h3 className="font-semibold text-amber-900">Teacher Point of Contact</h3></legend>
                <p id={pocNoteId} className="text-xs text-amber-700 mt-0.5">Nominate a teacher who will be cc'd on all group correspondence. They are not the primary contact — that's you — but they'll be kept informed. Their details will be pre-filled as Adult 1 in the next step.</p>
                <div className="mt-5 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="First Name" required error={se.teacher_poc_first_name?.message}>
                      <Input {...sf.register('teacher_poc_first_name')} autoComplete="section-teacher given-name" />
                    </Field>
                    <Field label="Last Name" required error={se.teacher_poc_last_name?.message}>
                      <Input {...sf.register('teacher_poc_last_name')} autoComplete="section-teacher family-name" />
                    </Field>
                  </div>
                  <Field label="Teacher Email" required error={se.teacher_poc_email?.message}>
                    <Input {...sf.register('teacher_poc_email')} type="email" autoComplete="section-teacher email" />
                  </Field>
                </div>
              </fieldset>
            </div>
          </>
        )}

        <button type="button" onClick={goToStep2} className="btn-primary w-full py-3">
          Continue — Group Details →
        </button>
      </div>
    )
  }

  // ── Step 2: Group details ──────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="space-y-6">
      <StepBar step={2} />
      <div>
        <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Group Details</h2>
        <p className="text-sm text-content-body">Step 3 of 4 — Group size, member details, and payment</p>
      </div>

      <div className="bg-white rounded-xl border border-line p-6 space-y-6">
        <h3 className="font-semibold text-brand-blue-dark">Group Size</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <NumberStepper
            label="How many adults will be in the group?"
            value={adultCount}
            min={registrantRole === 'student_manager' ? 1 : 1}
            max={2}
            onChange={handleAdultCountChange}
            note={registrantRole === 'student_manager'
              ? 'Includes your Teacher Point of Contact. Maximum 2.'
              : 'Includes yourself as teacher / coordinator. Maximum 2.'}
          />
          <NumberStepper
            label={registrantRole === 'student_manager'
              ? 'How many other students will be in the group?'
              : 'How many students will be in the group?'}
            value={studentCount}
            min={registrantRole === 'student_manager' ? 1 : 2}
            max={registrantRole === 'student_manager' ? 19 : 20}
            onChange={handleStudentCountChange}
            note={registrantRole === 'student_manager'
              ? 'Besides yourself — you’re automatically included as Student 1. Minimum 1 other student, up to 19 (20 students total).'
              : 'Minimum 2. Maximum 20. For groups larger than 20, contact Stellr directly for custom registration.'} />
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark">
          Total participants: <strong>
            {registrantRole === 'student_manager'
              ? 1 + adultCount + studentCount
              : adultCount + studentCount}
          </strong>
          {registrantRole === 'student_manager' && <span className="ml-1 text-xs text-content-muted">(including yourself as Student Manager)</span>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-line p-6 space-y-4">
        <h3 id={detailsMethodLabelId} className="font-semibold text-brand-blue-dark">How do you want to provide team member details?</h3>
        <Select aria-labelledby={detailsMethodLabelId} value={detailsMethod} onChange={e => setDetailsMethod(e.target.value as DetailsMethod)}>
          <option value="add_now">Add them now via this screen</option>
          <option value="spreadsheet">Download a pre-populated spreadsheet and deliver details later</option>
          <option value="email_link">Email a registration link to group members</option>
        </Select>
        {detailsMethod === 'spreadsheet' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            You&apos;ll receive both a pre-populated Google Sheet <strong>and</strong> a forwardable registration link via email — use whichever works best for your group.
          </div>
        )}
        {detailsMethod === 'email_link' && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark space-y-1">
            <p className="font-medium">You&apos;ll receive both a forwardable registration link <strong>and</strong> a pre-populated spreadsheet via email.</p>
            <p className="text-content-muted text-xs">Each member who uses the link will sign in or create a free Stellr account and confirm their participation. You&apos;ll be notified as each member completes their registration.</p>
          </div>
        )}
      </div>

      {detailsMethod === 'add_now' && (
        <>
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark">
            <p className="font-medium">Add details for as many participants as you have now.</p>
            <p className="text-xs text-content-muted mt-0.5">
              You don&apos;t have to complete everyone — leave a card blank and you can finish the rest later
              via your completion link or pre-filled Google Sheet. Partly-filled cards must be finished or cleared before you submit.
            </p>
          </div>

          {additionalAdults.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold text-brand-blue-dark">
                {registrantRole === 'student_manager' ? 'Adults' : 'Additional Adults'}
              </h3>
              {additionalAdults.map((adult, i) => (
                <AdultAccordion key={i} index={i} data={adult}
                  isPoC={registrantRole === 'student_manager' && i === 0}
                  status={adultStatus(adult)}
                  errors={showSlotErrors ? adultSlotErrors(adult) : {}}
                  onChange={(field, value) => updateAdult(i, field, value)}
                  onAccept={(m) => acceptAdult(i, m)} onUnlink={() => unlinkAdult(i)}
                  expanded={expandedAdult === i} onToggle={() => setExpandedAdult(expandedAdult === i ? null : i)} />
              ))}
            </div>
          )}

          <div className="space-y-3">
            <h3 className="font-semibold text-brand-blue-dark">Students</h3>
            {registrantRole === 'student_manager' && (
              <StudentManagerCard data={sf.getValues()} onEdit={() => setStep(1)} />
            )}
            {students.map((student, i) => (
              <StudentAccordion key={i} index={i}
                displayNumber={i + 1 + (registrantRole === 'student_manager' ? 1 : 0)}
                data={student}
                status={studentStatus(student)}
                errors={showSlotErrors ? studentSlotErrors(student) : {}}
                onChange={(field, value) => updateStudent(i, field, value)}
                onAccept={(m) => acceptStudent(i, m)} onUnlink={() => unlinkStudent(i)}
                expanded={expandedStudent === i} onToggle={() => setExpandedStudent(expandedStudent === i ? null : i)}
                band={band} />
            ))}
          </div>
        </>
      )}

      {isCampaign || isFree ? (
        <div className="bg-enviro-green-bg border border-enviro-green-chip rounded-xl p-6">
          <p className="font-semibold text-enviro-green-text">
            {isCampaign
              ? 'No Payment Required For Campaigns — Good Luck!'
              : 'No Payment Required — This Event Is Free Of Charge'}
          </p>
          {!isCampaign && (
            <p className="text-sm text-enviro-green-text/80 mt-1">
              Each group member will be emailed to confirm they&apos;re registered and that nothing is owed.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line p-6 space-y-4">
          <h3 id={paymentMethodLabelId} className="font-semibold text-brand-blue-dark">How will the group pay?</h3>
          <Select aria-labelledby={paymentMethodLabelId} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}>
            <option value="invoice">Have an invoice emailed to you</option>
            <option value="card">Pay now via credit card</option>
            <option value="individual">Group members will pay individually</option>
          </Select>
          {paymentMethod === 'invoice' && <p className="text-sm text-content-muted">An invoice will be emailed to you within 1–2 business days. Registration is confirmed upon payment.</p>}
          {paymentMethod === 'card' && (
            <p className="text-sm text-content-muted">
              You&apos;ll be redirected to a secure Stripe checkout page to pay for all{' '}
              {registrantRole === 'student_manager' ? 1 + adultCount + studentCount : adultCount + studentCount} participants.
            </p>
          )}
          {paymentMethod === 'individual' && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark space-y-1">
              <p className="font-medium">Each group member will receive an individual payment link via email.</p>
              <p className="text-content-muted text-xs">Payment links are sent once each member is confirmed in the system — either now (if adding details today) or when they complete their self-registration.</p>
            </div>
          )}
        </div>
      )}

      {/* FERPA School Data Processing Agreement */}
      <div className={`bg-white rounded-xl border p-6 space-y-3 ${dpaError ? 'border-red-300' : 'border-line'}`}>
        <h3 className="font-semibold text-brand-blue-dark">School Data Terms</h3>
        <p className="text-sm text-content-body">
          Registering a group shares your students&apos; details (such as names, dates of birth, grades and
          school details) with Stellr Education. Our School Data Terms set out how we use and protect them:
          only to run the event, never for advertising, and deleted at your school&apos;s request when
          students withdraw. Each student&apos;s parent or guardian is also asked to sign a consent form.
        </p>
        {/* Not Choice: its row centres the box, and this label runs to several
            lines — the box sits with the first line instead. */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dpaAgreed}
            onChange={e => { setDpaAgreed(e.target.checked); if (e.target.checked) setDpaError(false) }}
            aria-invalid={dpaError || undefined}
            aria-describedby={dpaError ? dpaErrorId : undefined}
            className="mt-0.5 h-5 w-5 shrink-0 border-line-strong accent-primary-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
          />
          <span className="text-sm text-content-body">
            I confirm that I am authorized to share student data on behalf of my school, and I accept
            Stellr Education&apos;s{' '}
            <a href="/school-data-terms" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
              School Data Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
              Privacy Policy
            </a>{' '}
            for my school.
          </span>
        </label>
        {dpaError && <p id={dpaErrorId} className="text-sm text-danger">Accept the School Data Terms to submit this registration.</p>}
      </div>

      {detailsMethod === 'add_now' && deferredCount() > 0 && (
        <div className="bg-surface border border-line rounded-lg px-4 py-3 text-sm text-content-body">
          <strong className="text-brand-blue-dark">{deferredCount()}</strong> participant{deferredCount() === 1 ? '' : 's'} left blank will be completed later —
          you&apos;ll get a completion link and a pre-filled Google Sheet for them on the next screen and by email.
        </div>
      )}

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={
            notice.kind === 'error'
              ? 'bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700'
              : 'bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800'
          }
        >
          {notice.text}
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1 py-3">← Back</button>
        <button type="button" onClick={handleFinalSubmit} disabled={submitting}
          className="btn-primary flex-1 py-3 disabled:opacity-60">
          {submitting ? 'Submitting…' : !isCampaign && !isFree && paymentMethod === 'card' ? 'Continue to Payment →' : 'Submit Registration'}
        </button>
      </div>

      <p className="text-xs text-content-faint text-center">By submitting you confirm all details are accurate.</p>
    </div>
  )
}
