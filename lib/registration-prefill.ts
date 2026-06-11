import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, type CommunityMember } from '@/lib/community'

// Update #2 — "recognize log in for registration".
// When a signed-in member starts a registration, pre-fill what we already know
// so we don't ask for it again. The richest source is the member's most recent
// `participants` row (it stores the form's display-string values + event-only
// fields like emergency contact); we fall back to the `members` row for the
// basics. `email` is always the authenticated session email and is locked on
// the form (Option A — a logged-in user can't register under another address).

export interface RegistrationPrefill {
  memberId: string
  /** Authenticated session email — authoritative, rendered read-only. */
  email: string
  first_name?: string
  last_name?: string
  nickname?: string
  phone?: string
  date_of_birth?: string
  grade?: string
  gender?: string
  t_shirt_size?: string
  ethnicity?: string[]
  dietary_requirements?: string[]
  health_conditions?: string
  emergency_contact_first_name?: string
  emergency_contact_last_name?: string
  emergency_contact_email?: string
  emergency_contact_phone?: string
  emergency_contact_relationship?: string
  school_name?: string
}

/**
 * Resolve a prefill payload for the currently signed-in member, or null when
 * unauthenticated / no member record. Safe to call from public (www)
 * registration pages — returns null (and the form behaves exactly as before)
 * whenever the Clerk session doesn't resolve.
 */
export async function getRegistrationPrefill(
  member?: CommunityMember | null
): Promise<RegistrationPrefill | null> {
  const m = member ?? (await getCurrentMember())
  if (!m || !m.email) return null

  const db = supabaseServer()
  const { data: last } = await db
    .from('participants')
    .select(
      `first_name, last_name, nickname, phone, date_of_birth, grade, gender,
       t_shirt_size, ethnicity, dietary_requirements, health_conditions,
       school_name, emergency_contact_first_name, emergency_contact_last_name,
       emergency_contact_email, emergency_contact_phone, emergency_contact_relationship`
    )
    .eq('member_id', m.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const p = (last ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const arr = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as string[]) : undefined)

  return {
    memberId: m.id,
    email: m.email,
    first_name: str(p.first_name) ?? m.first_name ?? undefined,
    last_name: str(p.last_name) ?? m.last_name ?? undefined,
    nickname: str(p.nickname),
    phone: str(p.phone),
    date_of_birth: str(p.date_of_birth),
    grade: str(p.grade),
    gender: str(p.gender),
    t_shirt_size: str(p.t_shirt_size),
    ethnicity: arr(p.ethnicity),
    dietary_requirements: arr(p.dietary_requirements),
    health_conditions: str(p.health_conditions),
    emergency_contact_first_name: str(p.emergency_contact_first_name),
    emergency_contact_last_name: str(p.emergency_contact_last_name),
    emergency_contact_email: str(p.emergency_contact_email),
    emergency_contact_phone: str(p.emergency_contact_phone),
    emergency_contact_relationship: str(p.emergency_contact_relationship),
    school_name: str(p.school_name),
  }
}
