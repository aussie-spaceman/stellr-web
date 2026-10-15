'use client'

import { useId, useState } from 'react'
import { Choice, Field, Fieldset, Input, Select } from '@stellr/web-ui'
import { ageOn, isValidDob } from '@/lib/age'
import { T_SHIRT_SIZES } from '@/lib/registration-constants'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ROLES_FOR_BRACKET, DEFAULT_ROLE_FOR_BRACKET, getEligibleTierNames } from '@/lib/membership-rules'
import { SchoolSearchInput, SchoolSelection } from '@/components/member/SchoolSearchInput'

interface Tier { id: string; name: string }

interface Props {
  tiers: Tier[]
  /** Admin path to go back to after saving instead of the new member's page. */
  returnTo?: string | null
}

const GRADES = [
  // 6–8 exist because some events open below high school (Colorado 2027 runs
  // grades 7–12). The filter below still splits on the `grade_` prefix.
  { value: 'grade_6', label: 'Grade 6' },
  { value: 'grade_7', label: 'Grade 7' },
  { value: 'grade_8', label: 'Grade 8' },
  { value: 'grade_9', label: 'Grade 9' },
  { value: 'grade_10', label: 'Grade 10' },
  { value: 'grade_11', label: 'Grade 11' },
  { value: 'grade_12', label: 'Grade 12' },
  { value: 'college_freshman', label: 'College Freshman' },
  { value: 'college_sophomore', label: 'College Sophomore' },
  { value: 'college_junior', label: 'College Junior' },
  { value: 'college_senior', label: 'College Senior' },
  { value: 'grad_phd', label: 'Grad / PhD' },
]

const BRACKETS = ['high_school', 'college', 'adult']
const GENDERS = ['male', 'female', 'other']
// deep review QUAL-2: this form used to submit '3XL_plus' while every
// registration path uses the canonical '3XL (or larger)', splitting one size
// across rosters/merch. Use the single source so the stored value matches.
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']

// The fields a create can't go without, in the order they appear.
type RequiredField = 'first_name' | 'last_name' | 'email'

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Exact to the day (lib/age): a year subtraction called a 17-year-old born in
// December 18, and skipped the guardian fields.
function ageFromDob(dob: string): number | null {
  return isValidDob(dob) ? ageOn(dob) : null
}

// An admin is entering someone else's details, so the text fields opt out of
// autofill: the browser would otherwise offer the admin's own name and email.
export function AdminAddMember({ tiers, returnTo }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({})
  const uid = useId()
  const fid = (field: string) => `${uid}-${field}`

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    nickname: '',
    email: '',
    phone: '',
    date_of_birth: '',
    gender: '',
    age_bracket: 'adult',
    event_role: 'teacher',
    grade: '',
    tshirt_size: '',
    discord_handle: '',
    ethnicity: [] as string[],
    dietary_requirements: [] as string[],
    health_conditions: '',
    ec_first_name: '',
    ec_last_name: '',
    ec_email: '',
    ec_phone: '',
    ec_relationship: '',
    tier_id: '',
  })

  const [schoolSelection, setSchoolSelection] = useState<SchoolSelection | null>(null)
  const [sendInvite, setSendInvite] = useState(true)

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    setFieldErrors((e) => (e[field as RequiredField] ? { ...e, [field]: undefined } : e))
  }

  function toggleMulti(field: 'ethnicity' | 'dietary_requirements', opt: string) {
    setForm((f) => {
      const cur = f[field]
      return { ...f, [field]: cur.includes(opt) ? cur.filter((d) => d !== opt) : [...cur, opt] }
    })
  }

  function handleBracketChange(bracket: string) {
    const defaultRole = DEFAULT_ROLE_FOR_BRACKET[bracket] ?? ''
    setForm((f) => ({ ...f, age_bracket: bracket, event_role: defaultRole, tier_id: '' }))
  }

  function handleDobChange(dob: string) {
    const age = ageFromDob(dob)
    if (age !== null && age < 18) {
      setForm((f) => ({ ...f, date_of_birth: dob, age_bracket: 'high_school', event_role: 'participant', tier_id: '' }))
    } else {
      setForm((f) => ({ ...f, date_of_birth: dob }))
    }
  }

  const isMinor = form.date_of_birth ? (ageFromDob(form.date_of_birth) ?? 99) < 18 : false
  const eligibleRoles = isMinor ? ['participant'] : (ROLES_FOR_BRACKET[form.age_bracket] ?? [])
  const eligibleTierNames = getEligibleTierNames(form.age_bracket, form.event_role)
  const eligibleTiers = tiers.filter((t) => eligibleTierNames.includes(t.name))
  const showGrade = form.age_bracket === 'high_school' || form.age_bracket === 'college'

  async function handleSubmit() {
    setError('')
    // Each gap shows under its own field, and focus goes to the first one.
    const missing: Partial<Record<RequiredField, string>> = {}
    if (!form.first_name.trim()) missing.first_name = 'Enter a first name.'
    if (!form.last_name.trim()) missing.last_name = 'Enter a last name.'
    if (!form.email.trim()) missing.email = 'Enter an email address.'
    setFieldErrors(missing)
    const first = Object.keys(missing)[0]
    if (first) {
      requestAnimationFrame(() => document.getElementById(fid(first))?.focus())
      return
    }
    setSaving(true)
    const schoolPayload =
      schoolSelection?.type === 'existing'
        ? { school_id: schoolSelection.id }
        : schoolSelection?.type === 'new'
        ? {
            school_id: 'new',
            new_school_name: schoolSelection.data.name,
            new_school_address_line1: schoolSelection.data.address_line1,
            new_school_address_line2: schoolSelection.data.address_line2,
            new_school_city: schoolSelection.data.city,
            new_school_state: schoolSelection.data.state,
            new_school_postcode: schoolSelection.data.postcode,
          }
        : {}
    const res = await fetch('/api/admin/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...schoolPayload, send_invite: sendInvite }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create member.')
      return
    }
    const { member } = await res.json()
    router.push(returnTo ?? `/admin/members/${member.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin/members" className="text-sm text-brand-muted-soft hover:text-brand-muted mb-1 inline-block">
            ← All members
          </Link>
          <h1 className="font-heading text-ds-h2 text-brand-blue-dark">Add member</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">
            Manually create a member record. They finish their own profile from the invitation email.
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create member'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Identity */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Identity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name" required error={fieldErrors.first_name}>
                <Input
                  id={fid('first_name')}
                  type="text"
                  autoComplete="off"
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                />
              </Field>
              <Field label="Last name" required error={fieldErrors.last_name}>
                <Input
                  id={fid('last_name')}
                  type="text"
                  autoComplete="off"
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                />
              </Field>
              <Field label="Preferred name / nickname">
                <Input
                  type="text"
                  autoComplete="off"
                  value={form.nickname}
                  onChange={(e) => set('nickname', e.target.value)}
                />
              </Field>
              <Field label="Email" required error={fieldErrors.email}>
                <Input
                  id={fid('email')}
                  type="email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field label="Phone">
                <Input
                  type="tel"
                  autoComplete="off"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>
              <Field
                label="Date of birth"
                hint={isMinor ? (
                  <span className="text-brand-gold-ink">Under 18 — bracket and role auto-set to High School / School Student.</span>
                ) : undefined}
              >
                <Input
                  type="date"
                  autoComplete="off"
                  value={form.date_of_birth}
                  onChange={(e) => handleDobChange(e.target.value)}
                />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Select…</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>{label(g)}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Discord handle">
                <Input
                  type="text"
                  autoComplete="off"
                  value={form.discord_handle}
                  onChange={(e) => set('discord_handle', e.target.value)}
                />
              </Field>
              <Field label="T-shirt size">
                <Select value={form.tshirt_size} onChange={(e) => set('tshirt_size', e.target.value)}>
                  <option value="">Select…</option>
                  {T_SHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* Classification */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Classification</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Age bracket">
                <Select
                  value={form.age_bracket}
                  onChange={(e) => handleBracketChange(e.target.value)}
                  disabled={isMinor}
                >
                  {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
                </Select>
              </Field>
              <Field label="Event role" hint={eligibleRoles.length <= 1 ? 'Auto-set by age bracket' : undefined}>
                <Select
                  value={form.event_role}
                  onChange={(e) => set('event_role', e.target.value)}
                  disabled={eligibleRoles.length <= 1}
                >
                  {eligibleRoles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </Select>
              </Field>
              {showGrade && (
                <Field label="Grade / Year">
                  <Select value={form.grade} onChange={(e) => set('grade', e.target.value)}>
                    <option value="">Select…</option>
                    {GRADES.filter((g) =>
                      form.age_bracket === 'high_school'
                        ? g.value.startsWith('grade_')
                        : !g.value.startsWith('grade_')
                    ).map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </div>

          {/* School */}
          {(form.age_bracket === 'high_school' || form.age_bracket === 'college') && (
            <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
              <h2 className="text-base font-semibold text-brand-blue-dark">School</h2>
              <Field label="School name">
                <SchoolSearchInput onChange={setSchoolSelection} />
              </Field>
            </div>
          )}

          {/* Emergency contact */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Emergency contact</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="First name">
                <Input type="text" autoComplete="off" value={form.ec_first_name} onChange={(e) => set('ec_first_name', e.target.value)} />
              </Field>
              <Field label="Last name">
                <Input type="text" autoComplete="off" value={form.ec_last_name} onChange={(e) => set('ec_last_name', e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" autoComplete="off" value={form.ec_email} onChange={(e) => set('ec_email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input type="tel" autoComplete="off" value={form.ec_phone} onChange={(e) => set('ec_phone', e.target.value)} />
              </Field>
              <Field label="Relationship to participant">
                <Select value={form.ec_relationship} onChange={(e) => set('ec_relationship', e.target.value)}>
                  <option value="">Select…</option>
                  {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </Field>
            </div>
          </div>

          {/* Ethnicity & dietary */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Ethnicity &amp; dietary</h2>
            <Fieldset legend="Ethnicity">
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {ETHNICITIES.map((opt) => (
                  <Choice
                    key={opt}
                    checked={form.ethnicity.includes(opt)}
                    onChange={() => toggleMulti('ethnicity', opt)}
                    label={opt}
                  />
                ))}
              </div>
            </Fieldset>
            <Fieldset legend="Dietary requirements">
              <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                {DIETARY_OPTIONS.map((opt) => (
                  <Choice
                    key={opt}
                    checked={form.dietary_requirements.includes(opt)}
                    onChange={() => toggleMulti('dietary_requirements', opt)}
                    label={opt}
                  />
                ))}
              </div>
            </Fieldset>
          </div>

        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-brand-border p-5">
            <h2 id={fid('tier-heading')} className="text-sm font-semibold text-brand-muted-soft mb-3">
              Membership tier
            </h2>
            <p className="text-xs text-brand-muted-soft mb-3">
              Assign an initial tier, or leave blank to set later.
            </p>
            {eligibleTiers.length > 0 ? (
              <div role="radiogroup" aria-labelledby={fid('tier-heading')}>
                <Choice
                  type="radio"
                  name="tier"
                  value=""
                  checked={form.tier_id === ''}
                  onChange={() => set('tier_id', '')}
                  label={<span className="text-brand-muted-soft">No tier yet</span>}
                />
                {eligibleTiers.map((t) => (
                  <Choice
                    key={t.id}
                    type="radio"
                    name="tier"
                    value={t.id}
                    checked={form.tier_id === t.id}
                    onChange={() => set('tier_id', t.id)}
                    label={t.name}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-brand-muted-soft">
                Set a classification first to see eligible tiers.
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-5 space-y-3">
            <h2 className="text-sm font-semibold text-brand-muted-soft">
              Invitation
            </h2>
            <Choice
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              label="Email them a link to complete their account"
            />
            <p className="text-xs text-brand-muted-soft">
              A login is set up for the email above. The link takes them to complete their
              profile — date of birth, gender and phone — before they can use the app. You can
              resend it from their member page.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
