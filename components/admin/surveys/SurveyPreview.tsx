'use client'

import { useMemo, useState } from 'react'
import type { RespondentRole, SurveyDefinition } from '@/lib/survey/definition'
import type { RuntimeOptions } from '@/lib/survey/answers'
import { PROFILE_FIELDS, visiblePages, type AdultRelationship, type SurveyContext } from '@/lib/survey/branching'
import type { ClientView } from '@/lib/survey/access'
import { SurveyApp } from '@/components/survey/SurveyApp'

// The admin preview (/admin/surveys/questions/preview): the real respondent
// UI in preview mode, with the facts that branch the survey set by hand.
// Changing a fact restarts the preview.

const ROLE_LABEL: Record<RespondentRole, string> = { student: 'Student', mentor: 'Mentor', adult: 'Teacher or parent' }

export function SurveyPreview({ definition, runtimeOptions, initialRole }: { definition: SurveyDefinition; runtimeOptions: RuntimeOptions; initialRole: RespondentRole }) {
  const [role, setRole] = useState<RespondentRole>(initialRole)
  const [minor, setMinor] = useState(true)
  const [quotable, setQuotable] = useState(true)
  const [firstTime, setFirstTime] = useState(true)
  const [profileMissing, setProfileMissing] = useState(true)
  const [relationship, setRelationship] = useState<AdultRelationship | ''>('')

  const context: SurveyContext = useMemo(() => {
    const isMinor = role === 'student' && minor
    return {
      role,
      first_time: firstTime,
      is_minor: isMinor,
      quote_eligible_by_agreement: isMinor && quotable,
      adult_relationship: role === 'adult' && relationship ? relationship : null,
      profile_missing: profileMissing ? [...PROFILE_FIELDS] : [],
      event_title: 'Sample Space Design Challenge',
      event_slug: 'preview',
      event_year: new Date().getFullYear(),
      first_name: 'Alex',
    }
  }, [role, minor, quotable, firstTime, profileMissing, relationship])

  const view: ClientView = useMemo(
    () => ({
      state: 'open',
      role,
      context,
      definition,
      runtimeOptions,
      answers: {},
      currentPage: null,
      pages: visiblePages(definition, context, {}).map((p) => p.id),
      closesAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      timeZone: 'America/Denver',
      submittedAt: null,
    }),
    [role, context, definition, runtimeOptions],
  )

  return (
    <div className="space-y-4">
      <fieldset className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-xl border border-brand-border bg-white p-4 text-sm">
        <legend className="px-1 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Previewing as</legend>
        <label className="text-brand-muted">
          <span className="block text-xs">Respondent</span>
          <select value={role} onChange={(e) => setRole(e.target.value as RespondentRole)} className="mt-1 rounded-lg border border-brand-border bg-white px-2 py-1.5 text-ink">
            {(Object.keys(ROLE_LABEL) as RespondentRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        {role === 'student' && (
          <>
            <Check label="Under 18" checked={minor} onChange={setMinor} />
            {minor && <Check label="Agreement allows quoting" checked={quotable} onChange={setQuotable} />}
          </>
        )}
        {role === 'adult' && (
          <label className="text-brand-muted">
            <span className="block text-xs">Known from the invitation</span>
            <select value={relationship} onChange={(e) => setRelationship(e.target.value as AdultRelationship | '')} className="mt-1 rounded-lg border border-brand-border bg-white px-2 py-1.5 text-ink">
              <option value="">Not known (they’re asked)</option>
              <option value="teacher">Teacher</option>
              <option value="parent">Parent</option>
            </select>
          </label>
        )}
        <Check label="First Stellr event" checked={firstTime} onChange={setFirstTime} />
        <Check label="Profile missing gender, ethnicity, grade and school" checked={profileMissing} onChange={setProfileMissing} />
      </fieldset>
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <SurveyApp key={JSON.stringify(context)} apiBase="" view={view} signedIn preview />
      </div>
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}
