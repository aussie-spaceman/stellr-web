import type { SupabaseClient } from '@supabase/supabase-js'

// Read-only: find the schools.id behind a school name shown in the admin
// portal, so the name can link to /admin/schools/[id] (components/admin/RecordLinks).
//
// Participants and registrations store the school as typed text, with no id.
// So, in order:
//   1. the member's current school (member_schools.is_current), when the row
//      has a member and that member has exactly one current school;
//   2. otherwise a school whose name matches the typed name exactly, ignoring
//      case and extra spaces, and only when exactly one school has that name;
//   3. otherwise null, and the name stays plain text. No link beats a wrong one.
//
// Never creates a school (lib/school-link.ts does that, at registration).

export interface SchoolRef {
  memberId?: string | null
  schoolName?: string | null
}

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

// An ilike pattern that matches the text literally: \, % and _ escaped.
const literalPattern = (name: string) => name.trim().replace(/\s+/g, ' ').replace(/[\\%_]/g, (c) => `\\${c}`)

// A value inside PostgREST's or=(...) list: double-quoted, with " and \ escaped.
const orValue = (v: string) => `"${v.replace(/[\\"]/g, (c) => `\\${c}`)}"`

const CHUNK = 40

/** Current school per member: memberId → schoolId, only where exactly one is current. */
export async function currentSchoolByMember(db: SupabaseClient, memberIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(memberIds.filter(Boolean))]
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('member_schools')
      .select('member_id, school_id')
      .eq('is_current', true)
      .in('member_id', ids.slice(i, i + 200))
    if (error) {
      console.error('[school-ids] member_schools lookup failed:', error.message)
      return out
    }
    const seen = new Map<string, Set<string>>()
    for (const r of (data ?? []) as { member_id: string; school_id: string }[]) {
      const s = seen.get(r.member_id) ?? new Set<string>()
      s.add(r.school_id)
      seen.set(r.member_id, s)
    }
    for (const [m, s] of seen) if (s.size === 1) out.set(m, [...s][0])
  }
  return out
}

/** Typed school name → schoolId, only where exactly one school has that name. */
export async function schoolIdsByName(db: SupabaseClient, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const wanted = [...new Map(names.filter((n) => n && n.trim()).map((n) => [normalize(n), n])).values()]
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const chunk = wanted.slice(i, i + CHUNK)
    const { data, error } = await db
      .from('schools')
      .select('id, name')
      .or(chunk.map((n) => `name.ilike.${orValue(literalPattern(n))}`).join(','))
    if (error) {
      console.error('[school-ids] schools lookup failed:', error.message)
      return out
    }
    const byName = new Map<string, string[]>()
    for (const r of (data ?? []) as { id: string; name: string | null }[]) {
      if (!r.name) continue
      const k = normalize(r.name)
      byName.set(k, [...(byName.get(k) ?? []), r.id])
    }
    for (const [k, list] of byName) if (list.length === 1) out.set(k, list[0])
  }
  return out
}

/**
 * The school id for each ref, in order (null where none can be found surely).
 * One member_schools query and one schools query per 40 names, whatever the length.
 */
export async function resolveSchoolIds(db: SupabaseClient, refs: SchoolRef[]): Promise<(string | null)[]> {
  if (refs.length === 0) return []
  const byMember = await currentSchoolByMember(db, refs.map((r) => r.memberId ?? '').filter(Boolean))
  const unresolvedNames = refs
    .filter((r) => !(r.memberId && byMember.has(r.memberId)) && r.schoolName)
    .map((r) => r.schoolName as string)
  const byName = unresolvedNames.length ? await schoolIdsByName(db, unresolvedNames) : new Map<string, string>()
  return refs.map((r) => {
    if (r.memberId) {
      const viaMember = byMember.get(r.memberId)
      if (viaMember) return viaMember
    }
    return r.schoolName ? (byName.get(normalize(r.schoolName)) ?? null) : null
  })
}
