'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ROLES_FOR_BRACKET, DEFAULT_ROLE_FOR_BRACKET, getEligibleTierNames } from '@/lib/membership-rules'
import { SchoolSearchInput, SchoolSelection } from '@/components/member/SchoolSearchInput'

interface Tier { id: string; name: string }

interface Props {
  tiers: Tier[]
}

const GRADES = [
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
const TSHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL_plus']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function ageFromDob(dob: string): number | null {
  if (!dob) return null
  return new Date().getFullYear() - new Date(dob).getFullYear()
}

export function AdminAddMember({ tiers }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
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
      setForm((f) => ({ ...f, date_of_birth: dob, age_bracket: 'high_school', event_role: 'school_student', tier_id: '' }))
    } else {
      setForm((f) => ({ ...f, date_of_birth: dob }))
    }
  }

  const isMinor = form.date_of_birth ? (ageFromDob(form.date_of_birth) ?? 99) < 18 : false
  const eligibleRoles = isMinor ? ['school_student'] : (ROLES_FOR_BRACKET[form.age_bracket] ?? [])
  const eligibleTierNames = getEligibleTierNames(form.age_bracket, form.event_role)
  const eligibleTiers = tiers.filter((t) => eligibleTierNames.includes(t.name))
  const showGrade = form.age_bracket === 'high_school' || form.age_bracket === 'college'

  async function handleSubmit() {
    setError('')
    if (!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()) {
      setError('First name, last name, and email are required.')
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
      body: JSON.stringify({ ...form, ...schoolPayload }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Failed to create member.')
      return
    }
    const { member } = await res.json()
    router.push(`/admin/members/${member.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block">
            ← All members
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Add member</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manually create a member record. They can log in later using the email below.
          </p>
        </div>
        <button
          onClick={handleSubmit}
          disabled={saving}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? 'Creating…' : 'Create member'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* Identity */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Identity</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">First name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Last name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Preferred name / nickname</label>
                <input
                  type="text"
                  value={form.nickname}
                  onChange={(e) => set('nickname', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date of birth</label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => handleDobChange(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {isMinor && (
                  <p className="text-xs text-amber-600 mt-1">Under 18 — bracket and role auto-set to High School / School Student.</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Gender</label>
                <select
                  value={form.gender}
                  onChange={(e) => set('gender', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select…</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>{label(g)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Discord handle</label>
                <input
                  type="text"
                  value={form.discord_handle}
                  onChange={(e) => set('discord_handle', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">T-shirt size</label>
                <select
                  value={form.tshirt_size}
                  onChange={(e) => set('tshirt_size', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select…</option>
                  {TSHIRT_SIZES.map((s) => (
                    <option key={s} value={s}>{s.replace('_plus', '+')}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Classification */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Classification</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Age bracket</label>
                <select
                  value={form.age_bracket}
                  onChange={(e) => handleBracketChange(e.target.value)}
                  disabled={isMinor}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
                >
                  {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Event role</label>
                <select
                  value={form.event_role}
                  onChange={(e) => set('event_role', e.target.value)}
                  disabled={eligibleRoles.length <= 1}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50 disabled:text-gray-500"
                >
                  {eligibleRoles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
                {eligibleRoles.length <= 1 && (
                  <p className="text-xs text-gray-400 mt-1">Auto-set by age bracket</p>
                )}
              </div>
              {showGrade && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Grade / Year</label>
                  <select
                    value={form.grade}
                    onChange={(e) => set('grade', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select…</option>
                    {GRADES.filter((g) =>
                      form.age_bracket === 'high_school'
                        ? g.value.startsWith('grade_')
                        : !g.value.startsWith('grade_')
                    ).map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* School */}
          {(form.age_bracket === 'high_school' || form.age_bracket === 'college') && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <h2 className="text-base font-semibold text-gray-900">School</h2>
              <div>
                <label className="block text-xs text-gray-500 mb-1">School name</label>
                <SchoolSearchInput onChange={setSchoolSelection} />
              </div>
            </div>
          )}

          {/* Emergency contact */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Emergency contact</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'First name', field: 'ec_first_name' },
                { label: 'Last name', field: 'ec_last_name' },
                { label: 'Email', field: 'ec_email' },
                { label: 'Phone', field: 'ec_phone' },
              ].map(({ label: lbl, field }) => (
                <div key={field}>
                  <label className="block text-xs text-gray-500 mb-1">{lbl}</label>
                  <input
                    type="text"
                    value={(form as unknown as Record<string, string>)[field]}
                    onChange={(e) => set(field, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Relationship to participant</label>
                <select
                  value={form.ec_relationship}
                  onChange={(e) => set('ec_relationship', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select…</option>
                  {EMERGENCY_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Ethnicity & dietary */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Ethnicity &amp; dietary</h2>
            <div>
              <p className="block text-xs text-gray-500 mb-2">Ethnicity</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ETHNICITIES.map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={form.ethnicity.includes(opt)} onChange={() => toggleMulti('ethnicity', opt)} className="rounded" />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="block text-xs text-gray-500 mb-2">Dietary requirements</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {DIETARY_OPTIONS.map((opt) => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={form.dietary_requirements.includes(opt)} onChange={() => toggleMulti('dietary_requirements', opt)} className="rounded" />
                    <span className="text-sm">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Membership tier
            </h2>
            <p className="text-xs text-gray-400 mb-3">
              Assign an initial tier, or leave blank to set later.
            </p>
            {eligibleTiers.length > 0 ? (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="tier"
                    value=""
                    checked={form.tier_id === ''}
                    onChange={() => set('tier_id', '')}
                    className="text-indigo-600"
                  />
                  <span className="text-gray-500">No tier yet</span>
                </label>
                {eligibleTiers.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tier"
                      value={t.id}
                      checked={form.tier_id === t.id}
                      onChange={() => set('tier_id', t.id)}
                      className="text-indigo-600"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Set a classification first to see eligible tiers.
              </p>
            )}
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-700 space-y-1.5">
            <p className="font-medium">No Clerk account needed</p>
            <p>
              This member record will be created without a login. When the member signs up
              using the email above, their account will be linked automatically.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
