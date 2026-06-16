import { supabaseServer } from '@/lib/supabase'
import {
  SessionsManager,
  type AdminTier,
  type AdminHost,
  type AdminCohort,
  type AdminEntitlement,
} from '@/components/admin/community/SessionsManager'

export const metadata = { title: 'Admin — Coaching & Mentoring' }

function nameOf(rel: unknown): string | null {
  const m = Array.isArray(rel) ? rel[0] : rel
  const mm = m as { first_name?: string; last_name?: string } | null
  if (!mm) return null
  return [mm.first_name, mm.last_name].filter(Boolean).join(' ') || null
}

// Admin console for Coaching (FR-COM-12) + Mentoring (FR-COM-11): grant host
// permissions, manage cohorts, and configure sessions-per-tier.
export default async function AdminSessionsPage() {
  const db = supabaseServer()

  const [{ data: tiers }, { data: hostRows }, { data: cohortRows }, { data: ents }] = await Promise.all([
    db.from('membership_tiers').select('id, name').order('sort_order'),
    db.from('session_hosts').select('member_id, can_coach, can_mentor, members(first_name, last_name)'),
    db
      .from('mentoring_cohorts')
      .select('id, name, lifecycle, mentor:members!mentoring_cohorts_mentor_member_id_fkey(first_name, last_name), cohort_members(member_id)')
      .eq('is_active', true),
    db
      .from('session_entitlements')
      .select('tier_id, session_type, included_sessions, validity_days, extra_stripe_price_id'),
  ])

  const hosts: AdminHost[] = (hostRows ?? []).map((h) => ({
    member_id: h.member_id as string,
    name: nameOf(h.members) ?? 'Member',
    can_coach: h.can_coach as boolean,
    can_mentor: h.can_mentor as boolean,
  }))

  const cohorts: AdminCohort[] = (cohortRows ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    mentor_name: nameOf((c as { mentor?: unknown }).mentor),
    member_count: Array.isArray(c.cohort_members) ? c.cohort_members.length : 0,
    lifecycle: ((c as { lifecycle?: string }).lifecycle as 'active' | 'archived') ?? 'active',
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Coaching &amp; Mentoring</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Approve coaches and mentors, build cohorts, and set how many sessions each tier includes.
        </p>
      </div>

      <SessionsManager
        tiers={(tiers ?? []) as AdminTier[]}
        hosts={hosts}
        cohorts={cohorts}
        entitlements={(ents ?? []) as AdminEntitlement[]}
      />
    </div>
  )
}
