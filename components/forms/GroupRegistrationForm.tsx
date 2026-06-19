'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useRouter } from 'next/navigation'
import { useAuth } from '@clerk/nextjs'
import { useSignIn } from '@clerk/nextjs/legacy'
import { ChevronDown, ChevronUp } from 'lucide-react'
import FieldError from '@/components/forms/FieldError'
import { SchoolSearchInput, SchoolSelection } from '@/components/member/SchoolSearchInput'
import { T_SHIRT_SIZES, GENDERS, GRADES, ETHNICITIES, DIETARY, EMERGENCY_RELATIONSHIPS, deriveAgeBracket } from '@/lib/registration-constants'
import { resolveSchoolPayload } from '@/lib/school-utils'
import { MemberIdLookup, type MemberMatch } from '@/components/forms/MemberIdLookup'
import type { RegistrationPrefill } from '@/lib/registration-prefill'

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
  const steps = [
    { n: 1, label: 'Registration Type', done: true },
    { n: 2, label: 'Your Details', done: step > 1, current: step === 1 },
    { n: 3, label: 'Group Details', done: false, current: step === 2 },
    { n: 4, label: 'Confirmation', done: false, current: false },
  ]
  return (
    <div className="bg-white border-b border-line -mx-4 px-4 py-4 mb-6 sm:-mx-0">
      <div className="flex items-center gap-1 sm:gap-2 text-xs sm:text-sm flex-wrap">
        {steps.map((s, i) => (
          <div key={s.n} className="flex items-center gap-1 sm:gap-2">
            {i > 0 && <span className="text-content-faint">›</span>}
            <span className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
              s.done ? 'bg-green-500 text-white' : s.current ? 'bg-brand-blue text-white' : 'bg-line-light text-content-faint'
            }`}>
              {s.done ? '✓' : s.n}
            </span>
            <span className={s.current ? 'font-medium text-brand-blue-dark' : 'text-content-faint'}>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Shared: multi-checkbox ────────────────────────────────────────────────────
function MultiCheckboxes({ label, note, options, selected, onChange, error }: {
  label: string; note?: string; options: string[]
  selected: string[]; onChange: (v: string[]) => void; error?: string
}) {
  return (
    <div>
      <p className="font-semibold text-brand-blue-dark mb-1">{label}</p>
      {note && <p className="text-xs text-content-faint mb-2">{note}</p>}
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt => (
          <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(opt)}
              onChange={() => onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt])}
              className="rounded border-line text-brand-blue" />
            {opt}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

// ── Number stepper ────────────────────────────────────────────────────────────
function NumberStepper({ label, value, min, max, onChange, note }: {
  label: string; value: number; min: number; max: number; onChange: (n: number) => void; note?: string
}) {
  return (
    <div>
      <label className="label-text">{label}</label>
      <div className="flex items-center gap-3 mt-1">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-lg font-medium text-content-body hover:bg-surface disabled:opacity-40">
          −
        </button>
        <span className="w-10 text-center font-semibold text-brand-blue-dark text-lg">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
          className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-lg font-medium text-content-body hover:bg-surface disabled:opacity-40">
          +
        </button>
      </div>
      {note && <p className="text-xs text-content-faint mt-1">{note}</p>}
    </div>
  )
}

// ── Per-slot completion status ────────────────────────────────────────────────
// A slot is 'empty' (deferred — finish later via link/Sheet), 'incomplete'
// (started but missing required fields — blocks submit), or 'complete'. The field
// lists here MUST mirror validateParticipants() so the pill never disagrees with
// the submit gate. Linked slots are built from the member's on-file record → always
// complete.
type SlotStatus = 'complete' | 'incomplete' | 'empty'

function adultStatus(a: AdultData): SlotStatus {
  if (a.linked) return 'complete'
  if (!(a.first_name || a.last_name || a.email)) return 'empty'
  const complete = !!(a.first_name && a.last_name && a.email && a.phone && a.date_of_birth &&
    a.gender && a.t_shirt_size && a.ethnicity.length && a.dietary_requirements.length)
  return complete ? 'complete' : 'incomplete'
}

function studentStatus(s: StudentData): SlotStatus {
  if (s.linked) return 'complete'
  if (!(s.first_name || s.last_name || s.email)) return 'empty'
  const core = !!(s.first_name && s.last_name && s.email && s.phone && s.date_of_birth && s.grade &&
    s.gender && s.t_shirt_size && s.ethnicity.length && s.dietary_requirements.length)
  const ec = !!(s.emergency_contact_first_name && s.emergency_contact_last_name &&
    s.emergency_contact_email && s.emergency_contact_phone && s.emergency_contact_relationship)
  return core && ec ? 'complete' : 'incomplete'
}

function StatusPill({ status }: { status: SlotStatus }) {
  const map: Record<SlotStatus, { label: string; cls: string }> = {
    complete:   { label: 'Complete',       cls: 'bg-green-100 text-green-700' },
    incomplete: { label: 'Incomplete',     cls: 'bg-amber-100 text-amber-700' },
    empty:      { label: 'To finish later', cls: 'bg-surface text-content-muted' },
  }
  const { label, cls } = map[status]
  return <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${cls}`}>{label}</span>
}

// ── Adult accordion ───────────────────────────────────────────────────────────
function AdultAccordion({ index, data, onChange, onAccept, onUnlink, expanded, onToggle, isPoC, status }: {
  index: number; data: AdultData
  onChange: (field: keyof AdultData, value: string | string[]) => void
  onAccept: (m: MemberMatch) => void; onUnlink: () => void
  expanded: boolean; onToggle: () => void; isPoC?: boolean; status: SlotStatus
}) {
  const label = data.first_name && data.last_name
    ? `${data.first_name} ${data.last_name}${isPoC ? ' (Teacher Point of Contact)' : ''}`
    : isPoC
      ? 'Teacher Point of Contact (Adult 1)'
      : `Additional Adult ${index + 1}`
  return (
    <div className={`rounded-xl overflow-hidden border ${isPoC ? 'border-amber-200' : 'border-line'}`}>
      <button type="button" onClick={onToggle}
        className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left ${isPoC ? 'bg-amber-50 hover:bg-amber-100' : 'bg-surface hover:bg-surface'}`}>
        <span className={`font-medium text-sm ${isPoC ? 'text-amber-900' : 'text-brand-blue-dark'}`}>{label}</span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <StatusPill status={status} />
          {expanded ? <ChevronUp size={16} className="text-content-faint" /> : <ChevronDown size={16} className="text-content-faint" />}
        </span>
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
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
                <div><label className="label-text">First Name *</label><input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Last Name *</label><input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} className="input-field" /></div>
              </div>
              <div><label className="label-text">Preferred Name / Nickname</label><input value={data.nickname} onChange={e => onChange('nickname', e.target.value)} className="input-field" placeholder="Optional" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email *</label><input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Phone *</label><input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} className="input-field" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="label-text">Date of Birth *</label><input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} className="input-field" /></div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select value={data.gender} onChange={e => onChange('gender', e.target.value)} className="input-field">
                    <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-text">T-Shirt Size *</label>
                  <select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)} className="input-field">
                    <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES}
                selected={data.ethnicity} onChange={v => onChange('ethnicity', v)} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY}
                selected={data.dietary_requirements} onChange={v => onChange('dietary_requirements', v)} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="input-field resize-none" rows={2} placeholder="Leave blank if none." />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Student accordion ─────────────────────────────────────────────────────────
function StudentAccordion({ index, displayNumber, data, onChange, onAccept, onUnlink, expanded, onToggle, status }: {
  index: number; displayNumber?: number; data: StudentData
  onChange: (field: keyof StudentData, value: string | string[]) => void
  onAccept: (m: MemberMatch) => void; onUnlink: () => void
  expanded: boolean; onToggle: () => void; status: SlotStatus
}) {
  const label = data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : `Student ${displayNumber ?? index + 1}`
  return (
    <div className="border border-line rounded-xl overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-surface hover:bg-surface text-left">
        <span className="font-medium text-brand-blue-dark text-sm">{label}</span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <StatusPill status={status} />
          {expanded ? <ChevronUp size={16} className="text-content-faint" /> : <ChevronDown size={16} className="text-content-faint" />}
        </span>
      </button>
      {expanded && (
        <div className="p-4 space-y-4">
          <MemberIdLookup value={data.existing_membership_id} linked={data.linked}
            linkedName={`${data.first_name} ${data.last_name}`.trim()}
            onChange={v => onChange('existing_membership_id', v)} onAccept={onAccept} onUnlink={onUnlink} />
          {!data.linked && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input value={data.first_name} onChange={e => onChange('first_name', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Last Name *</label><input value={data.last_name} onChange={e => onChange('last_name', e.target.value)} className="input-field" /></div>
              </div>
              <div><label className="label-text">Preferred Name / Nickname</label><input value={data.nickname} onChange={e => onChange('nickname', e.target.value)} className="input-field" placeholder="Optional" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email *</label><input type="email" value={data.email} onChange={e => onChange('email', e.target.value)} className="input-field" /></div>
                <div><label className="label-text">Phone *</label><input type="tel" value={data.phone} onChange={e => onChange('phone', e.target.value)} className="input-field" /></div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="col-span-2 sm:col-span-1"><label className="label-text">Date of Birth *</label><input type="date" value={data.date_of_birth} onChange={e => onChange('date_of_birth', e.target.value)} className="input-field" /></div>
                <div>
                  <label className="label-text">Grade *</label>
                  <select value={data.grade} onChange={e => onChange('grade', e.target.value)} className="input-field">
                    <option value="">Select…</option>{GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select value={data.gender} onChange={e => onChange('gender', e.target.value)} className="input-field">
                    <option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label-text">T-Shirt *</label>
                  <select value={data.t_shirt_size} onChange={e => onChange('t_shirt_size', e.target.value)} className="input-field">
                    <option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES}
                selected={data.ethnicity} onChange={v => onChange('ethnicity', v)} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY}
                selected={data.dietary_requirements} onChange={v => onChange('dietary_requirements', v)} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea value={data.health_conditions} onChange={e => onChange('health_conditions', e.target.value)} className="input-field resize-none" rows={2} placeholder="Leave blank if none." />
              </div>
              <div className="border-t border-line-light pt-4 space-y-4">
                <div>
                  <p className="font-semibold text-brand-blue-dark text-sm">Emergency Contact</p>
                  <p className="text-xs text-content-faint">Required for all student participants — acts as the guardian for their participation agreement</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="label-text">First Name *</label><input value={data.emergency_contact_first_name} onChange={e => onChange('emergency_contact_first_name', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Last Name *</label><input value={data.emergency_contact_last_name} onChange={e => onChange('emergency_contact_last_name', e.target.value)} className="input-field" /></div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className="label-text">Email *</label><input type="email" value={data.emergency_contact_email} onChange={e => onChange('emergency_contact_email', e.target.value)} className="input-field" /></div>
                  <div><label className="label-text">Phone *</label><input type="tel" value={data.emergency_contact_phone} onChange={e => onChange('emergency_contact_phone', e.target.value)} className="input-field" /></div>
                </div>
                <div>
                  <label className="label-text">Relationship To Participant *</label>
                  <select value={data.emergency_contact_relationship} onChange={e => onChange('emergency_contact_relationship', e.target.value)} className="input-field">
                    <option value="">Select…</option>{EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
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
export default function GroupRegistrationForm({ eventSlug, eventTitle, prefill, contentTierOfferings = [] }: { eventSlug: string; eventTitle: string; prefill?: RegistrationPrefill | null; contentTierOfferings?: { tier: string; priceUsd?: number }[] }) {
  const router = useRouter()
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn()
  const { isSignedIn } = useAuth()
  const [step, setStep] = useState<1 | 2>(1)
  // Competition content tier the buyer selects for the whole group (decision D3).
  // Only campaigns with offerings show the picker; defaults to the first offered.
  const [contentTier, setContentTier] = useState<string | null>(contentTierOfferings[0]?.tier ?? null)
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
  const [error, setError] = useState<string | null>(null)
  const [dpaAgreed, setDpaAgreed] = useState(false)
  const [dpaError, setDpaError] = useState(false)

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

  function updateStudent(i: number, field: keyof StudentData, value: string | string[]) {
    setStudents(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))
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
      return
    }

    if (!valid) return

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
  // are deferred and linked slots use the member's on-file record.
  function validateParticipants(): string | null {
    if (detailsMethod !== 'add_now') return null
    for (let i = 0; i < additionalAdults.length; i++) {
      const a = additionalAdults[i]
      if (a.linked || !adultStarted(a)) continue
      if (!a.first_name || !a.last_name || !a.email || !a.phone || !a.date_of_birth || !a.gender || !a.t_shirt_size || a.ethnicity.length === 0 || a.dietary_requirements.length === 0)
        return `${i === 0 && registrantRole === 'student_manager' ? 'Teacher Point of Contact' : `Additional Adult ${i + 1}`} is partly filled — finish their required fields, or clear the entry to add them later via your link or Sheet`
    }
    // Student Manager occupies Student 1 (read-only), so the editable students
    // shown below start at Student 2 — keep error numbering in step.
    const studentOffset = registrantRole === 'student_manager' ? 1 : 0
    for (let i = 0; i < students.length; i++) {
      const s = students[i]
      if (s.linked || !studentStarted(s)) continue
      if (!s.first_name || !s.last_name || !s.email || !s.phone || !s.date_of_birth || !s.grade || !s.gender || !s.t_shirt_size || s.ethnicity.length === 0 || s.dietary_requirements.length === 0)
        return `Student ${i + 1 + studentOffset} is partly filled — finish their required fields, or clear the entry to add them later via your link or Sheet`
      // Every student signs the minor participation agreement, with their
      // emergency contact as the guardian — so it's required for all students.
      if (!s.emergency_contact_first_name || !s.emergency_contact_last_name || !s.emergency_contact_email || !s.emergency_contact_phone || !s.emergency_contact_relationship)
        return `Student ${i + 1 + studentOffset} is partly filled — an emergency contact is required, or clear the entry to add them later`
    }
    return null
  }

  // ── Final submit ──────────────────────────────────────────────────────────────
  async function handleFinalSubmit() {
    setSubmitting(true)
    setError(null)

    const participantError = validateParticipants()
    if (participantError) {
      setError(participantError)
      setSubmitting(false)
      return
    }

    if (!dpaAgreed) {
      setDpaError(true)
      setSubmitting(false)
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
          content_tier: contentTier,
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
          payment_method: paymentMethod,
          member_pays_individually: paymentMethod === 'individual',
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

      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error ?? 'Registration failed')
      }

      const { registrationId, checkoutUrl, spreadsheetUrl, joinUrl, signInToken } = await res.json()
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
        // Surface the Sheet for the spreadsheet/email-link flows, or whenever some
        // participants were deferred for later completion (partial add-now).
        if (spreadsheetUrl && (detailsMethod !== 'add_now' || remaining > 0)) params.set('spreadsheet', encodeURIComponent(spreadsheetUrl))
        if (joinUrl && remaining > 0) params.set('join', encodeURIComponent(joinUrl))
        if (remaining > 0) params.set('remaining', String(remaining))
        router.push(`/register/${eventSlug}/confirmation?${params.toString()}`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  // ── Step 1: Registrant details ─────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-6">
        <StepBar step={1} />
        <div>
          <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Your Details</h2>
          <p className="text-sm text-content-body">Step 2 of 4 — Your information as the group organiser</p>
        </div>

        {/* Role selector */}
        <div className="bg-white rounded-xl border border-line p-6 space-y-4">
          <h3 className="font-semibold text-brand-blue-dark">I am registering as a…</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => setRegistrantRole('teacher')}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'teacher' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-line hover:border-line text-content-body'}`}>
              <span className="font-semibold block mb-0.5">Teacher / Coordinator</span>
              <span className="text-xs text-content-muted">I am an adult educator bringing students to this event</span>
            </button>
            <button type="button" onClick={() => setRegistrantRole('student_manager')}
              className={`text-left px-4 py-3 rounded-lg border-2 text-sm transition-colors ${registrantRole === 'student_manager' ? 'border-brand-blue bg-blue-50 text-brand-blue-dark' : 'border-line hover:border-line text-content-body'}`}>
              <span className="font-semibold block mb-0.5">Student Manager</span>
              <span className="text-xs text-content-muted">I am a high school student organising a group for this event</span>
            </button>
          </div>
        </div>

        {registrantRole === 'teacher' ? (
          <>
            {/* Teacher personal info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...tf.register('first_name')} className="input-field" /><FieldError message={tf.formState.errors.first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...tf.register('last_name')} className="input-field" /><FieldError message={tf.formState.errors.last_name?.message} /></div>
              </div>
              <div><label className="label-text">Preferred Name / Nickname</label><input {...tf.register('nickname')} className="input-field" placeholder="Optional" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email Address *</label><input {...tf.register('email')} type="email" className="input-field" readOnly={emailLocked} aria-readonly={emailLocked} />{emailLocked ? <p className="mt-1 text-xs text-content-faint">Linked to your Stellr account.</p> : <FieldError message={tf.formState.errors.email?.message} />}</div>
                <div><label className="label-text">Phone Number *</label><input {...tf.register('phone')} type="tel" className="input-field" /><FieldError message={tf.formState.errors.phone?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div><label className="label-text">Date of Birth *</label><input {...tf.register('date_of_birth')} type="date" className="input-field" /><FieldError message={tf.formState.errors.date_of_birth?.message} /></div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select {...tf.register('gender')} className="input-field"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select>
                  <FieldError message={tf.formState.errors.gender?.message} />
                </div>
                <div>
                  <label className="label-text">T-Shirt Size *</label>
                  <select {...tf.register('t_shirt_size')} className="input-field"><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <FieldError message={tf.formState.errors.t_shirt_size?.message} />
                </div>
              </div>
            </div>

            {/* Teacher school — SchoolSearchInput */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-4">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <div>
                <label className="label-text">School Name *</label>
                <SchoolSearchInput initialSchool={prefill?.school} onChange={setTeacherSchool} />
                {schoolError && !teacherSchool && <p className="text-xs text-red-500 mt-1">{schoolError}</p>}
              </div>
            </div>

            {/* Teacher additional info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES} selected={tEthnicity}
                onChange={v => tf.setValue('ethnicity', v, { shouldValidate: true })} error={tf.formState.errors.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY} selected={tDietary}
                onChange={v => tf.setValue('dietary_requirements', v, { shouldValidate: true })} error={tf.formState.errors.dietary_requirements?.message} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea {...tf.register('health_conditions')} className="input-field resize-none" rows={3} placeholder="Leave blank if none." />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* SM personal info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <h3 className="font-semibold text-brand-blue-dark">Personal Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('first_name')} className="input-field" /><FieldError message={sf.formState.errors.first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('last_name')} className="input-field" /><FieldError message={sf.formState.errors.last_name?.message} /></div>
              </div>
              <div><label className="label-text">Preferred Name / Nickname</label><input {...sf.register('nickname')} className="input-field" placeholder="Optional" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email Address *</label><input {...sf.register('email')} type="email" className="input-field" readOnly={emailLocked} aria-readonly={emailLocked} />{emailLocked ? <p className="mt-1 text-xs text-content-faint">Linked to your Stellr account.</p> : <FieldError message={sf.formState.errors.email?.message} />}</div>
                <div><label className="label-text">Phone Number *</label><input {...sf.register('phone')} type="tel" className="input-field" /><FieldError message={sf.formState.errors.phone?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div><label className="label-text">Date of Birth *</label><input {...sf.register('date_of_birth')} type="date" className="input-field" /><FieldError message={sf.formState.errors.date_of_birth?.message} /></div>
                <div>
                  <label className="label-text">Grade *</label>
                  <select {...sf.register('grade')} className="input-field">
                    <option value="">Select…</option>{['9','10','11','12'].map(g => <option key={g} value={g}>Grade {g}</option>)}
                  </select>
                  <FieldError message={sf.formState.errors.grade?.message} />
                </div>
                <div>
                  <label className="label-text">Gender *</label>
                  <select {...sf.register('gender')} className="input-field"><option value="">Select…</option>{GENDERS.map(g => <option key={g} value={g}>{g}</option>)}</select>
                  <FieldError message={sf.formState.errors.gender?.message} />
                </div>
                <div>
                  <label className="label-text">T-Shirt Size *</label>
                  <select {...sf.register('t_shirt_size')} className="input-field"><option value="">Select…</option>{T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}</select>
                  <FieldError message={sf.formState.errors.t_shirt_size?.message} />
                </div>
              </div>
            </div>

            {/* SM school — SchoolSearchInput */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-4">
              <h3 className="font-semibold text-brand-blue-dark">School</h3>
              <div>
                <label className="label-text">School Name *</label>
                <SchoolSearchInput initialSchool={prefill?.school} onChange={setSmSchool} />
                {schoolError && !smSchool && <p className="text-xs text-red-500 mt-1">{schoolError}</p>}
              </div>
            </div>

            {/* SM additional info */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <MultiCheckboxes label="Ethnicity *" note="Select all that apply" options={ETHNICITIES} selected={sEthnicity}
                onChange={v => sf.setValue('ethnicity', v, { shouldValidate: true })} error={sf.formState.errors.ethnicity?.message} />
              <MultiCheckboxes label="Dietary Requirements *" note="Select all that apply" options={DIETARY} selected={sDietary}
                onChange={v => sf.setValue('dietary_requirements', v, { shouldValidate: true })} error={sf.formState.errors.dietary_requirements?.message} />
              <div>
                <label className="label-text">Health Conditions / Allergies</label>
                <textarea {...sf.register('health_conditions')} className="input-field resize-none" rows={3} placeholder="Leave blank if none." />
              </div>
            </div>

            {/* SM emergency contact */}
            <div className="bg-white rounded-xl border border-line p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-brand-blue-dark">Emergency Contact</h3>
                <p className="text-xs text-content-faint mt-0.5">Required for High School student participants</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('emergency_contact_first_name')} className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('emergency_contact_last_name')} className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_last_name?.message} /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">Email *</label><input {...sf.register('emergency_contact_email')} type="email" className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_email?.message} /></div>
                <div><label className="label-text">Phone *</label><input {...sf.register('emergency_contact_phone')} type="tel" className="input-field" /><FieldError message={sf.formState.errors.emergency_contact_phone?.message} /></div>
              </div>
              <div>
                <label className="label-text">Relationship To Participant *</label>
                <select {...sf.register('emergency_contact_relationship')} className="input-field">
                  <option value="">Select…</option>{EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <FieldError message={sf.formState.errors.emergency_contact_relationship?.message} />
              </div>
            </div>

            {/* Teacher Point of Contact */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-6 space-y-5">
              <div>
                <h3 className="font-semibold text-amber-900">Teacher Point of Contact</h3>
                <p className="text-xs text-amber-700 mt-0.5">Nominate a teacher who will be cc'd on all group correspondence. They are not the primary contact — that's you — but they'll be kept informed. Their details will be pre-filled as Adult 1 in the next step.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="label-text">First Name *</label><input {...sf.register('teacher_poc_first_name')} className="input-field" /><FieldError message={sf.formState.errors.teacher_poc_first_name?.message} /></div>
                <div><label className="label-text">Last Name *</label><input {...sf.register('teacher_poc_last_name')} className="input-field" /><FieldError message={sf.formState.errors.teacher_poc_last_name?.message} /></div>
              </div>
              <div>
                <label className="label-text">Teacher Email *</label>
                <input {...sf.register('teacher_poc_email')} type="email" className="input-field" />
                <FieldError message={sf.formState.errors.teacher_poc_email?.message} />
              </div>
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
    <div className="space-y-6">
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
        <h3 className="font-semibold text-brand-blue-dark">How do you want to provide team member details?</h3>
        <select value={detailsMethod} onChange={e => setDetailsMethod(e.target.value as DetailsMethod)} className="input-field">
          <option value="add_now">Add them now via this screen</option>
          <option value="spreadsheet">Download a pre-populated spreadsheet and deliver details later</option>
          <option value="email_link">Email a registration link to group members</option>
        </select>
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
                onChange={(field, value) => updateStudent(i, field, value)}
                onAccept={(m) => acceptStudent(i, m)} onUnlink={() => unlinkStudent(i)}
                expanded={expandedStudent === i} onToggle={() => setExpandedStudent(expandedStudent === i ? null : i)} />
            ))}
          </div>
        </>
      )}

      {contentTierOfferings.length > 0 && (
        <div className="bg-white rounded-xl border border-line p-6 space-y-3">
          <h3 className="font-semibold text-brand-blue-dark">Content tier</h3>
          <p className="text-sm text-content-muted">
            Choose the competition content package for your group. Core material is always included.
          </p>
          <div className="space-y-2">
            {contentTierOfferings.map((o) => (
              <label
                key={o.tier}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-4 py-2.5 ${
                  contentTier === o.tier ? 'border-brand-blue-dark bg-blue-50' : 'border-line'
                }`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="content_tier"
                    checked={contentTier === o.tier}
                    onChange={() => setContentTier(o.tier)}
                  />
                  <span className="font-medium capitalize text-ink">{o.tier}</span>
                </span>
                <span className="text-sm font-medium text-content-body">
                  {o.priceUsd ? `$${o.priceUsd}` : 'Free'}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-line p-6 space-y-4">
        <h3 className="font-semibold text-brand-blue-dark">How will the group pay?</h3>
        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="input-field">
          <option value="invoice">Have an invoice emailed to you</option>
          <option value="card">Pay now via credit card</option>
          <option value="individual">Group members will pay individually</option>
        </select>
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

      {/* FERPA School Data Processing Agreement */}
      <div className={`bg-white rounded-xl border p-6 space-y-3 ${dpaError ? 'border-red-300' : 'border-line'}`}>
        <h3 className="font-semibold text-brand-blue-dark">School Data Processing Agreement</h3>
        <p className="text-sm text-content-body">
          By registering a group of students, your school is sharing education records (including student names,
          dates of birth, grades, and school details) with Stellr Education. Under FERPA, this requires your
          school to act as a &ldquo;school official&rdquo; and agree to Stellr&apos;s data processing terms.
        </p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dpaAgreed}
            onChange={e => { setDpaAgreed(e.target.checked); if (e.target.checked) setDpaError(false) }}
            className="mt-0.5 rounded border-line text-brand-blue flex-shrink-0"
          />
          <span className="text-sm text-content-body">
            I confirm that I am authorised to share student data on behalf of my school, and I agree to
            Stellr Education&apos;s{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
              Privacy Policy
            </a>{' '}
            and school data processing terms, including the use of DocuSign to collect parental consent
            for minor participants.
          </span>
        </label>
        {dpaError && <p className="text-xs text-red-500">You must accept the School Data Processing Agreement to submit this registration.</p>}
      </div>

      {detailsMethod === 'add_now' && deferredCount() > 0 && (
        <div className="bg-surface border border-line rounded-lg px-4 py-3 text-sm text-content-body">
          <strong className="text-brand-blue-dark">{deferredCount()}</strong> participant{deferredCount() === 1 ? '' : 's'} left blank will be completed later —
          you&apos;ll get a completion link and a pre-filled Google Sheet for them on the next screen and by email.
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>}

      <div className="flex gap-3">
        <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1 py-3">← Back</button>
        <button type="button" onClick={handleFinalSubmit} disabled={submitting}
          className="btn-primary flex-1 py-3 disabled:opacity-60">
          {submitting ? 'Submitting…' : paymentMethod === 'card' ? 'Continue to Payment →' : 'Submit Registration'}
        </button>
      </div>

      <p className="text-xs text-content-faint text-center">By submitting you confirm all details are accurate.</p>
    </div>
  )
}
