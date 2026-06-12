'use client'

import { useState } from 'react'
import Image from 'next/image'
import { EMERGENCY_RELATIONSHIPS } from '@/lib/registration-constants'

interface Member {
  id: string
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string | null
  discord_handle: string | null
  date_of_birth: string
  gender: string
  grade: string | null
  tshirt_size: string | null
  age_bracket: string
  event_role: string
  profile_photo_url: string | null
  ec_first_name: string | null
  ec_last_name: string | null
  ec_email: string | null
  ec_phone: string | null
  ec_relationship: string | null
  health_conditions: string | null
  member_schools: Array<{ is_current: boolean; schools: { name: string } }>
  member_ethnicities: Array<{ ethnicity_option_id: string }>
  member_allergies: Array<{ allergy_option_id: string }>
}

interface Option { id: string; name: string }

interface ClerkUser {
  imageUrl: string | null
}

interface Props {
  member: Member
  clerkUser: ClerkUser | null
  ethnicityOptions: Option[]
  allergyOptions: Option[]
  readOnly?: boolean
}

function formatGrade(grade: string | null) {
  if (!grade) return '—'
  return grade
    .replace('grade_', 'Grade ')
    .replace('college_', 'College ')
    .replace('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AccountProfile({ member, clerkUser, ethnicityOptions, allergyOptions, readOnly = false }: Props) {
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [discord, setDiscord] = useState(member.discord_handle ?? '')
  const [selectedEthnicities, setSelectedEthnicities] = useState<string[]>(
    member.member_ethnicities?.map((e) => e.ethnicity_option_id) ?? []
  )
  const [selectedAllergies, setSelectedAllergies] = useState<string[]>(
    member.member_allergies?.map((a) => a.allergy_option_id) ?? []
  )
  const [ecFirst, setEcFirst] = useState(member.ec_first_name ?? '')
  const [ecLast, setEcLast] = useState(member.ec_last_name ?? '')
  const [ecEmail, setEcEmail] = useState(member.ec_email ?? '')
  const [ecPhone, setEcPhone] = useState(member.ec_phone ?? '')
  const [ecRelationship, setEcRelationship] = useState(member.ec_relationship ?? '')
  const [healthConditions, setHealthConditions] = useState(member.health_conditions ?? '')

  const currentSchool = member.member_schools?.find((s) => s.is_current)

  function toggleOption(list: string[], setList: (v: string[]) => void, id: string) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  }

  async function handleSave() {
    setLoading(true)
    await fetch('/api/members/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone,
        discord_handle: discord,
        ethnicity_ids: selectedEthnicities,
        allergy_ids: selectedAllergies,
        ec_first_name: ecFirst || null,
        ec_last_name: ecLast || null,
        ec_email: ecEmail || null,
        ec_phone: ecPhone || null,
        ec_relationship: ecRelationship || null,
        health_conditions: healthConditions || null,
      }),
    })
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-4 mb-6">
        {(clerkUser?.imageUrl || member.profile_photo_url) && (
          <Image
            src={clerkUser?.imageUrl ?? member.profile_photo_url!}
            alt={member.first_name}
            width={56}
            height={56}
            className="rounded-full object-cover"
          />
        )}
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {member.first_name} {member.last_name}
            {member.nickname && (
              <span className="ml-2 text-sm text-gray-400">"{member.nickname}"</span>
            )}
          </h2>
          <p className="text-sm text-gray-500">{member.email}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm mb-6">
        <div>
          <dt className="text-gray-500">Role</dt>
          <dd className="font-medium text-gray-900 capitalize">
            {member.event_role.replace('_', ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-gray-500">Age bracket</dt>
          <dd className="font-medium text-gray-900 capitalize">
            {member.age_bracket.replace('_', ' ')}
          </dd>
        </div>
        {member.grade && (
          <div>
            <dt className="text-gray-500">Grade</dt>
            <dd className="font-medium text-gray-900">{formatGrade(member.grade)}</dd>
          </div>
        )}
        {currentSchool && (
          <div>
            <dt className="text-gray-500">School</dt>
            <dd className="font-medium text-gray-900">{currentSchool.schools.name}</dd>
          </div>
        )}
      </dl>

      <div className="space-y-5 border-t border-gray-100 pt-5">
        <h3 className="text-sm font-medium text-gray-700">Editable details</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Discord handle</label>
            <input
              type="text"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
          </div>
        </div>

        {/* Ethnicity */}
        {ethnicityOptions.length > 0 && (
          <div>
            <label className="block text-xs text-gray-500 mb-2">
              Ethnicity <span className="text-gray-400">(select all that apply)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {ethnicityOptions.map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEthnicities.includes(opt.id)}
                    onChange={() => toggleOption(selectedEthnicities, setSelectedEthnicities, opt.id)}
                    className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                  />
                  {opt.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Allergies / Dietary */}
        {allergyOptions.length > 0 && (
          <div>
            <label className="block text-xs text-gray-500 mb-2">
              Dietary requirements / Allergies <span className="text-gray-400">(select all that apply)</span>
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {allergyOptions.map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAllergies.includes(opt.id)}
                    onChange={() => toggleOption(selectedAllergies, setSelectedAllergies, opt.id)}
                    className="rounded border-gray-300 text-brand-blue focus:ring-brand-blue"
                  />
                  {opt.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Emergency contact — captured at registration, shown/editable here */}
        <div className="border-t border-gray-100 pt-5 space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Emergency contact</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First name</label>
              <input
                type="text"
                value={ecFirst}
                onChange={(e) => setEcFirst(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last name</label>
              <input
                type="text"
                value={ecLast}
                onChange={(e) => setEcLast(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={ecEmail}
                onChange={(e) => setEcEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input
                type="tel"
                value={ecPhone}
                onChange={(e) => setEcPhone(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Relationship to you</label>
              <select
                value={ecRelationship}
                onChange={(e) => setEcRelationship(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
              >
                <option value="">Select…</option>
                {/* Keep a legacy/free-text value selectable even if it's not a current option */}
                {(EMERGENCY_RELATIONSHIPS.includes(ecRelationship) || !ecRelationship
                  ? EMERGENCY_RELATIONSHIPS
                  : [ecRelationship, ...EMERGENCY_RELATIONSHIPS]
                ).map((rel) => (
                  <option key={rel} value={rel}>{rel}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Health conditions — captured at registration, shown/editable here */}
        <div>
          <label className="block text-xs text-gray-500 mb-1">Health conditions</label>
          <textarea
            value={healthConditions}
            onChange={(e) => setHealthConditions(e.target.value)}
            rows={2}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
        </div>

        {!readOnly && (
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-800 disabled:opacity-50"
          >
            {loading ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  )
}
