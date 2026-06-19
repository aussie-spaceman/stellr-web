'use client'

import { useState } from 'react'
import { formatDateShort } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ROLES_FOR_BRACKET, DEFAULT_ROLE_FOR_BRACKET, getEligibleTierNames } from '@/lib/membership-rules'
import { EventHistory } from '@/components/member/EventHistory'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { MemberMembershipManager } from '@/components/admin/MemberMembershipManager'
import { MemberCompliancePanel, type MemberCompliance } from '@/components/admin/MemberCompliancePanel'
import { ActivityTimeline, type ActivityItem } from '@/components/activity/ActivityTimeline'

interface Member {
  id: string
  member_code: string | null
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string | null
  date_of_birth: string
  gender: string
  age_bracket: string
  event_role: string
  grade: string | null
  grade_auto_promote: boolean
  tshirt_size: string | null
  discord_handle: string | null
  health_conditions: string | null
  is_active: boolean
  created_at: string
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
  member_memberships: Array<{
    id: string; renewal_status: string; started_at: string; expires_at: string | null
    is_complimentary: boolean; source: string | null; membership_tiers: { name: string }
  }>
  member_schools: Array<{ is_current: boolean; school_id: string; schools: { name: string; city: string | null; state: string | null } }>
  member_ethnicities: Array<{ ethnicity_option_id: string }>
  member_allergies: Array<{ allergy_option_id: string }>
  event_participations: Array<{
    id: string; event_year: number | null; event_location: string | null
    team_name: string | null; award: string | null
  }>
}

interface Tier { id: string; name: string }
interface School { id: string; name: string }
interface Option { id: string; name: string }
interface Registration {
  id: string
  event_title: string | null
  event_slug: string | null
  school_name: string | null
  status: string | null
  created_at: string
  registrant_role: string | null
  type: string | null
}

interface Props {
  member: Member
  tiers: Tier[]
  schools: School[]
  ethnicityOptions: Option[]
  allergyOptions: Option[]
  registrations: Registration[]
  /** The member's 7-digit Membership ID (from participants.membership_id). */
  membershipId: string | null
  /** First page of the member's activity log (newest first). */
  activity: ActivityItem[]
  /** Background-check / license compliance (PRD §13); null when not required. */
  compliance: MemberCompliance | null
}

const TIER_TOOLTIPS: Record<string, string> = {
  'Explorer': 'Free tier — public content, competition listings, and basic community access.',
  'Pathfinder': 'Paid tier ($60/yr) — full community access and event registration. Also awarded free for one year to event participants.',
  'Scholar': 'Award winner tier ($120/yr) — all Pathfinder benefits plus exclusive content. Awarded to competition winners.',
}

const REG_STATUS_TOOLTIPS: Record<string, string> = {
  confirmed: 'Registration confirmed by Stellr — cleared to participate.',
  pending: 'Registration received — awaiting Stellr confirmation.',
  withdrawn: 'Registration has been withdrawn and is no longer active.',
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
const BRACKETS = ['high_school','college','adult']

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AdminMemberDetail({ member, tiers, schools, ethnicityOptions, allergyOptions, registrations, membershipId, activity, compliance }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    first_name: member.first_name,
    last_name: member.last_name,
    email: member.email,
    phone: member.phone ?? '',
    age_bracket: member.age_bracket,
    event_role: member.event_role,
    grade: member.grade ?? '',
    grade_auto_promote: member.grade_auto_promote,
    tshirt_size: member.tshirt_size ?? '',
    discord_handle: member.discord_handle ?? '',
    health_conditions: member.health_conditions ?? '',
    ec_first_name: member.ec_first_name ?? '',
    ec_last_name: member.ec_last_name ?? '',
    ec_email: member.ec_email ?? '',
    ec_phone: member.ec_phone ?? '',
    ec_relationship: member.ec_relationship ?? '',
  })

  const [selectedEthnicities, setSelectedEthnicities] = useState<string[]>(
    member.member_ethnicities?.map((e) => e.ethnicity_option_id) ?? []
  )
  const [selectedAllergies, setSelectedAllergies] = useState<string[]>(
    member.member_allergies?.map((a) => a.allergy_option_id) ?? []
  )

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleBracketChange(bracket: string) {
    const defaultRole = DEFAULT_ROLE_FOR_BRACKET[bracket] ?? ''
    setForm((f) => ({ ...f, age_bracket: bracket, event_role: defaultRole }))
  }

  function toggleOption(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  const eligibleRoles = ROLES_FOR_BRACKET[form.age_bracket] ?? []
  const eligibleTierNames = getEligibleTierNames(form.age_bracket, form.event_role)
  const showGrade = form.age_bracket === 'high_school' || form.age_bracket === 'college'

  async function handleSave() {
    setSaving(true)
    setError('')
    const res = await fetch(`/api/admin/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        ethnicity_ids: selectedEthnicities,
        allergy_ids: selectedAllergies,
      }),
    })
    setSaving(false)
    if (!res.ok) {
      setError('Save failed. Please try again.')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      router.refresh()
    }
  }

  async function handleDeactivate() {
    const res = await fetch(`/api/admin/members/${member.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/admin')
  }

  const activeMembership = member.member_memberships?.find((m) => m.renewal_status === 'active')
  const currentSchool = member.member_schools?.find((s) => s.is_current)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-brand-muted-soft hover:text-brand-muted mb-1 inline-block">
            ← All members
          </Link>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">
            {member.first_name} {member.last_name}
          </h1>
          {member.member_code && (
            <p className="text-sm text-brand-muted-soft mt-0.5">{member.member_code}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Link
            href={`/admin/members/${member.id}/view-as`}
            className="border border-brand-border text-brand-muted px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-canvas"
          >
            View as member
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="border border-red-200 text-red-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50"
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={handleDeactivate}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Confirm deactivate
            </button>
          )}
          <DeleteEntityButton
            entity="member"
            id={member.id}
            name={`${member.first_name} ${member.last_name}`}
            redirectTo="/admin/members"
            className="border border-red-300 text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-50"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Identity */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Identity</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'First name', field: 'first_name' },
                { label: 'Last name', field: 'last_name' },
                { label: 'Email', field: 'email' },
                { label: 'Phone', field: 'phone' },
                { label: 'Discord handle', field: 'discord_handle' },
                { label: 'T-shirt size', field: 'tshirt_size' },
              ].map(({ label: lbl, field }) => (
                <div key={field}>
                  <label className="block text-xs text-brand-muted-soft mb-1">{lbl}</label>
                  <input
                    type="text"
                    value={(form as Record<string, unknown>)[field] as string}
                    onChange={(e) => set(field, e.target.value)}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Classification */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Classification</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">Age bracket</label>
                <select
                  value={form.age_bracket}
                  onChange={(e) => handleBracketChange(e.target.value)}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">Event role</label>
                <select
                  value={form.event_role}
                  onChange={(e) => set('event_role', e.target.value)}
                  disabled={eligibleRoles.length <= 1}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:bg-brand-canvas disabled:text-brand-muted-soft"
                >
                  {eligibleRoles.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
                {eligibleRoles.length <= 1 && (
                  <p className="text-xs text-brand-muted-soft mt-1">Auto-set by age bracket</p>
                )}
              </div>
              {showGrade && (
                <div>
                  <label className="block text-xs text-brand-muted-soft mb-1">Grade / Year</label>
                  <select
                    value={form.grade}
                    onChange={(e) => set('grade', e.target.value)}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
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
              <div className={`flex items-center gap-2 ${showGrade ? 'pt-5' : 'pt-1'}`}>
                <input
                  type="checkbox"
                  id="auto_promote"
                  checked={form.grade_auto_promote}
                  onChange={(e) => set('grade_auto_promote', e.target.checked)}
                  className="rounded border-brand-border"
                />
                <label htmlFor="auto_promote" className="text-sm text-brand-muted">
                  Auto-promote grade annually
                </label>
              </div>
            </div>

            {/* Eligible membership tiers for this bracket/role */}
            {eligibleTierNames.length > 0 && (
              <div className="pt-2 border-t border-brand-hairline">
                <p className="text-xs text-brand-muted-soft mb-1.5">Eligible membership tiers for this classification:</p>
                <div className="flex flex-wrap gap-1.5">
                  {eligibleTierNames.map((name) => {
                    const isActive = activeMembership?.membership_tiers.name === name
                    return (
                      <span
                        key={name}
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          isActive
                            ? 'bg-brand-blue/10 text-brand-blue ring-1 ring-brand-blue'
                            : 'bg-brand-hairline text-brand-muted'
                        }`}
                        title={
                          isActive
                            ? `Currently active tier. ${TIER_TOOLTIPS[name] ?? ''}`
                            : `Eligible for this classification. ${TIER_TOOLTIPS[name] ?? ''}`
                        }
                      >
                        {name}{isActive ? ' ✓' : ''}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Ethnicity & Allergies */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-5">
            <h2 className="text-base font-semibold text-brand-blue-dark">Ethnicity & Dietary</h2>

            {ethnicityOptions.length > 0 && (
              <div>
                <label className="block text-xs text-brand-muted-soft mb-2">
                  Ethnicity <span className="text-brand-muted-soft">(select all that apply)</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {ethnicityOptions.map((opt) => (
                    <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedEthnicities.includes(opt.id)}
                        onChange={() => toggleOption(selectedEthnicities, setSelectedEthnicities, opt.id)}
                        className="rounded border-brand-border text-brand-blue focus:ring-brand-blue"
                      />
                      {opt.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {allergyOptions.length > 0 && (
              <div>
                <label className="block text-xs text-brand-muted-soft mb-2">
                  Dietary requirements / Allergies <span className="text-brand-muted-soft">(select all that apply)</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {allergyOptions.map((opt) => (
                    <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAllergies.includes(opt.id)}
                        onChange={() => toggleOption(selectedAllergies, setSelectedAllergies, opt.id)}
                        className="rounded border-brand-border text-brand-blue focus:ring-brand-blue"
                      />
                      {opt.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Emergency contact */}
          <div className="bg-white rounded-xl border border-brand-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-brand-blue-dark">Emergency contact</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'First name', field: 'ec_first_name' },
                { label: 'Last name', field: 'ec_last_name' },
                { label: 'Email', field: 'ec_email' },
                { label: 'Phone', field: 'ec_phone' },
              ].map(({ label: lbl, field }) => (
                <div key={field}>
                  <label className="block text-xs text-brand-muted-soft mb-1">{lbl}</label>
                  <input
                    type="text"
                    value={(form as Record<string, unknown>)[field] as string}
                    onChange={(e) => set(field, e.target.value)}
                    className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs text-brand-muted-soft mb-1">Relationship to participant</label>
                <select
                  value={form.ec_relationship}
                  onChange={(e) => set('ec_relationship', e.target.value)}
                  className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
                >
                  <option value="">Select…</option>
                  {['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher'].map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Event Activity */}
          <EventHistory
            participations={member.event_participations ?? []}
            editable
            adminMemberId={member.id}
          />

          {/* Group registrations (teacher / student manager) */}
          {registrations.length > 0 && (
            <div className="bg-white rounded-xl border border-brand-border p-6">
              <h2 className="text-base font-semibold text-brand-blue-dark mb-4">Group Registrations (Organiser)</h2>
              <div className="space-y-3">
                {registrations.map((reg) => (
                  <div key={reg.id} className="flex items-start justify-between py-3 border-b border-brand-hairline last:border-0">
                    <div>
                      <p className="text-sm font-medium text-brand-blue-dark">{reg.event_title ?? reg.event_slug ?? '—'}</p>
                      {reg.school_name && (
                        <p className="text-xs text-brand-muted-soft mt-0.5">{reg.school_name}</p>
                      )}
                      {reg.registrant_role && (
                        <p className="text-xs text-brand-muted-soft mt-0.5 capitalize">{reg.registrant_role.replace(/_/g, ' ')}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                          reg.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                          reg.status === 'withdrawn' ? 'bg-red-100 text-red-600' :
                          'bg-yellow-100 text-yellow-700'
                        }`}
                        title={REG_STATUS_TOOLTIPS[reg.status ?? 'pending'] ?? reg.status ?? 'pending'}
                      >
                        {reg.status ?? 'pending'}
                      </span>
                      <p className="text-xs text-brand-muted-soft mt-1">
                        {formatDateShort(reg.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Activity log — the full audit trail for this member (shared with the member) */}
          <div className="bg-white rounded-xl border border-brand-border p-6">
            <h2 className="text-base font-semibold text-brand-blue-dark mb-1">Activity log</h2>
            <p className="text-xs text-brand-muted-soft mb-4">
              Every change recorded against this profile. The member sees this same history in their account.
            </p>
            <ActivityTimeline items={activity} fetchUrl={`/api/admin/members/${member.id}/activity`} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <MemberMembershipManager
            memberId={member.id}
            membershipId={membershipId}
            tiers={tiers}
            memberships={member.member_memberships ?? []}
          />

          <MemberCompliancePanel memberId={member.id} compliance={compliance} />

          <div className="bg-white rounded-xl border border-brand-border p-5">
            <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide mb-3">
              School
            </h2>
            {currentSchool ? (
              <div className="text-sm">
                <Link
                  href={`/admin/schools/${currentSchool.school_id}`}
                  className="font-medium text-brand-blue hover:text-brand-blue"
                >
                  {currentSchool.schools.name}
                </Link>
                {(currentSchool.schools.city || currentSchool.schools.state) && (
                  <p className="text-brand-muted-soft mt-0.5">
                    {[currentSchool.schools.city, currentSchool.schools.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-brand-muted-soft">No school linked.</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-brand-border p-5">
            <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide mb-3">
              Account
            </h2>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-brand-muted-soft">Status</dt>
                <dd className={member.is_active ? 'text-green-600 font-medium' : 'text-red-500'}>
                  {member.is_active ? 'Active' : 'Deactivated'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-brand-muted-soft">Joined</dt>
                <dd className="text-brand-blue-dark">
                  {formatDateShort(member.created_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
