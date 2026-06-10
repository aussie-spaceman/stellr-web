import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import Link from 'next/link'
import { Users } from 'lucide-react'

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
          <h1 className="text-2xl font-bold text-gray-900">Member Directory</h1>
          <p className="mt-1 text-sm text-gray-500">
            {rows.length} member{rows.length !== 1 ? 's' : ''} visible ·{' '}
            <Link href="/account" className="underline hover:text-gray-700">
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
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
        />
        {allStates.length > 0 && (
          <select
            name="state"
            defaultValue={state ?? ''}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
          >
            <option value="">All states / regions</option>
            {allStates.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        )}
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Filter
        </button>
        {(school || state) && (
          <Link
            href="/community/members"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center">
          <Users className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No members found.</p>
          <p className="mt-1 text-xs text-gray-400">
            Members must opt in from their account page to appear here.
          </p>
        </div>
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
              className="rounded-lg border border-gray-200 bg-white p-4"
            >
              <p className="font-semibold text-gray-900">{name}</p>
              {m.event_role && (
                <p className="mt-0.5 text-xs font-medium text-gray-500">
                  {formatRole(m.event_role)}
                </p>
              )}
              {(schoolName || region) && (
                <p className="mt-1.5 text-xs text-gray-400">
                  {[schoolName, region].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
