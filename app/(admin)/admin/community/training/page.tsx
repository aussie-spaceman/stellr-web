import Link from 'next/link'
import { Plus } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getAdminOverview, listTrainableObjects } from '@/lib/training-admin'
import { AdminTrainingTabs, type AdminTab } from '@/components/admin/training/AdminTrainingTabs'
import { OverviewTab } from '@/components/admin/training/OverviewTab'
import { EventTrackingTab } from '@/components/admin/training/EventTrackingTab'
import { RemindersTab, type ReminderCourse } from '@/components/admin/training/RemindersTab'
import { CourseBuilder } from '@/components/admin/training/CourseBuilder'
import type { AdminModule } from '@/components/admin/community/TrainingManager'
import type { AdminTier } from '@/components/admin/training/ObjectAssignments'

export const metadata = { title: 'Admin — Training' }

const TITLES: Record<AdminTab, string> = {
  overview: 'Training overview',
  builder: 'Course builder',
  tracking: 'Event training tracking',
  reminders: 'Reminders & escalation',
}

async function builderContent(initialCourseId?: string) {
  const db = supabaseServer()
  const [{ data: modules }, { data: tierRows }, objects] = await Promise.all([
    db
      .from('training_modules')
      .select(
        'id, title, description, material_kind, course_type, theme, cert_template_path, start_date, event_ref, min_tier_rank, is_published, ' +
          'training_sections(id, title, display_order, drip_days), ' +
          'training_items(id, title, content_kind, status, section_id, display_order, estimated_minutes, body, recording_status), ' +
          'course_object_assignments(id, object_type, object_ref, object_label, default_requirement, tier_requirements, due_at)'
      )
      .order('display_order', { ascending: true }),
    db.from('membership_tiers').select('id, name, age_bracket, sort_order').order('sort_order'),
    listTrainableObjects('all'),
  ])
  return (
    <CourseBuilder
      courses={(modules ?? []) as unknown as AdminModule[]}
      objects={objects}
      tiers={(tierRows ?? []) as AdminTier[]}
      initialCourseId={initialCourseId}
    />
  )
}

async function reminderCourses(): Promise<ReminderCourse[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('training_modules')
    .select('id, title, remind_inapp, remind_email, remind_sms, remind_2wk, remind_1wk, remind_2d, remind_1d, escalate_supervisor')
    .order('display_order', { ascending: true })
  return (data ?? []).map((m) => ({
    id: m.id as string,
    title: m.title as string,
    settings: {
      remind_inapp: m.remind_inapp as boolean,
      remind_email: m.remind_email as boolean,
      remind_sms: m.remind_sms as boolean,
      remind_2wk: m.remind_2wk as boolean,
      remind_1wk: m.remind_1wk as boolean,
      remind_2d: m.remind_2d as boolean,
      remind_1d: m.remind_1d as boolean,
      escalate_supervisor: m.escalate_supervisor as boolean,
    },
  }))
}

// Admin Training portal (FR-COM-10 / Training Scope): Overview · Course builder ·
// Event tracking · Reminders & escalation. Tab + filters live in the URL so the
// Overview "Needs attention" tile can deep-link into Event tracking.
export default async function AdminTrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; obj?: string; filter?: string; course?: string }>
}) {
  const sp = await searchParams
  const tab = (['overview', 'builder', 'tracking', 'reminders'].includes(sp.tab ?? '')
    ? sp.tab
    : 'overview') as AdminTab

  let content: React.ReactNode = null
  if (tab === 'overview') content = <OverviewTab data={await getAdminOverview()} />
  else if (tab === 'builder') content = await builderContent(sp.course)
  else if (tab === 'tracking')
    content = (
      <EventTrackingTab
        objects={await listTrainableObjects('assigned')}
        initialObjectRef={sp.obj ?? null}
        initialOutstanding={sp.filter === 'outstanding'}
      />
    )
  else if (tab === 'reminders') content = <RemindersTab courses={await reminderCourses()} />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold uppercase tracking-[0.13em] text-brand-blue">Academy · Training</span>
            <span className="rounded-full bg-brand-blue-dark px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
              Admin Console
            </span>
          </div>
          <h1 className="mt-1 font-heading text-[30px] font-bold leading-tight text-brand-blue-dark">{TITLES[tab]}</h1>
        </div>
        <Link
          href="?tab=builder"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright"
        >
          <Plus className="h-4 w-4" /> New course
        </Link>
      </div>

      <AdminTrainingTabs active={tab} />

      {content}
    </div>
  )
}
