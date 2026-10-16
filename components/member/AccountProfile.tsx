'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Choice, Field, Fieldset, Input, Select, Textarea } from '@stellr/web-ui'
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
  // deep review MEM-16: the save used to show "Saved ✓" unconditionally, even when
  // the PATCH failed (e.g. a rejected option set wiped nothing but saved nothing).
  // Track the failure so the member isn't told a lost save succeeded.
  const [saveError, setSaveError] = useState(false)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [discord, setDiscord] = useState(member.discord_handle ?? '')
  const [nickname, setNickname] = useState(member.nickname ?? '')
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
    setSaveError(false)
    // MEM-16: only report success when the server actually accepted the save.
    let ok = false
    try {
      const res = await fetch('/api/members/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          nickname: nickname || null,
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
      ok = res.ok
    } catch {
      ok = false
    }
    setLoading(false)
    if (ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      setSaveError(true)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 sm:p-6">
      <div className="flex items-center gap-4 mb-6">
        {(clerkUser?.imageUrl || member.profile_photo_url) && (
          <Image
            src={clerkUser?.imageUrl ?? member.profile_photo_url!}
            alt={member.first_name}
            width={56}
            height={56}
            className="shrink-0 rounded-full object-cover"
          />
        )}
        {/* min-w-0 + anywhere-wrapping: an email has no break points and
            pushed /account sideways on a 320px phone. */}
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <h2 className="text-lg font-semibold text-brand-blue-dark">
            {member.first_name} {member.last_name}
            {member.nickname && (
              <span className="ml-2 text-sm text-brand-muted-soft">"{member.nickname}"</span>
            )}
          </h2>
          <p className="text-sm text-brand-muted-soft">{member.email}</p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm mb-6 min-[400px]:grid-cols-2">
        <div>
          <dt className="text-brand-muted-soft">Role</dt>
          <dd className="font-medium text-brand-blue-dark capitalize">
            {member.event_role.replace('_', ' ')}
          </dd>
        </div>
        <div>
          <dt className="text-brand-muted-soft">Age bracket</dt>
          <dd className="font-medium text-brand-blue-dark capitalize">
            {member.age_bracket.replace('_', ' ')}
          </dd>
        </div>
        {member.grade && (
          <div>
            <dt className="text-brand-muted-soft">Grade</dt>
            <dd className="font-medium text-brand-blue-dark">{formatGrade(member.grade)}</dd>
          </div>
        )}
        {currentSchool && (
          <div>
            <dt className="text-brand-muted-soft">School</dt>
            <dd className="font-medium text-brand-blue-dark">{currentSchool.schools.name}</dd>
          </div>
        )}
      </dl>

      <div className="space-y-5 border-t border-brand-hairline pt-5">
        <h3 className="text-sm font-medium text-brand-muted">Editable details</h3>

        {/* The member's own details: autocomplete tokens let the browser fill them (WCAG 1.3.5). */}
        <Field label="Nickname">
          <Input
            type="text"
            autoComplete="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="What you'd like to be called"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Phone">
            <Input
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Discord handle">
            <Input
              type="text"
              autoComplete="off"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
            />
          </Field>
        </div>

        {/* Ethnicity */}
        {ethnicityOptions.length > 0 && (
          <Fieldset legend={<>Ethnicity <span className="text-content-muted">(select all that apply)</span></>}>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {ethnicityOptions.map((opt) => (
                <Choice
                  key={opt.id}
                  checked={selectedEthnicities.includes(opt.id)}
                  onChange={() => toggleOption(selectedEthnicities, setSelectedEthnicities, opt.id)}
                  label={opt.name}
                />
              ))}
            </div>
          </Fieldset>
        )}

        {/* Allergies / Dietary */}
        {allergyOptions.length > 0 && (
          <Fieldset
            legend={<>Dietary requirements / Allergies <span className="text-content-muted">(select all that apply)</span></>}
          >
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {allergyOptions.map((opt) => (
                <Choice
                  key={opt.id}
                  checked={selectedAllergies.includes(opt.id)}
                  onChange={() => toggleOption(selectedAllergies, setSelectedAllergies, opt.id)}
                  label={opt.name}
                />
              ))}
            </div>
          </Fieldset>
        )}

        {/* Emergency contact — captured at registration, shown/editable here.
            Someone else's details, so no autofill of the member's own. */}
        <div className="border-t border-brand-hairline pt-5 space-y-4">
          <h3 className="text-sm font-medium text-brand-muted">Emergency contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First name">
              <Input type="text" autoComplete="off" value={ecFirst} onChange={(e) => setEcFirst(e.target.value)} />
            </Field>
            <Field label="Last name">
              <Input type="text" autoComplete="off" value={ecLast} onChange={(e) => setEcLast(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" autoComplete="off" value={ecEmail} onChange={(e) => setEcEmail(e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" autoComplete="off" value={ecPhone} onChange={(e) => setEcPhone(e.target.value)} />
            </Field>
            <Field label="Relationship to you">
              <Select value={ecRelationship} onChange={(e) => setEcRelationship(e.target.value)}>
                <option value="">Select…</option>
                {/* Keep a legacy/free-text value selectable even if it's not a current option */}
                {(EMERGENCY_RELATIONSHIPS.includes(ecRelationship) || !ecRelationship
                  ? EMERGENCY_RELATIONSHIPS
                  : [ecRelationship, ...EMERGENCY_RELATIONSHIPS]
                ).map((rel) => (
                  <option key={rel} value={rel}>{rel}</option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        {/* Health conditions — captured at registration, shown/editable here */}
        <Field label="Health conditions">
          <Textarea
            value={healthConditions}
            onChange={(e) => setHealthConditions(e.target.value)}
            rows={2}
          />
        </Field>

        {!readOnly && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={loading}
              className="bg-brand-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {loading ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
            </button>
            {saveError && (
              <p role="alert" className="text-sm text-danger">
                Couldn&rsquo;t save your changes. Please try again.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
