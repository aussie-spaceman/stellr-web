'use client'

import { useState } from 'react'
import Image from 'next/image'

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
  health_conditions: string | null
  member_schools: Array<{ is_current: boolean; schools: { name: string } }>
}

interface ClerkUser {
  imageUrl: string | null
}

interface Props {
  member: Member
  clerkUser: ClerkUser | null
}

function formatGrade(grade: string | null) {
  if (!grade) return '—'
  return grade
    .replace('grade_', 'Grade ')
    .replace('college_', 'College ')
    .replace('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AccountProfile({ member, clerkUser }: Props) {
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [discord, setDiscord] = useState(member.discord_handle ?? '')

  const currentSchool = member.member_schools?.find((s) => s.is_current)

  async function handleSave() {
    setLoading(true)
    await fetch('/api/members/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, discord_handle: discord }),
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

      <div className="space-y-4 border-t border-gray-100 pt-4">
        <h3 className="text-sm font-medium text-gray-700">Editable details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Discord handle</label>
            <input
              type="text"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
