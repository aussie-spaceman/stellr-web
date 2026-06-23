import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { listModules } from '@/lib/training'
import { getMyTraining, getGroupProgress, getCertificates } from '@/lib/training-portal'
import { RoleSwitch, TrainingTabs, LayoutToggle, type MemberTab } from '@/components/training/TrainingControls'
import { MyTraining } from '@/components/training/MyTraining'
import { BrowseCourses } from '@/components/training/BrowseCourses'
import { GroupProgressView } from '@/components/training/GroupProgressView'
import { Certificates } from '@/components/training/Certificates'

export const metadata = { title: 'Academy · Training' }

// Redesigned Training portal (FR-COM-10 / Training Scope). Screen + role + layout
// state lives in the URL so the page stays server-rendered while feeling
// single-page via Next client navigation.
export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; role?: string; layout?: string; obj?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const sp = await searchParams
  // Only members with a teaching role can act as Teacher (Student Managers are
  // treated as Students — they never see the Teacher view or Group progress).
  const canTeach = member.event_role === 'teacher'
  const role: 'student' | 'teacher' = sp.role === 'teacher' && canTeach ? 'teacher' : 'student'

  let tab = (sp.tab as MemberTab) || 'my'
  if (tab === 'group' && role !== 'teacher') tab = 'my'
  const variant: 'A' | 'B' = sp.layout === 'B' ? 'B' : 'A'

  const title = role === 'teacher' ? 'Training & your group' : 'My training'

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
        {canTeach && <RoleSwitch role={role} />}
      </div>

      {/* Sub-nav */}
      <TrainingTabs active={tab} showGroup={role === 'teacher'} />

      {/* Active screen */}
      {tab === 'my' && (
        <div className="space-y-6">
          <LayoutToggle variant={variant} />
          <MyTraining data={await getMyTraining(member)} variant={variant} />
        </div>
      )}

      {tab === 'browse' && <BrowseCourses modules={await listModules(member)} />}

      {tab === 'group' && role === 'teacher' && (
        <GroupProgressView data={await getGroupProgress(member, sp.obj)} />
      )}

      {tab === 'certs' && <Certificates certificates={await getCertificates(member)} />}
    </div>
  )
}
