import { supabaseServer } from '@/lib/supabase'
import {
  SessionsManager,
  type AdminTier,
  type AdminHost,
  type AdminCohort,
  type AdminEntitlement,
  type AdminModule,
} from '@/components/admin/community/SessionsManager'
import { SessionCalendar } from '@/components/community/SessionCalendar'
import { AdminOversight } from '@/components/admin/community/AdminOversight'
import { CoachingGrant } from '@/components/admin/community/CoachingGrant'

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

  const [{ data: tiers }, { data: hostRows }, { data: cohortRows }, { data: ents }, { data: moduleRows }, { data: allSessions }] =
    await Promise.all([
      db.from('membership_tiers').select('id, name').order('sort_order'),
      db.from('session_hosts').select('member_id, can_coach, can_mentor, members!session_hosts_member_id_fkey(first_name, last_name)'),
      db
        .from('mentoring_cohorts')
        .select(
          'id, name, lifecycle, mentor:members!mentoring_cohorts_mentor_member_id_fkey(first_name, last_name), cohort_members(member_id, status), cohort_training_links(module_id, is_mandatory, due_at, training_modules(title))',
        )
        .eq('container_type', 'mentoring')
        .eq('lifecycle', 'active'),
      db
        .from('session_entitlements')
        .select('tier_id, session_type, included_sessions, validity_days, extra_stripe_price_id'),
      db.from('training_modules').select('id, title').eq('is_published', true).order('title'),
      db.from('sessions').select('id, title, scheduled_start, status').order('scheduled_start', { ascending: false }).limit(200),
    ])

  const hosts: AdminHost[] = (hostRows ?? []).map((h) => ({
    member_id: h.member_id as string,
    name: nameOf(h.members) ?? 'Member',
    can_coach: h.can_coach as boolean,
    can_mentor: h.can_mentor as boolean,
  }))

  type TrainingLinkRow = {
    module_id: string
    is_mandatory: boolean
    due_at: string | null
    training_modules: { title?: string } | { title?: string }[] | null
  }
  const cohorts: AdminCohort[] = (cohortRows ?? []).map((c) => {
    const cmRows = (Array.isArray(c.cohort_members) ? c.cohort_members : []) as Array<{ status?: string }>
    return {
      id: c.id as string,
      name: c.name as string,
      mentor_name: nameOf((c as { mentor?: unknown }).mentor),
      member_count: cmRows.filter((m) => (m.status ?? 'active') === 'active').length,
      invited_count: cmRows.filter((m) => m.status === 'invited').length,
      lifecycle: ((c as { lifecycle?: string }).lifecycle as 'active' | 'archived') ?? 'active',
      training: (
        ((c as { cohort_training_links?: TrainingLinkRow[] }).cohort_training_links ?? []) as TrainingLinkRow[]
      ).map((l) => ({
        module_id: l.module_id,
        is_mandatory: !!l.is_mandatory,
        due_at: l.due_at ?? null,
        title:
          (Array.isArray(l.training_modules) ? l.training_modules[0]?.title : l.training_modules?.title) ?? 'Module',
      })),
    }
  })

  const modules: AdminModule[] = (moduleRows ?? []).map((m) => ({ id: m.id as string, name: m.title as string }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Coaching &amp; Mentoring</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Approve coaches and mentors, build cohorts, and set how many sessions each tier includes.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Session calendar</h2>
        <div className="rounded-lg border border-brand-border bg-white p-4">
          <SessionCalendar sessions={(allSessions ?? []) as { id: string; title: string | null; scheduled_start: string; status: string }[]} />
        </div>
      </section>

      <SessionsManager
        tiers={(tiers ?? []) as AdminTier[]}
        hosts={hosts}
        cohorts={cohorts}
        entitlements={(ents ?? []) as AdminEntitlement[]}
        modules={modules}
      />

      <section className="mt-10">
        <CoachingGrant />
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-lg font-semibold text-brand-blue-dark">Oversight</h2>
        <AdminOversight cohorts={cohorts.map((c) => ({ id: c.id, name: c.name }))} />
      </section>
    </div>
  )
}
