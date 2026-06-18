import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Community · Member Directory' }

interface DirectoryMember {
  member_id: string
  show_school: boolean
  show_region: boolean
  members: {
    first_name: string | null
    last_name: string | null
    age_bracket: string | null
    event_role: string | null
    school_address_state: string | null
    member_schools: Array<{ is_current: boolean; schools: { name: string } }>
  } | Array<{
    first_name: string | null
    last_name: string | null
    age_bracket: string | null
    event_role: string | null
    school_address_state: string | null
    member_schools: Array<{ is_current: boolean; schools: { name: string } }>
  }> | null
}

function getMember(rel: DirectoryMember['members']) {
  return Array.isArray(rel) ? rel[0] : rel
}

function formatRole(role: string | null): string {
  if (!role) return ''
  return role
    .replace('school_student_manager', 'Student Manager')
    .replace('school_student', 'Student')
    .replace('teacher', 'Teacher / Educator')
    .replace('mentor', 'Mentor')
    .replace('parent', 'Parent / Guardian')
}

// Member directory (FR-COM-04): opt-in only, filtered by school or state.
export default async function MemberDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ school?: string; state?: string }>
}) {
  const viewer = await getCurrentMember()
  if (!viewer) redirect('/sign-up')

  const { school, state } = await searchParams
  const db = supabaseServer()

  // Build query — only members who opted in and whose member record is active.
  let query = db
    .from('member_directory_prefs')
    .select(`
      member_id,
      show_school,
      show_region,
      members!inner(
        first_name, last_name, age_bracket, event_role, school_address_state,
        member_schools(is_current, schools(name))
      )
    `)
    .eq('is_visible', true)

  const { data: entries } = await query

  // Apply school/state filters in-memory (dataset small enough; avoids complex join filters).
  let rows = (entries ?? []) as unknown as DirectoryMember[]

  if (school) {
    rows = rows.filter((e) => {
      const m = getMember(e.members)
      const current = m?.member_schools?.find((s) => s.is_current)
      return current?.schools?.name?.toLowerCase().includes(school.toLowerCase())
    })
  }
  if (state) {
    rows = rows.filter((e) => {
      const m = getMember(e.members)
      return m?.school_address_state?.toLowerCase() === state.toLowerCase()
    })
  }

  // Collect distinct states for the filter dropdown.
  const allStates = [
    ...new Set(
      (entries ?? [])
        .map((e) => getMember((e as unknown as DirectoryMember).members)?.school_address_state)
        .filter((s): s is string => Boolean(s))
        .sort()
    ),
  ]

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Member Directory</h1>
          <p className="mt-1 text-sm text-brand-muted-soft">
            {rows.length} member{rows.length !== 1 ? 's' : ''} visible ·{' '}
            <Link href="/account" className="underline hover:text-brand-muted">
              manage your visibility
            </Link>
          </p>
        </div>
      </div>

      {/* Filters */}
      <form method="GET" className="mb-5 flex flex-wrap gap-3">
        <input
          name="school"
          defaultValue={school ?? ''}
          placeholder="Filter by school…"
          className="input-field sm:w-64"
        />
        {allStates.length > 0 && (
          <select name="state" defaultValue={state ?? ''} className="input-field sm:w-56">
            <option value="">All states / regions</option>
            {allStates.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <button type="submit" className="btn-primary px-4 py-2">
          Filter
        </button>
        {(school || state) && (
          <Link
            href="/community/members"
            className="rounded-md border border-brand-border px-3 py-1.5 text-sm text-brand-muted hover:bg-brand-canvas"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 && (
        <EmptyState
          title="No members found."
          hint="Members must opt in from their account page to appear here."
        />
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((entry) => {
          const m = getMember(entry.members)
          if (!m) return null
          const name = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
          const currentSchool = m.member_schools?.find((s) => s.is_current)
          const schoolName = entry.show_school ? currentSchool?.schools?.name : null
          const region = entry.show_region ? m.school_address_state : null

          return (
            <li
              key={entry.member_id}
              className="app-card flex gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <Avatar id={entry.member_id} name={name} size="lg" ring={false} />
              <div className="min-w-0">
                <p className="font-subheading font-semibold text-brand-blue-dark">{name}</p>
                {m.event_role && (
                  <span className="mt-1 inline-block rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-subheading font-semibold text-brand-blue">
                    {formatRole(m.event_role)}
                  </span>
                )}
                {(schoolName || region) && (
                  <p className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-brand-muted-soft">
                    {schoolName && (
                      <span className="rounded-full bg-brand-hairline px-2 py-0.5">{schoolName}</span>
                    )}
                    {region && (
                      <span className="rounded-full bg-brand-hairline px-2 py-0.5">{region}</span>
                    )}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
