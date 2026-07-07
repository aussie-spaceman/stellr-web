import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { listModules } from '@/lib/training'
import { getMyTraining, getGroupProgress } from '@/lib/training-portal'
import { TrainingTabs, type MemberTab } from '@/components/training/TrainingControls'
import { MyTraining } from '@/components/training/MyTraining'
import { BrowseCourses } from '@/components/training/BrowseCourses'
import { GroupProgressView } from '@/components/training/GroupProgressView'

export const metadata = { title: 'Academy · Training' }

// Membership tiers that carry a teaching/group-management role. Members on any of
// these — or with a teaching event role — see the Group progress tab automatically.
const TEACHER_TIERS = new Set(['Educator', 'Catalyst', 'Innovator', 'Trailblazer'])
const TEACHER_ROLES = new Set(['teacher', 'school_student_manager'])

// Redesigned Training portal (FR-COM-10 / Training Scope). Screen state lives in
// the URL so the page stays server-rendered while feeling single-page via Next
// client navigation.
export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; obj?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const sp = await searchParams
  // Group progress appears automatically for members who manage a group: a
  // teaching event role (Teacher / Student Manager) or one of the teacher tiers.
  const canManageGroup =
    TEACHER_ROLES.has(member.event_role ?? '') ||
    TEACHER_TIERS.has(member.activeTierName ?? '')

  let tab = (sp.tab as MemberTab) || 'my'
  if (tab === 'group' && !canManageGroup) tab = 'my'

  const title = canManageGroup ? 'Training & your group' : 'My training'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.13em] text-brand-blue">
            Academy · Training
          </p>
          <h1 className="mt-1 font-heading text-[30px] font-bold leading-tight text-brand-blue-dark">
            {title}
          </h1>
        </div>
      </div>

      {/* Sub-nav */}
      <TrainingTabs active={tab} showGroup={canManageGroup} />

      {/* Active screen */}
      {tab === 'my' && <MyTraining data={await getMyTraining(member)} />}

      {tab === 'browse' && <BrowseCourses modules={await listModules(member)} />}

      {tab === 'group' && canManageGroup && (
        <GroupProgressView data={await getGroupProgress(member, sp.obj)} />
      )}
    </div>
  )
}
