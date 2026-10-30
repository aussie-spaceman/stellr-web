// Filters, sorting and URL state for the admin members list (/admin/members).
//
// One home for "which members match", shared by the page and the CSV export so
// an export is exactly the list on screen. Every filter lives in the URL, which
// makes a filtered view something you can bookmark or send to a colleague.
//
// The Membership and School filters reach into to-many relations. They filter
// through a second, aliased embed (`tier_f`, `school_f`) so the embeds the table
// displays still carry every row: filtering the displayed embed directly would
// hide a member's other memberships and schools.

import { zonedTimeToUtc } from '@/lib/survey/timezone'

export const MEMBER_BRACKETS = ['high_school', 'college', 'adult'] as const
export const MEMBER_ROLES = [
  'participant', 'mentor', 'teacher', 'volunteer', 'adult', 'school_student_manager', 'parent', 'donor', 'subscriber',
] as const
export const MEMBER_SORTS = ['name', 'email', 'role', 'joined'] as const

/** The Membership filter's value for "no active membership". */
export const NO_TIER = 'none'

export type MemberSort = (typeof MEMBER_SORTS)[number]

export interface MemberFilters {
  /** Free-text search across name and email (the bar above the table). */
  q: string
  bracket: string
  role: string
  /** A membership_tiers.id, NO_TIER, or '' for any. */
  tier: string
  name: string
  email: string
  school: string
  /** YYYY-MM-DD, inclusive, in the app's time zone. */
  joinedFrom: string
  joinedTo: string
  sort: MemberSort
  dir: 'asc' | 'desc'
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  q: '', bracket: '', role: '', tier: '', name: '', email: '', school: '',
  joinedFrom: '', joinedTo: '', sort: 'name', dir: 'asc',
}

/** Keys that narrow the list, as opposed to ordering it. */
export const MEMBER_FILTER_KEYS = ['q', 'bracket', 'role', 'tier', 'name', 'email', 'school', 'joinedFrom', 'joinedTo'] as const

const APP_TIME_ZONE = 'America/Denver'
const YMD = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Text a person typed, made safe to put in a PostgREST filter: the `.or()`
 * syntax splits on commas and parentheses, and PostgREST reads * and % as
 * wildcards. `_` stays: it is common in email addresses, and as LIKE's
 * one-character wildcard it still matches itself.
 */
export function cleanFilterText(value: string | undefined | null): string {
  return (value ?? '').replace(/[%,()*\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

/** Read the filters from page search params, dropping anything malformed. */
export function parseMemberFilters(params: Record<string, string | string[] | undefined>): MemberFilters {
  const get = (k: string) => {
    const v = params[k]
    return (Array.isArray(v) ? v[0] : v) ?? ''
  }
  const pick = <T extends string>(v: string, allowed: readonly T[]): T | '' => ((allowed as readonly string[]).includes(v) ? (v as T) : '')
  const tier = get('tier')
  const sort = pick(get('sort'), MEMBER_SORTS) || 'name'
  return {
    q: cleanFilterText(get('q')),
    bracket: pick(get('bracket'), MEMBER_BRACKETS),
    role: pick(get('role'), MEMBER_ROLES),
    tier: tier === NO_TIER || UUID.test(tier) ? tier : '',
    name: cleanFilterText(get('name')),
    email: cleanFilterText(get('email')),
    school: cleanFilterText(get('school')),
    joinedFrom: YMD.test(get('joinedFrom')) ? get('joinedFrom') : '',
    joinedTo: YMD.test(get('joinedTo')) ? get('joinedTo') : '',
    sort,
    dir: get('dir') === 'desc' ? 'desc' : 'asc',
  }
}

/** Search params for a filter state: only non-default values, so URLs stay short. */
export function memberFilterParams(filters: MemberFilters, extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams()
  for (const key of MEMBER_FILTER_KEYS) {
    if (filters[key]) params.set(key, filters[key])
  }
  if (filters.sort !== 'name' || filters.dir !== 'asc') {
    params.set('sort', filters.sort)
    params.set('dir', filters.dir)
  }
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v)
  return params
}

/** How many narrowing filters are set (sorting doesn't count). */
export function activeMemberFilterCount(filters: MemberFilters): number {
  return MEMBER_FILTER_KEYS.filter((k) => filters[k]).length
}

/** Extra embeds the filters need, to append to a members select. */
export function memberFilterEmbeds(filters: MemberFilters): string {
  const embeds: string[] = []
  if (filters.tier === NO_TIER) embeds.push('tier_f:member_memberships(id)')
  else if (filters.tier) embeds.push('tier_f:member_memberships!inner(id)')
  if (filters.school) embeds.push('school_f:member_schools!inner(id, schools!inner(id))')
  return embeds.length ? `, ${embeds.join(', ')}` : ''
}

/** The UTC instant a YYYY-MM-DD day starts in the app's time zone. */
function dayStartIso(ymd: string): string {
  return zonedTimeToUtc(ymd, APP_TIME_ZONE).toISOString()
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

// The builder methods this module uses. Structural rather than the
// supabase-js generic so a test can pass a recording fake.
export interface FilterableQuery<Q> {
  or(filters: string): Q
  ilike(column: string, pattern: string): Q
  eq(column: string, value: unknown): Q
  is(column: string, value: null): Q
  gte(column: string, value: string): Q
  lt(column: string, value: string): Q
  order(column: string, opts: { ascending: boolean }): Q
}

/**
 * Apply the narrowing filters. The query must have been built with
 * memberFilterEmbeds(filters) in its select.
 */
export function applyMemberFilters<Q extends FilterableQuery<Q>>(query: Q, filters: MemberFilters): Q {
  let q = query
  if (filters.q) {
    q = q.or(`first_name.ilike.%${filters.q}%,last_name.ilike.%${filters.q}%,email.ilike.%${filters.q}%`)
  }
  // Every word must appear in the first or last name, so "ava ng" finds Ava Ng.
  for (const word of filters.name.split(' ').filter(Boolean)) {
    q = q.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`)
  }
  if (filters.email) q = q.ilike('email', `%${filters.email}%`)
  if (filters.bracket) q = q.eq('age_bracket', filters.bracket)
  if (filters.role) q = q.eq('event_role', filters.role)
  if (filters.tier === NO_TIER) {
    q = q.eq('tier_f.renewal_status', 'active').is('tier_f', null)
  } else if (filters.tier) {
    q = q.eq('tier_f.renewal_status', 'active').eq('tier_f.tier_id', filters.tier)
  }
  if (filters.school) {
    q = q.eq('school_f.is_current', true).ilike('school_f.schools.name', `%${filters.school}%`)
  }
  if (filters.joinedFrom) q = q.gte('created_at', dayStartIso(filters.joinedFrom))
  if (filters.joinedTo) q = q.lt('created_at', dayStartIso(nextDay(filters.joinedTo)))
  return q
}

/** Apply the sort, with a stable name tie-break. */
export function applyMemberSort<Q extends FilterableQuery<Q>>(query: Q, filters: MemberFilters): Q {
  const ascending = filters.dir === 'asc'
  const byName = (q: Q, asc: boolean) => q.order('last_name', { ascending: asc }).order('first_name', { ascending: asc })
  switch (filters.sort) {
    case 'email': return query.order('email', { ascending })
    case 'role': return byName(query.order('event_role', { ascending }), true)
    case 'joined': return byName(query.order('created_at', { ascending }), true)
    default: return byName(query, ascending)
  }
}
