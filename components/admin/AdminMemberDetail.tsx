'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

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
  member_memberships: Array<{
    id: string; renewal_status: string; started_at: string; expires_at: string | null
    is_complimentary: boolean; membership_tiers: { name: string }
  }>
  member_schools: Array<{ is_current: boolean; schools: { name: string; city: string | null; state: string | null } }>
  event_participations: Array<{
    id: string; event_year: number | null; event_location: string | null
    team_name: string | null; award: string | null
  }>
}

interface Tier { id: string; name: string }
interface School { id: string; name: string }

interface Props { member: Member; tiers: Tier[]; schools: School[] }

const GRADES = ['grade_9','grade_10','grade_11','grade_12','college_freshman','college_sophomore','college_junior','college_senior','grad_phd']
const BRACKETS = ['high_school','college','adult']
const ROLES = ['school_student','mentor','teacher','donor','parent','subscriber']

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AdminMemberDetail({ member, tiers, schools }: Props) {
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
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const res = await fetch(`/api/admin/members/${member.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
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
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 mb-1 inline-block">
            ← All members
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">
            {member.first_name} {member.last_name}
          </h1>
          {member.member_code && (
            <p className="text-sm text-gray-400 mt-0.5">{member.member_code}</p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
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
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2">{error}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Identity */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Identity</h2>
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
                  <label className="block text-xs text-gray-500 mb-1">{lbl}</label>
                  <input
                    type="text"
                    value={(form as Record<string, unknown>)[field] as string}
                    onChange={(e) => set(field, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Membership classification */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Classification</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Age bracket</label>
                <select value={form.age_bracket} onChange={(e) => set('age_bracket', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Event role</label>
                <select value={form.event_role} onChange={(e) => set('event_role', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Grade</label>
                <select value={form.grade} onChange={(e) => set('grade', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                  <option value="">—</option>
                  {GRADES.map((g) => <option key={g} value={g}>{label(g)}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="auto_promote"
                  checked={form.grade_auto_promote}
                  onChange={(e) => set('grade_auto_promote', e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="auto_promote" className="text-sm text-gray-700">
                  Auto-promote grade annually
                </label>
              </div>
            </div>
          </div>

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
                    value={(form as Record<string, unknown>)[field] as string}
                    onChange={(e) => set(field, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Event history */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-4">Event history</h2>
            {member.event_participations.length === 0 ? (
              <p className="text-sm text-gray-500">No events recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="pb-2">Year</th>
                    <th className="pb-2">Location</th>
                    <th className="pb-2">Company</th>
                    <th className="pb-2">Award</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {member.event_participations.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">{p.event_year ?? '—'}</td>
                      <td className="py-2">{p.event_location ?? '—'}</td>
                      <td className="py-2">{p.team_name ?? '—'}</td>
                      <td className="py-2">{p.award ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Membership
            </h2>
            {activeMembership ? (
              <div className="space-y-2 text-sm">
                <div className="font-semibold text-gray-900 text-base">
                  {activeMembership.membership_tiers.name}
                </div>
                <div className="text-gray-500">
                  Since {new Date(activeMembership.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {activeMembership.expires_at && (
                  <div className="text-gray-500">
                    Expires {new Date(activeMembership.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
                {activeMembership.is_complimentary && (
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                    Complimentary
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No active membership.</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              School
            </h2>
            {currentSchool ? (
              <div className="text-sm">
                <p className="font-medium text-gray-900">{currentSchool.schools.name}</p>
                {(currentSchool.schools.city || currentSchool.schools.state) && (
                  <p className="text-gray-500">
                    {[currentSchool.schools.city, currentSchool.schools.state].filter(Boolean).join(', ')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No school linked.</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Account
            </h2>
            <dl className="text-sm space-y-1.5">
              <div className="flex justify-between">
                <dt className="text-gray-500">Status</dt>
                <dd className={member.is_active ? 'text-green-600 font-medium' : 'text-red-500'}>
                  {member.is_active ? 'Active' : 'Deactivated'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Joined</dt>
                <dd className="text-gray-900">
                  {new Date(member.created_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
